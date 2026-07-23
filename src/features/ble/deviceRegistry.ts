import { Cp27SensorClient } from './Cp27SensorClient';
import { GenericSensorClient } from './GenericSensorClient';
import { MinewSensorClient } from './MinewSensorClient';
import { MockSensor } from './MockSensor';
import type { ConnectionStatus, SensorConnection } from './types';

/** Which sensor implementation reads the accelerometer stream. */
export type SensorKind = 'mock' | 'minew' | 'cp27' | 'generic';

/**
 * One selectable device type. The registry is the single place that maps a
 * user's choice to a concrete SensorConnection and describes how it connects,
 * so the store's connect() flow stays device-agnostic.
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
   * Status to display while the link is being established. 'connected' means it
   * streams immediately (the mock); 'scanning'/'connecting' flip to 'connected'
   * on the first sample.
   */
  initialStatus: Extract<ConnectionStatus, 'connected' | 'scanning' | 'connecting'>;
  create(): SensorConnection;
}

export const SENSOR_DEVICES: Record<SensorKind, SensorDeviceType> = {
  mock: {
    kind: 'mock',
    label: 'Simulator',
    short: 'Simulator',
    description: 'Built-in signal generator — try the app with no hardware.',
    requiresBle: false,
    initialStatus: 'connected',
    create: () => new MockSensor(),
  },
  minew: {
    kind: 'minew',
    label: 'Minew E8S',
    short: 'Minew',
    description: 'Asset Tag E8S — broadcasts accelerometer data, no pairing.',
    requiresBle: true,
    initialStatus: 'scanning',
    create: () => new MinewSensorClient(),
  },
  cp27: {
    kind: 'cp27',
    label: 'DX-CP27MINI',
    short: 'CP27',
    description: 'DX-SMART beacon — connects over BLE (experimental).',
    requiresBle: true,
    initialStatus: 'connecting',
    create: () => new Cp27SensorClient(),
  },
  generic: {
    kind: 'generic',
    label: 'Generic BLE sensor',
    short: 'Generic',
    description: 'Any sensor that streams accel on a notify characteristic.',
    requiresBle: true,
    initialStatus: 'connecting',
    create: () => new GenericSensorClient(),
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
