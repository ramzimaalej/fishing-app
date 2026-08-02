import { create } from 'zustand';

import { SENSOR_SAMPLE_RATE_HZ } from '@/config/constants';
import { captureDetection, captureSample } from '@/features/admin/recorder';
import { ensureBlePermissions, waitForPoweredOn } from '@/features/ble/bleManager';
import { batteryState, type BatteryState } from '@/features/ble/battery';
import { getSensorDevice } from '@/features/ble/deviceRegistry';
import type { BleDeviceInfo, ConnectionStatus, SensorConnection } from '@/features/ble/types';
import { BiteDetector } from '@/features/bite-detection/BiteDetector';
import { biteRepository } from '@/features/bite-history/biteRepository';
import { getCurrentConditions } from '@/features/environment/useEnvironment';
import { AccelRingBuffer } from '@/features/graph/AccelRingBuffer';
import type { AccelPoint } from '@/features/graph/types';
import { notifyBite, notifySensorBattery } from '@/features/notifications/feedback';
import type { SessionBite } from '@/features/session-report/sessionSummary';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { trackBite } from '@/services/firebase/analytics';
import type { AccelSample, BiteEvent, EnvironmentSnapshot } from '@/types';

import { isRodArmable, type Rod } from './rod';

/**
 * Per-rod detection runtime.
 *
 * Deliberately NOT a React hook. Every armed rod must keep detecting whether or
 * not its chart is the one on screen — a bite alarm that only watches the
 * selected rod is worse than useless, because the user believes it is watching
 * all of them. Hooks are per-component and would tie a rod's pipeline to its
 * visibility, so the pipelines live here and React only subscribes.
 *
 * One runtime per rod owns: a SensorConnection, a BiteDetector, a graph ring
 * buffer, and that rod's session bite tally.
 */

const CONDITIONS_REFRESH_MS = 15 * 60 * 1000;
/** Graph/state publish cadence. Coalesces bursts across all rods into one tick. */
const FLUSH_MS = 80;

/** Reactive, per-rod view of the runtime for the UI. */
export interface RodRuntimeView {
  rodId: string;
  status: ConnectionStatus;
  device: BleDeviceInfo | null;
  error: string | null;
  /** Bites detected on this rod since it was armed. */
  biteCount: number;
  threshold: number;
  isWarmedUp: boolean;
  points: AccelPoint[];
  bites: BiteEvent[];
  /** Most recent bite, for the alert banner. */
  lastBite: BiteEvent | null;
}

interface Runtime {
  rod: Rod;
  connection: SensorConnection | null;
  detector: BiteDetector;
  buffer: AccelRingBuffer;
  offSample: (() => void) | null
  offDisconnect: (() => void) | null;
  status: ConnectionStatus;
  device: BleDeviceInfo | null;
  error: string | null;
  biteCount: number;
  lastBite: BiteEvent | null;
  /** Last battery band we warned about, so each step warns exactly once. */
  warnedBattery: BatteryState;
}

const runtimes = new Map<string, Runtime>();

/** Conditions are shared across rods — one fetch, not one per rod. */
let conditions: EnvironmentSnapshot | null = null;
let conditionsTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Session bite log across ALL rods, stamped with wall-clock time at the moment
 * of detection. It lives here rather than in the screen because this is where
 * bites are born: the screen would otherwise have to poll every rod's rolling
 * graph buffer and de-duplicate, and would silently miss any bite that scrolled
 * out of the window between polls.
 */
let sessionBites: SessionBite[] = [];

/** Auth uid, injected rather than imported reactively (this file isn't React). */
let currentUid: string | null = null;
export function setRuntimeUid(uid: string | null): void {
  currentUid = uid;
}

// ---------------------------------------------------------------------------
// Reactive store — the only thing React reads.
// ---------------------------------------------------------------------------

interface RodRuntimeState {
  /** rodId → view. Rebuilt on each flush. */
  views: Record<string, RodRuntimeView>;
  /** True while at least one rod is armed. */
  anyArmed: boolean;
  /** Rod that most recently produced a bite, for cross-rod alerting. */
  lastBiteRodId: string | null;
}

export const useRodRuntimeStore = create<RodRuntimeState>(() => ({
  views: {},
  anyArmed: false,
  lastBiteRodId: null,
}));

let flushScheduled = false;

