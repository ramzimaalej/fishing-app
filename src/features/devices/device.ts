/**
 * Paired-device model — pure, so the rules are testable without a radio.
 *
 * A DEVICE is a physical tag the user owns. A ROD is a fishing rod that may have
 * one bound to it. They are separate because they have separate lifecycles: a
 * tag can be paired, go flat, be swapped between rods, or be powered off, none
 * of which should destroy the rod's name, history or settings.
 *
 * Before this existed a rod held a bare MAC string and nothing else knew the tag
 * existed — so there was nowhere to record a battery level, a last-seen time, or
 * the fact that the user had deliberately switched a tag off.
 */

/** How the tag looks right now. */
export type DeviceStatus =
  /** Advertising, seen within the liveness window. */
  | 'live'
  /** Paired and known, but nothing heard recently. Flat, out of range, or off. */
  | 'stale'
  /** Paired but never heard from since the app started. */
  | 'never-seen'
  /** We asked it to power down and have not heard from it since. */
  | 'powered-off';

export interface PairedDevice {
  /** Full MAC, uppercase colon-separated. The identity everything keys on. */
  id: string;
  /** Advertised name, e.g. "CP27-C00C". */
  name: string;
  /** User-chosen label, e.g. "Left tag". Falls back to `name`. */
  label: string | null;
  pairedAt: number;
  /** Monotonic-independent wall clock of the last advertisement, or null. */
  lastSeenAt: number | null;
  /** Last RSSI, for a signal indicator. */
  rssi: number | null;
  /** 0..100 when the frame carries it; the 0xFEAB accel frame does not. */
  battery: number | null;
  /**
   * When we last sent a power-down command. Cleared the moment the tag is heard
   * again — a tag that is advertising is manifestly not off, whatever we asked.
   */
  poweredOffAt: number | null;
}

/**
 * Silence after which a tag counts as no longer live.
 *
 * The documented advertising interval runs to 1500 ms, and packets drop
 * unpredictably with no retries, so this has to tolerate a long run of misses.
 * Fifteen seconds is ten intervals at the slowest setting — long enough not to
 * flicker, short enough that a rod stops claiming to be watched promptly.
 */
export const DEVICE_LIVE_WINDOW_MS = 15_000;

export function deviceStatus(device: PairedDevice, nowMs: number): DeviceStatus {
  if (device.lastSeenAt === null) {
    return device.poweredOffAt !== null ? 'powered-off' : 'never-seen';
  }
  if (nowMs - device.lastSeenAt <= DEVICE_LIVE_WINDOW_MS) return 'live';

  // A power-down we requested explains the silence, and stays the explanation
  // until the tag is heard again. Reporting "stale" there would send the user
  // hunting for a fault they created deliberately.
  if (device.poweredOffAt !== null && device.poweredOffAt >= device.lastSeenAt) {
    return 'powered-off';
  }
  return 'stale';
}

/** Human label, preferring what the user called it. */
export function deviceLabel(device: PairedDevice): string {
  return device.label?.trim() || device.name || device.id;
}

/** Last four hex digits of the MAC — what is printed on the tag. */
export function deviceShortId(id: string): string {
  return id.replace(/[^0-9a-fA-F]/g, '').slice(-4).toUpperCase();
}

// ---------------------------------------------------------------------------
// Rod activity
// ---------------------------------------------------------------------------

/**
 * Whether a rod can actually fish, and why not when it cannot.
 *
 * Derived from the DEVICE rather than stored on the rod. A rod's readiness is
 * not a preference — it is a fact about whether a tag is bound and alive — and
 * storing it would let the two drift, so the UI could show a rod as ready while
 * its tag was flat.
 */
export type RodActivity =
  | 'active'
  /** No tag bound to this rod yet. */
  | 'unpaired'
  /** Tag bound but not advertising. */
  | 'device-silent'
  /** Tag deliberately powered down. */
  | 'device-off'
  /** The user switched this rod off themselves. */
  | 'disabled';

export interface RodActivityInput {
  /** The user's own on/off switch for the rod. */
  enabled: boolean;
  /** The bound device, or null when the rod has none. */
  device: PairedDevice | null;
}

/**
 * The user's switch wins over everything.
 *
 * Someone who turned a rod off means it, whatever its tag is doing — and a rod
 * that came back to life on its own because a tag woke up would arm sensors the
 * user had deliberately stood down.
 */
export function rodActivity(input: RodActivityInput, nowMs: number): RodActivity {
  if (!input.enabled) return 'disabled';
  if (!input.device) return 'unpaired';

  switch (deviceStatus(input.device, nowMs)) {
    case 'live':
      return 'active';
    case 'powered-off':
      return 'device-off';
    default:
      return 'device-silent';
  }
}

/** True when the rod is in a state worth arming. */
export function isRodActive(input: RodActivityInput, nowMs: number): boolean {
  return rodActivity(input, nowMs) === 'active';
}

// ---------------------------------------------------------------------------
// Pairing rules
// ---------------------------------------------------------------------------

export type PairRefusal = 'already-paired' | 'bound-elsewhere';

export interface PairVerdict {
  allowed: boolean;
  reason?: PairRefusal;
  /** Rod already holding this device, when that is why it was refused. */
  boundTo?: string;
}

/**
 * Whether a device may be bound to a rod.
 *
 * One device, one rod. Two rods sharing a tag would report one physical sensor
 * as two rods and both would alarm together — the same failure the broadcast
 * client's lock policy exists to prevent, caught earlier and with a name
 * attached so the message can say which rod already has it.
 */
export function canBindDevice(
  deviceId: string,
  rodId: string,
  rods: readonly { id: string; name: string; deviceId: string | null }[],
): PairVerdict {
  const holder = rods.find((r) => r.deviceId === deviceId);
  if (!holder) return { allowed: true };
  if (holder.id === rodId) return { allowed: false, reason: 'already-paired' };
  return { allowed: false, reason: 'bound-elsewhere', boundTo: holder.name };
}

/** Normalise a MAC or user-typed id to the canonical form. */
export function normaliseDeviceId(raw: string): string {
  const hex = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length !== 12) return raw.trim().toUpperCase();
  return (hex.match(/../g) ?? []).join(':');
}
