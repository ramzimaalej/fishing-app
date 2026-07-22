import type { Subscription } from 'react-native-ble-plx';
import type { BleManager, Device } from 'react-native-ble-plx';

import type { AccelSample } from '@/types';

import { getBleManager } from './bleManager';
import {
  ACCEL_CHAR_UUID,
  CONTROL_CHAR_UUID,
  ControlCommand,
  FISHON_SERVICE_UUID,
  encodeControlCommand,
  parseAccelPacket,
} from './protocol';
import type { BleDeviceInfo, SensorConnection } from './types';

/** Exponential backoff schedule (ms) for auto-reconnect attempts. */
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

/**
 * react-native-ble-plx-backed sensor connection with transparent
 * auto-reconnect. The same client object survives dropped links: on an
 * unexpected disconnect it walks the backoff schedule, re-connects, and
 * re-subscribes to the accelerometer characteristic. Consumers keep their
 * `onSample` subscription across reconnects.
 */
export class BleSensorClient implements SensorConnection {
  readonly info: BleDeviceInfo;

  private readonly manager: BleManager;
  private device: Device;
  private monitorSub: Subscription | null = null;
  private disconnectSub: Subscription | null = null;

  private sampleListeners = new Set<(s: AccelSample) => void>();
  private disconnectListeners = new Set<() => void>();

  private intentionalDisconnect = false;
  private reconnecting = false;

  private constructor(manager: BleManager, device: Device) {
    this.manager = manager;
    this.device = device;
    this.info = { id: device.id, name: device.name ?? 'FishOn Sensor' };
  }

  /** Connect to a device id, discover services, and start streaming. */
  static async connect(deviceId: string): Promise<BleSensorClient> {
    const manager = getBleManager();
    const connected = await manager.connectToDevice(deviceId, { requestMTU: 185 });
    await connected.discoverAllServicesAndCharacteristics();
    const client = new BleSensorClient(manager, connected);
    client.attachDisconnectHandler();
    client.startMonitoring();
    return client;
  }

  private attachDisconnectHandler(): void {
    this.disconnectSub?.remove();
    this.disconnectSub = this.device.onDisconnected(() => {
      this.monitorSub?.remove();
      this.monitorSub = null;
      this.disconnectListeners.forEach((l) => l());
      if (!this.intentionalDisconnect) void this.attemptReconnect();
    });
  }

  private startMonitoring(): void {
    this.monitorSub?.remove();
    this.monitorSub = this.device.monitorCharacteristicForService(
      FISHON_SERVICE_UUID,
      ACCEL_CHAR_UUID,
      (error, characteristic) => {
        if (error || !characteristic?.value) return;
        const samples = parseAccelPacket(characteristic.value);
        for (const s of samples) this.sampleListeners.forEach((l) => l(s));
      },
    );
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnecting || this.intentionalDisconnect) return;
    this.reconnecting = true;
    for (const delay of RECONNECT_DELAYS_MS) {
      if (this.intentionalDisconnect) break;
      await new Promise((r) => setTimeout(r, delay));
      try {
        const reconnected = await this.manager.connectToDevice(this.info.id, { requestMTU: 185 });
        await reconnected.discoverAllServicesAndCharacteristics();
        this.device = reconnected;
        this.attachDisconnectHandler();
        this.startMonitoring();
        this.reconnecting = false;
        return;
      } catch {
        // try the next (longer) backoff delay
      }
    }
    this.reconnecting = false;
  }

  onSample(listener: (sample: AccelSample) => void): () => void {
    this.sampleListeners.add(listener);
    return () => this.sampleListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  async setFishingMode(enabled: boolean): Promise<void> {
    await this.writeControl(ControlCommand.SET_FISHING_MODE, enabled ? 1 : 0);
  }

  async setSampleRate(hz: number): Promise<void> {
    await this.writeControl(ControlCommand.SET_SAMPLE_RATE, Math.max(1, Math.min(255, hz)));
  }

  private async writeControl(command: number, payload: number): Promise<void> {
    try {
      await this.device.writeCharacteristicWithResponseForService(
        FISHON_SERVICE_UUID,
        CONTROL_CHAR_UUID,
        encodeControlCommand(command, payload),
      );
    } catch {
      // Control writes are best-effort; a dropped link will auto-reconnect.
    }
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.monitorSub?.remove();
    this.disconnectSub?.remove();
    this.sampleListeners.clear();
    try {
      await this.manager.cancelDeviceConnection(this.info.id);
    } catch {
      // already gone
    }
    this.disconnectListeners.clear();
  }
}
