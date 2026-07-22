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
}

/**
 * Transport-agnostic contract for a connected bite sensor. Both the real
 * BLE client and the mock implement it, so the rest of the app never depends
 * on react-native-ble-plx directly.
 */
export interface SensorConnection {
  readonly info: BleDeviceInfo;
  /** Subscribe to the accelerometer stream. Returns an unsubscribe fn. */
  onSample(listener: (sample: AccelSample) => void): () => void;
  /** Enable/disable fishing (live-bait) mode on the device. */
  setFishingMode(enabled: boolean): Promise<void>;
  setSampleRate(hz: number): Promise<void>;
  /** Fired when the underlying link drops (before auto-reconnect kicks in). */
  onDisconnect(listener: () => void): () => void;
  disconnect(): Promise<void>;
}
