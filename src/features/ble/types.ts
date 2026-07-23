import type { AccelSample } from '@/types';

export type ConnectionStatus =
  | 'idle'
  | 'poweredOff'
  | 'unauthorized'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface BleDeviceInfo {
  id: string;
  name: string;
  /** Battery level 0..100, when the sensor reports it (E8S does). */
  battery?: number;
}

/**
 * Transport-agnostic contract for a bite sensor source. Every device kind
 * implements it (see deviceRegistry) so the rest of the app never depends on
 * react-native-ble-plx directly:
 *   - MockSensor        — in-app simulator (no hardware)
 *   - MinewSensorClient — Minew E8S beacon, broadcast/scan-based
 *   - Cp27SensorClient  — DX-CP27MINI, GATT connect + notify
 *   - GenericSensorClient — any BLE peripheral streaming accel on a notify char
 *
 * NOTE: broadcast beacons (E8S) are not connected peripherals — "samples" are
 * parsed from advertisements. setFishingMode/setSampleRate are no-ops for
 * devices configured on-device (E8S via BeaconSET+); they remain in the
 * contract so connectable sensors can implement them.
 */
export interface SensorConnection {
  readonly info: BleDeviceInfo;
  /**
   * Begin scanning / connecting. Implementations that stream immediately (the
   * mock) don't need it, hence optional. The store calls it after permissions.
   */
  start?(): void;
  /** Subscribe to the accelerometer stream. Returns an unsubscribe fn. */
  onSample(listener: (sample: AccelSample) => void): () => void;
  /** Enable/disable fishing (live-bait) mode on the device (if supported). */
  setFishingMode(enabled: boolean): Promise<void>;
  setSampleRate(hz: number): Promise<void>;
  /** Fired when the stream goes stale (before it seamlessly resumes). */
  onDisconnect(listener: () => void): () => void;
  disconnect(): Promise<void>;
}