function buildView(rt: Runtime): RodRuntimeView {
  const snap = rt.buffer.snapshot();
  // Read the connection's CURRENT info rather than the snapshot taken at connect
  // time. The sensor clients replace `info` wholesale when battery changes
  // (`this.info = { ...this.info, battery }`), so a cached reference would show
  // the level from the first sample forever.
  const device = rt.connection?.info ?? rt.device;
  return {
    rodId: rt.rod.id,
    status: rt.status,
    device,
    error: rt.error,
    biteCount: rt.biteCount,
    threshold: rt.detector.threshold,
    isWarmedUp: rt.detector.isWarmedUp,
    points: snap.points,
    bites: snap.bites,
    lastBite: rt.lastBite,
  };
}

function flush(): void {
  const views: Record<string, RodRuntimeView> = {};
  for (const [id, rt] of runtimes) {
    views[id] = buildView(rt);
    checkBattery(rt, views[id]!.device?.battery ?? null);
  }
  useRodRuntimeStore.setState({ views, anyArmed: runtimes.size > 0 });
}

/**
 * Warn once per band as a sensor's battery falls.
 *
 * A bite alarm whose sensor dies stops watching a rod while still LOOKING
 * armed — the same silent failure as a lapsed session, and the reason this
 * warns rather than only colouring a number. The latch only ever moves
 * downwards, so a reading jittering around a threshold cannot re-notify.
 */
function checkBattery(rt: Runtime, percent: number | null): void {
  if (percent === null) return;
  const state = batteryState(percent);
  if (state === 'ok' || state === rt.warnedBattery) return;
  // 'low' -> 'critical' warns again; 'critical' -> 'low' (recharged) does not.
  if (rt.warnedBattery === 'critical') return;
  rt.warnedBattery = state;
  void notifySensorBattery(rt.rod.name, percent, state);
}

/** Coalesce publishes: N rods × ~10 Hz would otherwise be N×10 renders/sec. */
function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    flush();
  }, FLUSH_MS);
}

// ---------------------------------------------------------------------------

function ensureConditionsPolling(): void {
  if (conditionsTimer) return;
  const load = async () => {
    const c = await getCurrentConditions();
    if (c) conditions = c;
  };
  void load();
  conditionsTimer = setInterval(() => void load(), CONDITIONS_REFRESH_MS);
}

function stopConditionsPolling(): void {
  if (!conditionsTimer) return;
  clearInterval(conditionsTimer);
  conditionsTimer = null;
}

function handleSample(rt: Runtime, sample: AccelSample): void {
  const tick = rt.detector.process(sample);
  rt.buffer.push({ t: tick.sample.t, dynamic: tick.dynamic, threshold: tick.threshold });

  // Ground-truth capture (admin mode). A no-op unless a recording is running,
  // and placed here rather than at the sensor so what is written is exactly what
  // the detector saw, derived series included.
  captureSample(rt.rod.id, tick);

  const bite = tick.bite;
  if (bite) {
    rt.buffer.pushBite(bite);
    captureDetection(rt.rod.id, rt.rod.name, bite, tick.threshold);
    rt.biteCount += 1;
    rt.lastBite = bite;
    sessionBites.push({ event: bite, at: Date.now(), rodId: rt.rod.id, rodName: rt.rod.name });

    const settings = useSettingsStore.getState().settings;
    // Feedback names the rod, so the user knows WHICH rod to pick up — the whole
    // point of multi-rod alerting.
    void notifyBite(bite, settings, rt.rod.name);
    trackBite(bite.size, bite.confidence);

    if (currentUid) {
      void biteRepository
        .add(currentUid, bite, conditions ?? undefined, {
          rodId: rt.rod.id,
          rodName: rt.rod.name,
        })
        .catch(() => undefined);
    }

    useRodRuntimeStore.setState({ lastBiteRodId: rt.rod.id });
  }

  scheduleFlush();
}

export interface ArmResult {
  ok: boolean
  error?: string;
}

/**
 * Arm one rod: create its sensor connection and start its detector.
 * Idempotent — arming an already-armed rod is a no-op.
 */
