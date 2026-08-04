import type { AccelSample } from '@/types';

import { b64ToHex, BLE_DEBUG, bleLog } from './debug';
import { subscribeToScan } from './scanBroker';
import type { BleDeviceInfo, SensorConnection } from './types';

/**
 * Shared machinery for BROADCAST sensors — tags that advertise their reading
 * rather than accepting a GATT connection.
 *
 * Everything here is device-independent: subscribe to the shared scan, lock onto
 * one physical tag, turn each advertisement into a sample stamped with arrival
 * time, and treat silence as staleness rather than disconnection. A concrete
 * sensor supplies only a BroadcastSensorSpec — how to recognise and decode its
 * frame — which is a decoder plus three strings.
 *
 * Note what is NOT here: connection lifecycle, reconnection, characteristic
 * discovery. A broadcast tag has none of those. The app's earlier GATT clients
 * were a separate hierarchy for exactly that reason, and were deleted outright
 * when the product settled on one broadcast device — so if a future revision is
 * connectable, it wants its own base class rather than optional hooks bolted on
 * here.
 */

/**
 * The subset of react-native-ble-plx's `Device` a spec may read.
 *
 * Narrowed deliberately: a spec that depends only on this is a pure function of
 * plain data, so frame decoding can be unit-tested against captured bytes with
 * no BLE stack, no device and no native module. The previous Minew extractor
 * took a full `Device` and consequently had no tests at all.
 */
export interface BroadcastAdvertisement {
  id: string;
  name?: string | null;
  localName?: string | null;
  rssi?: number | null;
  /** UUID (any casing/length) → base64 service-data value. */
  serviceData?: Record<string, string> | null;
  /** base64 manufacturer-specific data, when the tag uses 0xFF instead. */
  manufacturerData?: string | null;
}

export interface BroadcastReading {
  /** g */
  x: number;
  y: number;
  z: number;
  /**
   * Stable identity of the physical tag.
   *
   * Prefer a MAC carried INSIDE the frame when the format provides one. Falling
   * back to `advertisement.id` works on Android (where it is the MAC) but on iOS
   * that is an opaque per-install UUID, so a rod's saved binding would not
   * survive a reinstall. A spec that must fall back should say so in its docs.
   */
  deviceKey: string;
  /** 0..100 when the frame reports it. */
  batteryPct?: number;
}

export interface BroadcastSensorSpec {
  /** Registry kind, used in log lines. */
  kind: string;
  /** `info.name` before any tag is locked. */
  searchingName: string;
  /** `info.name` once locked. */
  displayName(deviceKey: string): string;
  /** Decode one advertisement, or null when it is not this sensor's frame. */
  extract(advertisement: BroadcastAdvertisement): BroadcastReading | null;
  /** Silence after which the link is reported stale. Defaults to STALE_MS. */
  staleMs?: number;
}

/** Default silence before the link counts as stale. */
const STALE_MS = 8000;
const STALE_CHECK_MS = 2000;

/** A tag seen while scanning, for a selection UI. */
export interface DiscoveredBroadcastDevice {
  key: string;
  rssi: number;
  batteryPct?: number;
}

export class BroadcastSensorClient implements SensorConnection {
  info: BleDeviceInfo;

  private readonly sampleListeners = new Set<(s: AccelSample) => void>();
  private readonly disconnectListeners = new Set<() => void>();
  private readonly discovered = new Map<string, DiscoveredBroadcastDevice>();
  private readonly seenIds = new Set<string>();

  private lockedKey: string | null = null;
  private lastFrameAt = 0;
  private stale = false;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeScan: (() => void) | null = null;
  private sampleCount = 0;

  /**
   * @param spec how to recognise and decode this sensor's frames
   * @param targetKey the tag this instance owns. REQUIRED when several clients
   *   run at once (multi-rod): without it a client locks onto the first tag it
   *   hears, so two unbound clients would both read one tag and report it as two
   *   rods. Null is only safe for a single-rod setup or for discovery.
   * @param clock injectable time source, so staleness is testable
   */
  constructor(
    protected readonly spec: BroadcastSensorSpec,
    private readonly targetKey: string | null = null,
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.info = { id: '', name: spec.searchingName };
  }

  start(): void {
    if (this.unsubscribeScan) return;
    bleLog(`${this.spec.kind}: listening (target ${this.targetKey ?? 'first tag seen'})`);
    // Subscribes to the shared refcounted scan rather than owning one, so several
    // rods can listen concurrently and one disarming never stops the others.
    this.unsubscribeScan = subscribeToScan((device) => {
      const adv = device as BroadcastAdvertisement;
      const reading = this.safeExtract(adv);
      if (BLE_DEBUG) this.logCandidate(adv, reading);
      if (reading) this.onReading(reading, device.rssi ?? -127);
    });
    this.staleTimer = setInterval(() => this.checkStale(), STALE_CHECK_MS);
  }

