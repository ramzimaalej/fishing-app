import { create } from 'zustand';

import { captureDetection, captureSample } from '@/features/admin/recorder';
import { ensureBlePermissions, waitForPoweredOn } from '@/features/ble/bleManager';
import { batteryState, type BatteryState } from '@/features/ble/battery';
import { getSensorDevice } from '@/features/ble/deviceRegistry';
import type { BleDeviceInfo, ConnectionStatus, SensorConnection } from '@/features/ble/types';
import type { DetectionEvent } from '@/features/detection/detectionEngine';
import {
  DETECTION_PARAM_RANGES,
  type DetectionParams,
} from '@/features/detection/detectionParams';
import {
  currentDetectionParams,
  setDetectionParamsListener,
} from '@/features/detection/detectionParamsStore';
import { monotonicNowMs } from '@/features/detection/monotonicClock';
import { alertToBiteEvent, RodDetector } from '@/features/detection/rodDetector';
import * as scanService from '@scan-foreground-service';
import { biteRepository } from '@/features/bite-history/biteRepository';
import { getCurrentConditions } from '@/features/environment/useEnvironment';
import { AccelRingBuffer } from '@/features/graph/AccelRingBuffer';
import type { AccelPoint } from '@/features/graph/types';
import { notifyBite, notifySensorBattery, notifySignalLost } from '@/features/notifications/feedback';
import type { SessionBite } from '@/features/session-report/sessionSummary';
import { useSettingsStore } from '@/features/settings/settingsStore';
import i18n from '@/i18n';
import { trackBite } from '@/services/firebase/analytics';
import type { AccSample } from '@/features/detection/accSample';
import type { BiteEvent, EnvironmentSnapshot } from '@/types';

import { rodActivity } from '@/features/devices/device';
import { deviceFor } from '@/features/devices/deviceStore';

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
  /**
   * Stream has gone silent. Orthogonal to `status`: the link can look connected
   * while no advertisement has arrived for seconds. Must be shown, not just
   * sounded — the user has to be able to see WHICH rod stopped being watched.
   */
  signalLost: boolean;
  /** True while collecting the arming window; the rod is not yet watched. */
  arming: boolean;
  /** Set when arming failed and the user must retry. */
  armFailReason: string | null;
}

interface Runtime {
  rod: Rod;
  connection: SensorConnection | null;
  detector: RodDetector;
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
  /** True while the stream is silent — orthogonal to connection status. */
  signalLost: boolean;
  /** Most recent impact, surfaced separately from bites. */
  lastImpactReason: string | null;
}

const runtimes = new Map<string, Runtime>();

/** Conditions are shared across rods — one fetch, not one per rod. */
let conditions: EnvironmentSnapshot | null = null;
let conditionsTimer: ReturnType<typeof setInterval> | null = null;

/** Signal-loss polling. See ensureSignalWatch. */
const SIGNAL_CHECK_MS = 2500;
let signalTimer: ReturnType<typeof setInterval> | null = null;

/** Whether the foreground service is confirmed running. See ensureForegroundService. */
let foregroundServiceRunning = false;

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
    threshold: rt.detector.thresholdDeg,
    // "Warmed up" now means a baseline has been established. Until then the rod
    // is explicitly NOT being watched, which the UI must not present as ready.
    isWarmedUp: rt.detector.getPhase() === 'WATCHING',
    points: snap.points,
    bites: snap.bites,
    lastBite: rt.lastBite,
    signalLost: rt.signalLost,
    arming: rt.detector.getPhase() === 'ARMING',
    armFailReason: rt.detector.getArmFailReason(),
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

/**
 * Keep the process alive while rods are armed.
 *
 * Android throttles and then kills background execution, which would stop
 * advertisements arriving. Because the stream carries no sequence numbers, a
 * stopped scan is indistinguishable from a motionless rod — the user would
 * believe a rod was being watched when it was not.
 *
 * Failure is RECORDED, not thrown. Android refuses to start a foreground service
 * from the background on API 31+, and a monitoring aid that crashed the session
 * it exists to protect would be worse than one that did not start. The UI reads
 * `foregroundServiceRunning` to say whether background operation is safe.
 */
