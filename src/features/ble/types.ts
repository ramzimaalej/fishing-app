import type { AccSample } from '@/features/detection/accSample';

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
  /** Battery level 0..100 — the Castmate G carries it in its advertisement. */
  battery?: number;
}

/**
 * Transport-agnostic contract for a bite sensor source. Every device kind
 * implements it (see deviceRegistry) so the rest of the app never depends on
 * react-native-ble-plx directly:
 *   - CastmateGSensorClient — the Castmate G CP27, the shipping sensor. A
 *     BroadcastSensorClient subclass: the tag advertises its reading rather than
 *     accepting a connection.
 *   - MockSensor        — in-app simulator, admin-only (no hardware)
 *
 * The GATT clients (Cp27SensorClient, GenericSensorClient, GattSensorClient) were
 * removed when the app collapsed to one device; setFishingMode/setSampleRate stay
 * in the contract because a future connectable revision could implement them,
 * and because MockSensor honours setSampleRate.
 *
 * NOTE: a broadcast tag is not a connected peripheral — "samples" are parsed
 * from advertisements, and its motion sensitivity and advertising interval are
 * configured on the device itself, so setFishingMode/setSampleRate are no-ops
 * for it.
 */
export interface SensorConnection {
  readonly info: BleDeviceInfo;
  /**
   * Begin scanning / connecting. Implementations that stream immediately (the
   * mock) don't need it, hence optional. The store calls it after permissions.
   */
  start?(): void;
  /**
   * Subscribe to the accelerometer stream. Returns an unsubscribe fn.
   *
   * Samples are milli-g, stamped with a MONOTONIC arrival time — see
   * detection/monotonicClock for why wall time is unusable here.
   */
  onSample(listener: (sample: AccSample) => void): () => void;
  /** Enable/disable fishing (live-bait) mode on the device (if supported). */
  setFishingMode(enabled: boolean): Promise<void>;
  setSampleRate(hz: number): Promise<void>;
  /** Fired when the stream goes stale (before it seamlessly resumes). */
  onDisconnect(listener: () => void): () => void;
  disconnect(): Promise<void>;
}
