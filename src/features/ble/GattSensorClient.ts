import type { Device, Subscription } from 'react-native-ble-plx';

import type { AccelSample } from '@/types';

import { getBleManager } from './bleManager';
import { b64ToHex, BLE_DEBUG, bleLog } from './debug';
import type { BleDeviceInfo, SensorConnection } from './types';

/** One decoded accelerometer reading (grams). Battery optional. */
export interface AccelReading {
  x: number;
  y: number;
  z: number;
  batteryPct?: number;
}

/**
 * Declarative description of how to read accel data from a connectable BLE
 * peripheral. CP27 and the generic client are both just a config over the base
 * client below — the only differences are how the device is recognised, what
 * unlock/enable writes it needs, and how its notifications decode.
 */
export interface GattSensorConfig {
  /** Human label used in status text and logs (e.g. "DX-CP27MINI"). */
  readonly label: string;
  /** Restrict the scan to these service UUIDs (faster); null = scan all. */
  readonly scanServiceUUIDs?: string[] | null;
  /** Return true for the peripheral we want to lock onto. */
  match(device: Device): boolean;
  /** Post-connect writes (auth, enable-streaming). Runs after discovery. */
  setup?(device: Device): Promise<void>;
  /**
   * Characteristic that pushes accel notifications. When null the client
   * auto-selects the first notifiable/indicatable characteristic it finds
   * (used by the generic client, which doesn't know the device's layout).
   */
  readonly notify?: { service: string; characteristic: string } | null;
  /**
   * If set, also POLL the notify characteristic by reading it on this interval.
   * Some beacons expose the current sensor value via a readable characteristic
   * instead of (or in addition to) pushing notifications. Harmless when the
   * device also notifies — decode/emit is idempotent per value.
   */
  readonly poll?: { intervalMs: number } | null;
  /** Turn a base64 notification value into a reading, or null if not accel. */
  decode(base64: string): AccelReading | null;
}

const CONNECT_TIMEOUT_MS = 12000;
/** Delay before re-scanning after a drop/failure — avoids Android scan throttle. */
const RECONNECT_DELAY_MS = 3000;

/**
 * Connection-based (GATT) bite-sensor source.
 *
 * Lifecycle: scan for a matching peripheral → connect → discover services →
 * run the config's `setup` (auth / enable streaming) → subscribe to the notify
 * characteristic → decode each notification into an AccelSample stamped with
 * the phone's arrival time. If the link drops it schedules a re-scan, so
 * "reconnecting" resolves seamlessly (mirroring the broadcast client's model).
 */
export class GattSensorClient implements SensorConnection {
  info: BleDeviceInfo;

  private readonly sampleListeners = new Set<(s: AccelSample) => void>();
  private readonly disconnectListeners = new Set<() => void>();
  private readonly clock: () => number;
  private readonly targetId: string | null;

  private device: Device | null = null;
  private monitorSub: Subscription | null = null;
  private disconnectSub: Subscription | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;
  private connecting = false;
  private stopped = false;
  private notifCount = 0;
  private readonly seenIds = new Set<string>();

  /**
   * @param config      how to find, unlock and decode the device
   * @param targetId    optional exact peripheral id to lock onto (skips match)
   * @param clock       injectable time source (defaults to Date.now)
   */
  constructor(
    protected readonly config: GattSensorConfig,
    targetId: string | null = null,
    clock: () => number = () => Date.now(),
  ) {
    this.targetId = targetId;
    this.clock = clock;
    this.info = { id: targetId ?? '', name: `Searching for ${config.label}…` };
  }

  start(): void {
    if (this.stopped || this.scanning || this.connecting) return;
    this.beginScan();
  }