async function ensureForegroundService(): Promise<void> {
  if (foregroundServiceRunning || !scanService.isAvailable()) return;
  foregroundServiceRunning = await scanService.start(
    i18n.t('signal.watchingTitle'),
    i18n.t('signal.watchingBody'),
  );
}

/** True when the service is confirmed running — not merely requested. */
export function isBackgroundWatchActive(): boolean {
  return foregroundServiceRunning;
}

/** True when this build can keep watching in the background at all. */
export function isBackgroundWatchSupported(): boolean {
  return scanService.isAvailable();
}

/**
 * Poll every armed rod for signal loss.
 *
 * Without this the loss alarm could only fire when a packet ARRIVED, which is
 * precisely the situation it exists to detect the absence of — so a tag that
 * went flat would leave the rod looking watched forever. Runs at half the loss
 * timeout so the alarm lands within a couple of seconds of the deadline.
 */
function ensureSignalWatch(): void {
  if (signalTimer) return;
  signalTimer = setInterval(() => tickDetection(), SIGNAL_CHECK_MS);
}

function stopSignalWatch(): void {
  if (!signalTimer) return;
  clearInterval(signalTimer);
  signalTimer = null;
}

function handleSample(rt: Runtime, sample: AccSample): void {
  const tick = rt.detector.process(sample);

  if (tick.frame) {
    // The chart plots angular deviation against the threshold, both in degrees.
    rt.buffer.push({
      t: tick.frame.sample.tMonotonicMs,
      dynamic: tick.frame.thetaDeg,
      threshold: rt.detector.thresholdDeg,
    });

    // Ground-truth capture (admin mode). A no-op unless a recording is running,
    // and placed here rather than at the sensor so what is written is exactly
    // what the detector saw, derived features included.
    captureSample(rt.rod.id, tick.frame);
  }

  for (const event of tick.events) handleDetectionEvent(rt, event);

  scheduleFlush();
}

/**
 * Act on one detection event.
 *
 * SIGNAL_LOST is handled here rather than being folded into the connection
 * status, because it is not a connection fact: with no sequence numbers a
 * dropout and a motionless rod are identical in the data, so silence must reach
 * the user as an alarm. Treating it as "no fish" is the worst failure this app
 * has — the user believes a rod is watched when it is not.
 */
