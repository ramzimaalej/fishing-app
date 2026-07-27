import type { Device } from 'react-native-ble-plx';

import type { AccelSample } from '@/types';

import { b64ToHex, BLE_DEBUG, bleLog } from './debug';
import { decodeMinewAccFrame, type MinewAccReading, readingToSample } from './minew';
import { subscribeToScan } from './scanBroker';
import type { BleDeviceInfo, SensorConnection } from './types';

/** If no advertisement from the locked tag arrives within this window, we
 * consider the link "stale" and notify (the store shows "reconnecting"). */
const STALE_MS = 8000;
const STALE_CHECK_MS = 2000;

/** A discovered E8S tag (for a future multi-tag picker). */
export interface DiscoveredTag {
  mac: string;
  rssi: number;
  batteryPct: number;
}

function macTail(mac: string): string {
  return mac.replace(/:/g, '').slice(-4).toUpperCase();
}

/** Read the Minew Acc frame out of a scan result's service data, if present. */
function extractReading(device: Device): MinewAccReading | null {
  const sd = device.serviceData;
  if (!sd) return null;
  for (const [uuid, value] of Object.entries(sd)) {
    if (uuid.toLowerCase().includes('ffe1') && typeof value === 'string') {
      const reading = decodeMinewAccFrame(value);
      if (reading) return reading;
    }
  }
  return null;
}

/**
 * Broadcast-based sensor source for the Minew E8S Asset Tag.
 *
 * Unlike a GATT streaming sensor there is no connection: we continuously SCAN
 * (allowDuplicates) for 0xFFE1 service data, lock onto a single tag, and turn
 * each advertisement into an AccelSample stamped with the phone's arrival time.
 * "Auto-reconnect" here means resilience to gaps — if the tag goes quiet we
 * flag staleness and keep scanning, resuming seamlessly when it reappears.
 *
 * The tag's motion sensitivity / advertising interval are configured on the
 * device itself via Minew's BeaconSET+ app, so setFishingMode/setSampleRate are
 * intentionally no-ops here (kept for SensorConnection compatibility).
 */
export class MinewSensorClient implements SensorConnection {
  info: BleDeviceInfo = { id: '', name: 'Searching for E8S…' };

  private readonly sampleListeners = new Set<(s: AccelSample) => void>();
  private readonly disconnectListeners = new Set<() => void>();
  private readonly discovered = new Map<string, DiscoveredTag>();

  private lockedMac: string | null = null;
  private lastFrameAt = 0;
  private stale = false;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeScan: (() => void) | null = null;
  private clock: () => number;
  private sampleCount = 0;
  private readonly seenIds = new Set<string>();

  /**
   * @param targetMac the tag this instance owns. REQUIRED when several clients
   *   run at once (multi-rod): without it a client locks onto the first tag it
   *   sees, so two unbound clients would both read the same tag and report it as
   *   two rods. Null is only safe for a single-rod setup or tag discovery.
   * @param clock injectable time source (defaults to Date.now)
   */
  constructor(
    private readonly targetMac: string | null = null,
    clock: () => number = () => Date.now(),
  ) {
    this.clock = clock;
  }

  /** Begin listening for E8S advertisements on the shared scan. */
  start(): void {
    if (this.unsubscribeScan) return;
    bleLog(`Minew: listening (target ${this.targetMac ?? 'first tag seen'})`);
    // Subscribes to the shared refcounted scan rather than owning one, so
    // several rods can listen concurrently and one disarming never stops the
    // others' scan. See scanBroker.ts.
    this.unsubscribeScan = subscribeToScan((device) => {
      const reading = extractReading(device);
      if (BLE_DEBUG) this.logCandidate(device, reading);
      if (reading) this.onReading(reading, device.rssi ?? -127);
    });
    this.staleTimer = setInterval(() => this.checkStale(), STALE_CHECK_MS);
  }

  /** Log each distinct advertiser that carries service data, once. */
  private logCandidate(device: Device, reading: MinewAccReading | null): void {
    if (this.seenIds.has(device.id)) return;
    this.seenIds.add(device.id);
    const sd = device.serviceData ?? {};
    if (Object.keys(sd).length === 0 && !reading) return; // only service-data beacons
    const sdHex = Object.entries(sd)
      .map(([u, v]) => `${u}=${b64ToHex(String(v))}`)
      .join(' ');
    bleLog(
      `Minew: cand ${reading ? '<= ACC OK' : ''} id=${device.id} name=${device.name ?? device.localName ?? '-'} rssi=${device.rssi} sd=${sdHex || '-'}`,
    );
  }

  private onReading(reading: MinewAccReading, rssi: number): void {
    this.discovered.set(reading.mac, { mac: reading.mac, rssi, batteryPct: reading.batteryPct });

    // Lock policy: the bound target if there is one, else the first tag seen.
    // With multi-rod every armed client is bound (rodConnections refuses to arm
    // an unbound broadcast rod), so the fallback only applies to discovery.
    if (!this.lockedMac) {
      if (this.targetMac && reading.mac !== this.targetMac) return; // wait for ours
      this.lockedMac = reading.mac;
      this.info = { id: reading.mac, name: `E8S ${macTail(reading.mac)}`, battery: reading.batteryPct };
      bleLog(`Minew: LOCKED ${reading.mac} (battery ${reading.batteryPct}%)`);
    } else if (reading.mac !== this.lockedMac) {
      return; // ignore other tags once locked
    }

    this.info = { ...this.info, battery: reading.batteryPct };
    this.lastFrameAt = this.clock();
    if (this.stale) this.stale = false; // recovered

    const sample = readingToSample(reading, this.lastFrameAt);
    this.sampleCount += 1;
    if (BLE_DEBUG && (this.sampleCount <= 5 || this.sampleCount % 50 === 0)) {
      bleLog(
        `Minew: sample#${this.sampleCount} x=${reading.x.toFixed(3)} y=${reading.y.toFixed(3)} z=${reading.z.toFixed(3)} batt=${reading.batteryPct}%`,
      );
    }
    this.sampleListeners.forEach((l) => l(sample));
  }

  private checkStale(): void {
    if (!this.lockedMac || this.stale) return;
    if (this.clock() - this.lastFrameAt > STALE_MS) {
      this.stale = true;
      this.disconnectListeners.forEach((l) => l());
    }
  }

  /** Tags seen so far (for a selection UI). */
  getDiscoveredTags(): DiscoveredTag[] {
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

  // The E8S is configured via Minew BeaconSET+, not over BLE from the app.
  async setFishingMode(): Promise<void> {
    /* no-op: configured on-device */
  }

  async setSampleRate(): Promise<void> {
    /* no-op: advertising interval is configured on-device */
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
