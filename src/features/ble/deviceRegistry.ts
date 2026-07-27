import { Cp27SensorClient } from './Cp27SensorClient';
import { GenericSensorClient } from './GenericSensorClient';
import { MinewSensorClient } from './MinewSensorClient';
import { MockSensor } from './MockSensor';
import type { ConnectionStatus, SensorConnection } from './types';

/** Which sensor implementation reads the accelerometer stream. */
export type SensorKind = 'mock' | 'minew' | 'cp27' | 'generic';

/** Per-instance options, so several rods can each own a distinct sensor. */
export interface CreateSensorOptions {
  /**
   * The specific device to bind to — a MAC for broadcast tags, a peripheral id
   * for GATT. Required whenever more than one rod of the same kind is armed;
   * without it two clients would converge on the same physical sensor.
   */
  deviceId?: string | null;
  /** Distinguishes simulator instances from each other in the UI. */
  instanceLabel?: string;
}

/**
 * One selectable device type. The registry is the single place that maps a
 * user's choice to a concrete SensorConnection and describes how it connects,
 * so the connection flow stays device-agnostic.
 */
export interface SensorDeviceType {
  kind: SensorKind;
  /** Full name for the selector card. */
  label: string;
  /** Short label for a compact chip. */
  short: string;
  /** One-line explanation shown under the selector. */
  description: string;
  /** Needs BLE permission + a powered-on adapter before connecting. */
  requiresBle: boolean;
  /**
   * True when a rod of this kind MUST be bound to a specific device before it
   * can be armed. False only for the simulator, which generates its own signal.
   */
  requiresDeviceBinding: boolean;
  /** True when this kind is discovered by scanning for broadcasts. */
  discoverable: boolean;
  /**
   * Status to display while the link is being established. 'connected' means it
   * streams immediately (the mock); 'scanning'/'connecting' flip to 'connected'
   * on the first sample.
   */
  initialStatus: Extract<ConnectionStatus, 'connected' | 'scanning' | 'connecting'>;
  create(opts?: CreateSensorOptions): SensorConnection;
}

export const SENSOR_DEVICES: Record<SensorKind, SensorDeviceType> = {
  mock: {
    kind: 'mock',
    label: 'Simulator',
    short: 'Simulator',
    description: 'Built-in signal generator — try the app with no hardware.',
    requiresBle: false,
    requiresDeviceBinding: false,
    discoverable: false,
    initialStatus: 'connected',
    create: (opts) => new MockSensor(undefined, opts?.instanceLabel),
  },
  minew: {
    kind: 'minew',
    label: 'Minew E8S',
    short: 'Minew',
    description: 'Asset Tag E8S — broadcasts accelerometer data, no pairing.',
    requiresBle: true,
    requiresDeviceBinding: true,
    discoverable: true,
    initialStatus: 'scanning',
    create: (opts) => new MinewSensorClient(opts?.deviceId ?? null),
  },
  cp27: {
    kind: 'cp27',
    label: 'DX-CP27MINI',
    short: 'CP27',
    description: 'DX-SMART beacon — connects over BLE (experimental).',
    requiresBle: true,
    requiresDeviceBinding: true,
    discoverable: false,
    initialStatus: 'connecting',
    create: (opts) => new Cp27SensorClient(opts?.deviceId ?? null),
  },
  generic: {
    kind: 'generic',
    label: 'Generic BLE sensor',
    short: 'Generic',
    description: 'Any sensor that streams accel on a notify characteristic.',
    requiresBle: true,
    requiresDeviceBinding: true,
    discoverable: false,
    initialStatus: 'connecting',
    create: (opts) => new GenericSensorClient(opts?.deviceId ?? null),
  },
};

/** Registry order — also the order shown in the selector. */
export const SENSOR_KINDS: readonly SensorKind[] = ['mock', 'minew', 'cp27', 'generic'];

export function listSensorDevices(): SensorDeviceType[] {
  return SENSOR_KINDS.map((k) => SENSOR_DEVICES[k]);
}

export function getSensorDevice(kind: SensorKind): SensorDeviceType {
  return SENSOR_DEVICES[kind];
}