  private beginScan(): void {
    if (this.stopped) return;
    this.scanning = true;
    bleLog(`${this.config.label}: scan start (filter=${this.config.scanServiceUUIDs ?? 'all'})`);
    getBleManager().startDeviceScan(
      this.config.scanServiceUUIDs ?? null,
      { allowDuplicates: false },
      (error, device) => {
        if (error) {
          bleLog(`${this.config.label}: scan error:`, error.message);
          return;
        }
        if (!device || this.connecting) return;
        const matched = this.targetId ? device.id === this.targetId : this.config.match(device);
        if (BLE_DEBUG) this.logCandidate(device, matched);
        if (!matched) return;
        bleLog(`${this.config.label}: MATCHED ${device.id} — connecting`);
        this.connecting = true;
        this.scanning = false;
        try {
          getBleManager().stopDeviceScan();
        } catch {
          /* manager may be gone */
        }
        void this.connect(device.id);
      },
    );
  }

  /** Log each distinct advertiser once, with the fields that drive matching. */
  private logCandidate(device: Device, matched: boolean): void {
    if (this.seenIds.has(device.id)) return;
    this.seenIds.add(device.id);
    const sd = device.serviceData ?? {};
    const sdHex = Object.entries(sd)
      .map(([u, v]) => `${u}=${b64ToHex(String(v))}`)
      .join(' ');
    bleLog(
      `${this.config.label}: candidate ${matched ? '<= MATCH' : ''}`,
      JSON.stringify({
        id: device.id,
        name: device.name ?? device.localName ?? null,
        rssi: device.rssi,
        connectable: device.isConnectable,
        serviceUUIDs: device.serviceUUIDs ?? null,
        serviceData: sdHex || null,
        mfg: device.manufacturerData ? b64ToHex(device.manufacturerData) : null,
      }),
    );
  }

  private async connect(id: string): Promise<void> {
    try {
      bleLog(`${this.config.label}: connecting to ${id}…`);
      const device = await getBleManager().connectToDevice(id, { timeout: CONNECT_TIMEOUT_MS });
      this.device = device;
      this.disconnectSub = device.onDisconnected((err) => {
        bleLog(`${this.config.label}: link dropped`, err?.message ?? '');
        this.handleDropped();
      });
      bleLog(`${this.config.label}: connected; discovering services…`);
      await device.discoverAllServicesAndCharacteristics();
      if (BLE_DEBUG) await this.dumpGatt(device);
      if (this.config.setup) {
        bleLog(`${this.config.label}: running setup (auth / enable stream)…`);
        await this.config.setup(device);
      }

      const target = this.config.notify ?? (await this.pickNotifiable(device));
      if (!target) throw new Error('no notifiable characteristic found');
      bleLog(`${this.config.label}: subscribing → svc ${target.service} char ${target.characteristic}`);

      this.info = { ...this.info, id: device.id, name: device.name ?? this.config.label };
      this.notifCount = 0;
      this.monitorSub = device.monitorCharacteristicForService(
        target.service,
        target.characteristic,
        (err, characteristic) => {
          if (err) {
            bleLog(`${this.config.label}: notify error:`, err.message);
            return;
          }
          if (characteristic?.value) this.handleValue(characteristic.value, 'notify');
        },
      );
      this.connecting = false;
      bleLog(`${this.config.label}: subscription active — waiting for notifications…`);

      if (this.config.poll) this.startPolling(device, target, this.config.poll.intervalMs);
    } catch (e) {
      bleLog(`${this.config.label}: connect failed:`, e instanceof Error ? e.message : String(e));
      this.connecting = false;
      this.handleDropped();
    }
  }

  /** Decode + emit a single characteristic value (from notify or poll). */
  private handleValue(value: string, source: 'notify' | 'read'): void {
    this.notifCount += 1;
    const reading = this.config.decode(value);
    // Log the first 20 values in full, then every 20th, so we see the raw wire
    // bytes and whether the decoder accepts them.
    if (BLE_DEBUG && (this.notifCount <= 20 || this.notifCount % 20 === 0)) {
      bleLog(
        `${this.config.label}: ${source}#${this.notifCount} hex=${b64ToHex(value)} → ${reading ? JSON.stringify(reading) : 'DECODE=null'}`,
      );
    }
    if (!reading) return;
    if (reading.batteryPct != null) this.info = { ...this.info, battery: reading.batteryPct };
    const sample: AccelSample = { t: this.clock(), x: reading.x, y: reading.y, z: reading.z };
    this.sampleListeners.forEach((l) => l(sample));
  }