  /**
   * Run the spec's decoder without letting it break the scan.
   *
   * A decoder parses bytes from arbitrary devices in radio range, so it will meet
   * truncated and corrupt payloads. Every rod shares one scan (see scanBroker),
   * and while the broker also guards its fan-out, one rod's experimental decoder
   * throwing must not be able to cost this rod its advertisement. This matters
   * most while a new sensor's format is still being worked out.
   */
  private safeExtract(adv: BroadcastAdvertisement): BroadcastReading | null {
    try {
      return this.spec.extract(adv);
    } catch (e) {
      bleLog(`${this.spec.kind}: extract threw:`, e instanceof Error ? e.message : e);
      return null;
    }
  }

  /** Log each distinct advertiser carrying any payload, once. */
  private logCandidate(adv: BroadcastAdvertisement, reading: BroadcastReading | null): void {
    if (this.seenIds.has(adv.id)) return;
    this.seenIds.add(adv.id);
    const sd = adv.serviceData ?? {};
    const hasPayload = Object.keys(sd).length > 0 || adv.manufacturerData;
    if (!hasPayload && !reading) return;
    const sdHex = Object.entries(sd)
      .map(([u, v]) => `${u}=${b64ToHex(String(v))}`)
      .join(' ');
    const mfgHex = adv.manufacturerData ? ` mfg=${b64ToHex(adv.manufacturerData)}` : '';
    bleLog(
      `${this.spec.kind}: cand ${reading ? '<= ACC OK' : ''} id=${adv.id} name=${adv.name ?? adv.localName ?? '-'} rssi=${adv.rssi} sd=${sdHex || '-'}${mfgHex}`,
    );
  }

  private onReading(reading: BroadcastReading, rssi: number): void {
    this.discovered.set(reading.deviceKey, {
      key: reading.deviceKey,
      rssi,
      batteryPct: reading.batteryPct,
    });

    // Lock policy: the bound target if there is one, else the first tag seen.
    // With multi-rod every armed client is bound (armRod refuses an unbound
    // broadcast rod), so the fallback only applies to discovery.
    if (!this.lockedKey) {
      if (this.targetKey && reading.deviceKey !== this.targetKey) return; // wait for ours
      this.lockedKey = reading.deviceKey;
      this.info = {
        id: reading.deviceKey,
        name: this.spec.displayName(reading.deviceKey),
        battery: reading.batteryPct,
      };
      bleLog(`${this.spec.kind}: LOCKED ${reading.deviceKey} (battery ${reading.batteryPct ?? '?'}%)`);
    } else if (reading.deviceKey !== this.lockedKey) {
      return; // ignore other tags once locked
    }

    // Replaced wholesale so a stale reference cannot pin the battery reading —
    // rodRuntime reads connection.info fresh on every flush for this reason.
    this.info = { ...this.info, battery: reading.batteryPct ?? this.info.battery };
    this.lastFrameAt = this.clock();
    if (this.stale) this.stale = false; // recovered

    const sample: AccelSample = {
      // The tag has no real clock, so arrival time is the only timestamp
      // available. See the clock-domain note in src/types.
      t: this.lastFrameAt,
      x: reading.x,
      y: reading.y,
      z: reading.z,
    };
    this.sampleCount += 1;
    if (BLE_DEBUG && (this.sampleCount <= 5 || this.sampleCount % 50 === 0)) {
      bleLog(
        `${this.spec.kind}: sample#${this.sampleCount} x=${reading.x.toFixed(3)} y=${reading.y.toFixed(3)} z=${reading.z.toFixed(3)} batt=${reading.batteryPct ?? '?'}%`,
      );
    }
    this.sampleListeners.forEach((l) => l(sample));
  }

  private checkStale(): void {
    if (!this.lockedKey || this.stale) return;
    const limit = this.spec.staleMs ?? STALE_MS;
    if (this.clock() - this.lastFrameAt > limit) {
      this.stale = true;
      this.disconnectListeners.forEach((l) => l());
    }
  }

  /** Tags seen so far, strongest signal first. */
  getDiscovered(): DiscoveredBroadcastDevice[] {
    return [...this.discovered.values()].sort((a, b) => b.rssi - a.rssi);
  }

  onSample(listener: (sample: AccelSample) => void): () => void {
    this.sampleListeners.add(listener);
    return () => this.sampleListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  /**
   * No-ops by default: a broadcast tag is configured on the device itself (or in
   * a vendor app), not over the air from us. A spec whose tag does accept
   * configuration can override these in a subclass.
   */
  async setFishingMode(): Promise<void> {
    /* configured on-device */
  }

  async setSampleRate(): Promise<void> {
    /* advertising interval is configured on-device */
  }

  async disconnect(): Promise<void> {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    // Release our slot on the shared scan. The broker stops the underlying scan
    // only when the LAST listener leaves, so other rods keep receiving.
    this.unsubscribeScan?.();
    this.unsubscribeScan = null;
    this.sampleListeners.clear();
    this.disconnectListeners.clear();
  }
}
