import type { BroadcastSensorSpec } from './BroadcastSensorClient';
import {
  CASTMATE_G_KIND,
  CASTMATE_G_LABEL,
  CASTMATE_G_SHORT,
  CASTMATE_G_SPEC,
  CastmateGSensorClient,
} from './CastmateGSensorClient';
import { MockSensor } from './MockSensor';
import type { ConnectionStatus, SensorConnection } from './types';

/**
 * Which sensor implementation reads the accelerometer stream.
 *
 * ONE SHIPPING DEVICE. The app previously offered four selectable kinds (a
 * simulator, a Minew tag, a GATT CP27 and a "generic BLE sensor"), which was
 * scaffolding from the period when the hardware was not settled. Since revenue
 * comes from selling the sensor, the product is one device — asking a customer
 * which of four sensor protocols they own is a question only the developer can
 * answer.
 *
 * `mock` survives as a DEVELOPMENT kind, listed only when admin mode is unlocked
 * (see listSensorDevices). It is how detection, sessions and the ground-truth
 * capture tooling are exercised with no tag in range; deleting it would make the
 * app untestable without hardware.
 */
export type SensorKind = 'castmate-g' | 'mock';

/** Kinds that existed before the collapse to one device, for store migration. */
export type LegacySensorKind = 'minew' | 'cp27' | 'generic';

/** Per-instance options, so several rods can each own a distinct sensor. */
export interface CreateSensorOptions {
  /**
   * The specific device to bind to — the tag's MAC, read from its own frame.
   * Required whenever more than one rod is armed; without it two clients would
   * converge on the same physical sensor.
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
   * Frame spec for broadcast kinds — present exactly when `discoverable`.
   *
   * Shared by the streaming client and the pairing screen so both recognise a
   * tag by the same rule: adding a frame format should not require touching
   * pairing.
   */
  broadcast?: BroadcastSensorSpec;
  /** Hidden from the normal selector; shown only in admin mode. */
  devOnly?: boolean;
  /**
   * Status to display while the link is being established. 'connected' means it
   * streams immediately (the mock); 'scanning' flips to 'connected' on the first
   * sample.
   */
  initialStatus: Extract<ConnectionStatus, 'connected' | 'scanning' | 'connecting'>;
  create(opts?: CreateSensorOptions): SensorConnection;
}

export const SENSOR_DEVICES: Record<SensorKind, SensorDeviceType> = {
  'castmate-g': {
    kind: CASTMATE_G_KIND,
    label: CASTMATE_G_LABEL,
    short: CASTMATE_G_SHORT,
    description: 'Broadcasts accelerometer data — no pairing code needed.',
    requiresBle: true,
    requiresDeviceBinding: true,
    discoverable: true,
    broadcast: CASTMATE_G_SPEC,
    initialStatus: 'scanning',
    create: (opts) => new CastmateGSensorClient(opts?.deviceId ?? null),
  },
  mock: {
    kind: 'mock',
    label: 'Simulator',
    short: 'Simulator',
    description: 'Built-in signal generator — try the app with no hardware.',
    requiresBle: false,
    requiresDeviceBinding: false,
    discoverable: false,
    devOnly: true,
    initialStatus: 'connected',
    create: (opts) => new MockSensor(undefined, opts?.instanceLabel),
  },
};

/** The kind a new rod gets. */
export const DEFAULT_SENSOR_KIND: SensorKind = CASTMATE_G_KIND;

/** Registry order — also the order shown in the selector. */
export const SENSOR_KINDS: readonly SensorKind[] = ['castmate-g', 'mock'];

/**
 * Devices offered to the user.
 *
 * @param includeDevOnly true when admin mode is unlocked. Off by default so a
 *   caller that forgets to ask cannot leak the simulator into the product.
 */
export function listSensorDevices(includeDevOnly = false): SensorDeviceType[] {
  return SENSOR_KINDS.map((k) => SENSOR_DEVICES[k]).filter(
    (d) => includeDevOnly || !d.devOnly,
  );
}

/**
 * Look up a device type.
 *
 * Falls back to the shipping sensor rather than returning undefined: `kind`
 * comes from PERSISTED rod state, so the type signature is a claim about the
 * current build, not a guarantee about what is on disk. Rods are migrated on
 * rehydrate (see migrateRods), but a render that beat the migration — or storage
 * written by a build that is not this one — would otherwise crash on the first
 * property access instead of degrading to the one device that exists.
 */
export function getSensorDevice(kind: SensorKind): SensorDeviceType {
  return SENSOR_DEVICES[kind] ?? SENSOR_DEVICES[DEFAULT_SENSOR_KIND];
}

/** True for a kind this build still understands. */
export function isSensorKind(value: unknown): value is SensorKind {
  return typeof value === 'string' && value in SENSOR_DEVICES;
}
