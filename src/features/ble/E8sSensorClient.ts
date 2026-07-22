import type { Device } from 'react-native-ble-plx';

import type { AccelSample } from '@/types';

import { getBleManager } from './bleManager';
import {
  decodeMinewAccFrame,
  MINEW_SERVICE_UUID,
  type MinewAccReading,
  readingToSample,
} from './minew';
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
export class E8sSensorClient implements SensorConnection {
  info: BleDeviceInfo = { id: '', name: 'Searching for E8S…' };

  private readonly sampleListeners = new Set<(s: AccelSample) => void>();
  private readonly disconnectListeners = new Set<() => void>();
  private readonly discovered = new Map<string, DiscoveredTag>();

  private lockedMac: string | null = null;
  private lastFrameAt = 0;
  private stale = false;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;
  private clock: () => number;

  /**
   * @param targetMac optional remembered tag to lock onto directly
   * @param clock injectable time source (defaults to Date.now)
   */
  constructor(
    private readonly targetMac: string | null = null,
    clock: () => number = () => Date.now(),
  ) {
    this.clock = clock;
  }

  /** Begin scanning for E8S advertisements. */
  start(): void {
    if (this.scanning) return;
    this.scanning = true;
    getBleManager().startDeviceScan(
      [MINEW_SERVICE_UUID],
      { allowDuplicates: true },
      (error, device) => {
        if (error || !device) return;
        const reading = extractReading(device);
        if (reading) this.onReading(reading, device.rssi ?? -127);
      },
    );
    this.staleTimer = setInterval(() => this.checkStale(), STALE_CHECK_MS);
  }

  private onReading(reading: MinewAccReading, rssi: number): void {
    this.discovered.set(reading.mac, { mac: reading.mac, rssi, batteryPct: reading.batteryPct });

    // Lock policy: a specified target, else the first tag seen. (Strongest-RSSI
    // selection across multiple tags is a future multi-tag-picker enhancement.)
    if (!this.lockedMac) {
      if (this.targetMac && reading.mac !== this.targetMac) return; // wait for ours
      this.lockedMac = reading.mac;
      this.info = { id: reading.mac, name: `E8S ${macTail(reading.mac)}`, battery: reading.batteryPct };
    } else if (reading.mac !== this.lockedMac) {
      return; // ignore other tags once locked
    }

    this.info = { ...this.info, battery: reading.batteryPct };
    this.lastFrameAt = this.clock();
    if (this.stale) this.stale = false; // recovered

    const sample = readingToSample(reading, this.lastFrameAt);
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
    this.scanning = false;
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    try {
      getBleManager().stopDeviceScan();
    } catch {
      /* manager may already be torn down */
    }
    this.sampleListeners.clear();
    this.disconnectListeners.clear();
  }
}