function handleDetectionEvent(rt: Runtime, event: DetectionEvent): void {
  const settings = useSettingsStore.getState().settings;

  if (event.type === 'SIGNAL_LOST') {
    rt.signalLost = true;
    rt.error = event.reason;
    void notifySignalLost(rt.rod.name, settings);
    return;
  }

  if (event.type === 'SIGNAL_RESTORED') {
    rt.signalLost = false;
    rt.error = null;
    return;
  }

  if (event.type === 'IMPACT') {
    // Surfaced separately and deliberately NOT as a bite: a fish and somebody
    // knocking the rod both produce sharp onset and sustained deviation, and the
    // spec is explicit that the two cannot be told apart. The user judges.
    rt.lastImpactReason = event.reason;
    return;
  }

  if (event.type !== 'ALERT_HOOKED') return;

  const bite = alertToBiteEvent(event, currentDetectionParams());
  rt.buffer.pushBite(bite);
  captureDetection(rt.rod.id, rt.rod.name, bite, rt.detector.thresholdDeg);
  rt.biteCount += 1;
  rt.lastBite = bite;
  sessionBites.push({ event: bite, at: Date.now(), rodId: rt.rod.id, rodName: rt.rod.name });

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

  // Refuse a rod whose tag is not currently advertising. Arming it would show
  // the rod as watched while nothing was listening — and because the stream has
  // no sequence numbers, that is indistinguishable from a rod that simply has
  // not moved. SIGNAL_LOST would eventually fire, but only after the fish.
  if (dev.requiresDeviceBinding) {
    const activity = rodActivity(
      { enabled: rod.enabled, device: deviceFor(rod.deviceId) },
      Date.now(),
    );
    if (activity === 'device-off') {
      return { ok: false, error: `${rod.name}: its tag is powered off.` };
    }
    if (activity === 'device-silent' || activity === 'unpaired') {
      return {
        ok: false,
        error: `${rod.name}: its tag is not responding. Check it is switched on and in range.`,
      };
    }
  }

  const settings = useSettingsStore.getState().settings;
  const rt: Runtime = {
    rod,
    connection: null,
    detector: new RodDetector(currentDetectionParams()),
    buffer: new AccelRingBuffer(),
    offSample: null,
    offDisconnect: null,
    status: dev.initialStatus,
    device: null,
    error: null,
    biteCount: 0,
    lastBite: null,
    warnedBattery: 'ok',
    signalLost: false,
    lastImpactReason: null,
  };
  runtimes.set(rod.id, rt);
  scheduleFlush();

  try {
    if (dev.requiresBle) {
      const granted = await ensureBlePermissions();
      if (!granted) {
        // Removed from the map, not just marked. Leaving it made the NEXT
        // attempt hit the idempotence guard and return ok — so a retry after
        // enabling Bluetooth reported every rod armed while none had a sensor,
        // no scan subscription and no signal-loss timer.
        runtimes.delete(rod.id);
        scheduleFlush();
        return { ok: false, error: 'Bluetooth permission denied.' };
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
    ensureSignalWatch();
    void ensureForegroundService();
    scheduleFlush();
    return { ok: true };
  } catch (e) {
    // Same reason as the permission path: a half-armed runtime left in the map
    // makes every retry a silent no-op that reports success.
    runtimes.delete(rod.id);
    scheduleFlush();
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to connect to sensor.',
    };
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

  if (runtimes.size === 0) {
    stopConditionsPolling();
    stopSignalWatch();
    // Released with the last rod: an ongoing notification claiming rods are
    // watched, when none are, is exactly the lie the service exists to prevent.
    void scanService.stop();
    foregroundServiceRunning = false;
  }
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
  // The sensitivity argument used to be destructured and never read, so the
  // shipped slider — labelled "higher detects smaller nibbles" — did nothing at
  // all. It now drives the deflection threshold, which is the parameter that
  // actually decides how small a bite registers.
  setDetectionParams(sensitivityToParams(config.sensitivity));

  for (const rt of runtimes.values()) {
    void rt.connection?.setFishingMode(config.liveBaitMode).catch(() => undefined);
  }
  scheduleFlush();
}

/**
 * Map the 0..1 user slider onto the deflection threshold.
 *
 * Inverted: higher sensitivity means a SMALLER angle counts as a bite. The ends
 * are the parameter's own documented range, so the slider and the debug screen
 * cannot disagree about what is achievable — they write the same field, and the
 * debug screen is the finer control over the same value.
 */
export function sensitivityToParams(sensitivity: number): DetectionParams {
  const { min, max } = DETECTION_PARAM_RANGES.thetaDeg;
  const clamped = Math.max(0, Math.min(1, sensitivity));
  const thetaDeg = max - clamped * (max - min);
  return { ...currentDetectionParams(), thetaDeg: Number(thetaDeg.toFixed(1)) };
}

/**
 * Push new detection parameters to every live rod.
 *
 * Registered with the params store so tuning takes effect on rods that are
 * ALREADY armed — otherwise a change would only apply to the next session, and
 * tuning in the field would mean disarming and re-arming (and so re-baselining)
 * after every adjustment.
 */
export function setDetectionParams(params: DetectionParams): void {
  for (const rt of runtimes.values()) rt.detector.setParams(params);
  scheduleFlush();
}

setDetectionParamsListener(setDetectionParams);

/**
 * Advance every rod's signal-loss timer.
 *
 * Needed because the only other entry point is a packet arriving, and the whole
 * point of the check is that no packet is arriving.
 */
export function tickDetection(): void {
  const now = monotonicNowMs();
  for (const rt of runtimes.values()) {
    for (const event of rt.detector.tick(now)) handleDetectionEvent(rt, event);
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
  stopSignalWatch();
  foregroundServiceRunning = false;
  conditions = null;
  currentUid = null;
  useRodRuntimeStore.setState({ views: {}, anyArmed: false, lastBiteRodId: null });
}