  /** Poll a readable characteristic on an interval (for devices that don't push). */
  private startPolling(
    device: Device,
    target: { service: string; characteristic: string },
    intervalMs: number,
  ): void {
    bleLog(`${this.config.label}: polling ${target.characteristic} every ${intervalMs}ms`);
    let inFlight = false; // some devices never answer a read — don't stack them
    this.pollTimer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      device
        .readCharacteristicForService(target.service, target.characteristic)
        .then((ch) => {
          if (ch?.value) this.handleValue(ch.value, 'read');
        })
        .catch((e) => bleLog(`${this.config.label}: read error:`, e instanceof Error ? e.message : String(e)))
        .finally(() => {
          inFlight = false;
        });
    }, intervalMs);
  }

  /** Dump the full GATT table (services + characteristic properties) once. */
  private async dumpGatt(device: Device): Promise<void> {
    try {
      const services = await device.services();
      bleLog(`${this.config.label}: discovered ${services.length} services:`);
      for (const service of services) {
        const chars = await service.characteristics();
        const list = chars
          .map((c) => {
            const props =
              (c.isReadable ? 'R' : '') +
              (c.isWritableWithResponse ? 'W' : '') +
              (c.isWritableWithoutResponse ? 'w' : '') +
              (c.isNotifiable ? 'N' : '') +
              (c.isIndicatable ? 'I' : '');
            return `${c.uuid}[${props || '-'}]`;
          })
          .join(' ');
        bleLog(`  svc ${service.uuid}: ${list || '(no characteristics)'}`);
      }
    } catch (e) {
      bleLog(`${this.config.label}: dumpGatt failed:`, e instanceof Error ? e.message : String(e));
    }
  }

  /** Generic fallback: first notifiable/indicatable characteristic discovered. */
  private async pickNotifiable(
    device: Device,
  ): Promise<{ service: string; characteristic: string } | null> {
    const services = await device.services();
    for (const service of services) {
      const characteristics = await service.characteristics();
      const notifiable = characteristics.find((c) => c.isNotifiable || c.isIndicatable);
      if (notifiable) return { service: service.uuid, characteristic: notifiable.uuid };
    }
    return null;
  }

  private handleDropped(): void {
    this.teardownLink();
    this.disconnectListeners.forEach((l) => l());
    if (this.stopped) return;
    // Back off before re-scanning so a peripheral that's out of range or
    // rejecting connections doesn't spin the radio (and trip scan throttling).
    if (this.reconnectTimer) return;
    bleLog(`${this.config.label}: re-scanning in ${RECONNECT_DELAY_MS}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connecting = false;
      this.seenIds.clear();
      this.beginScan();
    }, RECONNECT_DELAY_MS);
  }

  private teardownLink(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.monitorSub?.remove();
    this.monitorSub = null;
    this.disconnectSub?.remove();
    this.disconnectSub = null;
    this.device = null;
  }

  onSample(listener: (sample: AccelSample) => void): () => void {
    this.sampleListeners.add(listener);
    return () => this.sampleListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  // Streaming mode / rate are driven by the config's setup writes (if any), so
  // these stay no-ops to satisfy the SensorConnection contract.
  async setFishingMode(): Promise<void> {
    /* no-op: configured via config.setup */
  }

  async setSampleRate(): Promise<void> {
    /* no-op: configured on-device */
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.scanning = false;
    this.connecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      getBleManager().stopDeviceScan();
    } catch {
      /* manager may be gone */
    }
    const device = this.device;
    this.teardownLink();
    if (device) {
      try {
        await device.cancelConnection();
      } catch {
        /* already disconnected */
      }
    }
    this.sampleListeners.clear();
    this.disconnectListeners.clear();
  }
}
