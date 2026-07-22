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
 * Transport-agnostic contract for a bite sensor source. The real Minew E8S
 * client (broadcast/scan-based) and the mock both implement it, so the rest of
 * the app never depends on react-native-ble-plx directly.
 *
 * NOTE: the E8S is a broadcast beacon, not a connected peripheral — "samples"
 * are parsed from its advertisements. setFishingMode/setSampleRate are no-ops
 * for the E8S (it is configured on-device via Minew BeaconSET+); they remain in
 * the contract so a future connectable sensor can implement them.
 */
export interface SensorConnection {
  readonly info: BleDeviceInfo;
  /** Subscribe to the accelerometer stream. Returns an unsubscribe fn. */
  onSample(listener: (sample: AccelSample) => void): () => void;
  /** Enable/disable fishing (live-bait) mode on the device (if supported). */
  setFishingMode(enabled: boolean): Promise<void>;
  setSampleRate(hz: number): Promise<void>;
  /** Fired when the stream goes stale (before it seamlessly resumes). */
  onDisconnect(listener: () => void): () => void;
  disconnect(): Promise<void>;
}