export async function armRod(rod: Rod): Promise<ArmResult> {
  if (runtimes.has(rod.id)) return { ok: true };

  const dev = getSensorDevice(rod.sensorKind);

  // A broadcast rod with no bound tag would lock onto whichever tag advertised
  // first — and a second such rod would lock the same one, silently reporting
  // one physical sensor as two rods. Refuse rather than mislead.
  if (!isRodArmable(rod, dev.requiresDeviceBinding)) {
    return { ok: false, error: `${rod.name}: pair a sensor first.` };
  }

  const settings = useSettingsStore.getState().settings;
  const rt: Runtime = {
    rod,
    connection: null,
    detector: new BiteDetector({
      sampleRateHz: SENSOR_SAMPLE_RATE_HZ,
      sensitivity: settings.sensitivity,
      liveBaitMode: settings.liveBaitMode,
    }),
    buffer: new AccelRingBuffer(),
    offSample: null,
    offDisconnect: null,
    status: dev.initialStatus,
    device: null,
    error: null,
    biteCount: 0,
    lastBite: null,
    warnedBattery: 'ok',
  };
  runtimes.set(rod.id, rt);
  scheduleFlush();

  try {
    if (dev.requiresBle) {
      const granted = await ensureBlePermissions();
      if (!granted) {
        rt.status = 'unauthorized';
        rt.error = 'Bluetooth permission denied.';
        scheduleFlush();
        return { ok: false, error: rt.error };
      }
      await waitForPoweredOn();
    }

    const conn = dev.create({ deviceId: rod.deviceId, instanceLabel: rod.name });
    rt.connection = conn;
    rt.offSample = conn.onSample((s) => handleSample(rt, s));

    // Stale link → 'reconnecting'; the first resumed sample flips it back.
    rt.offDisconnect = conn.onDisconnect(() => {
      if (!runtimes.has(rod.id)) return;
      rt.status = 'reconnecting';
      scheduleFlush();
      const off = conn.onSample(() => {
        off();
        if (runtimes.has(rod.id)) {
          rt.status = 'connected';
          rt.device = conn.info;
          scheduleFlush();
        }
      });
    });

    if (dev.initialStatus === 'connected') {
      rt.status = 'connected';
      rt.device = conn.info;
    } else {
      // Scanning/connecting: device details and 'connected' land on first sample.
      const off = conn.onSample(() => {
        off();
        if (runtimes.has(rod.id)) {
          rt.status = 'connected';
          rt.device = conn.info;
          scheduleFlush();
        }
      });
    }

    void conn.setFishingMode(settings.liveBaitMode).catch(() => undefined);
    conn.start?.();
    ensureConditionsPolling();
    scheduleFlush();
    return { ok: true };
  } catch (e) {
    rt.status = 'error';
    rt.error = e instanceof Error ? e.message : 'Failed to connect to sensor.';
    scheduleFlush();
    return { ok: false, error: rt.error };
  }
}

/** Disarm one rod and release its sensor. */
export async function disarmRod(rodId: string): Promise<void> {
  const rt = runtimes.get(rodId);
  if (!rt) return;
  runtimes.delete(rodId);

  rt.offSample?.();
  rt.offDisconnect?.();
  await rt.connection?.disconnect().catch(() => undefined);
  rt.buffer.clear();

  if (runtimes.size === 0) stopConditionsPolling();
  flush();
}

/** Arm several rods. Returns the errors for those that could not be armed. */
export async function armRods(rods: readonly Rod[]): Promise<string[]> {
  const results = await Promise.all(rods.map((r) => armRod(r)));
  return results.map((r, i) => (r.ok ? null : (r.error ?? `${rods[i]!.name}: failed`)))
    .filter((e): e is string => e !== null);
}

export async function disarmAll(): Promise<void> {
  await Promise.all([...runtimes.keys()].map((id) => disarmRod(id)));
  useRodRuntimeStore.setState({ lastBiteRodId: null });
}

/** Retune every live detector when the user moves the sensitivity slider. */
export function retuneAll(config: { sensitivity: number; liveBaitMode: boolean }): void {
  for (const rt of runtimes.values()) {
    rt.detector.setConfig(config);
    void rt.connection?.setFishingMode(config.liveBaitMode).catch(() => undefined);
  }
  scheduleFlush();
}

/** Rod ids currently armed. */
export function armedRodIds(): string[] {
  return [...runtimes.keys()];
}

export function isRodArmed(rodId: string): boolean {
  return runtimes.has(rodId);
}

/** Total bites across all armed rods this session. */
export function totalBiteCount(): number {
  let total = 0;
  for (const rt of runtimes.values()) total += rt.biteCount;
  return total;
}

/** Begin a session: clears the cross-rod bite log. */
export function startSessionLog(): void {
  sessionBites = [];
}

/** The session's bites across every rod, oldest first. */
export function getSessionBites(): SessionBite[] {
  return sessionBites.slice();
}

/**
 * Keep a live runtime's rod metadata in step with the store (a rename must
 * change what the bite notification says, without disarming the rod).
 */
export function syncRodMeta(rod: Rod): void {
  const rt = runtimes.get(rod.id);
  if (!rt) return;
  rt.rod = rod;
}

/** Test seam. */
export function resetRodRuntime(): void {
  runtimes.clear();
  stopConditionsPolling();
  conditions = null;
  currentUid = null;
  useRodRuntimeStore.setState({ views: {}, anyArmed: false, lastBiteRodId: null });
}
