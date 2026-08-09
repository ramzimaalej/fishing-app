/**
 * Rod model — pure, so the rules are testable without a store, a subscription,
 * or a Bluetooth adapter.
 *
 * A "rod" is a named pairing of a physical rod with a sensor. It is the unit the
 * user thinks in ("left rod just went off") and the unit a BiteDetector runs per.
 *
 * ROD COUNT IS NOT A PAID FEATURE, deliberately. An angler fishing three rods
 * needs three sensors, and sensors are the high-margin product — so gating rod
 * count would put a paywall between the customer and hardware they have already
 * bought from us, throttling the upsell it was meant to monetise. Rod count also
 * costs us nothing marginally, unlike the things Premium does gate (API calls,
 * cloud storage). MAX_RODS is a practical ceiling, not a commercial one.
 */

import { MAX_RODS } from '@/config/constants';
import { ROD_COLOUR_KEYS, type RodColour } from '@/theme';
import {
  DEFAULT_SENSOR_KIND,
  isSensorKind,
  type SensorKind,
} from '@/features/ble/deviceRegistry';

export interface Rod {
  id: string;
  /** User-facing name, e.g. "Left rod". Never empty (see normaliseRodName). */
  name: string;
  sensorKind: SensorKind;
  /**
   * Specific device this rod is bound to (a MAC for broadcast tags, a peripheral
   * id for GATT). Null means "not paired yet" — the rod exists but cannot be
   * armed, because an unbound broadcast rod would lock onto whichever tag it saw
   * first and two such rods would fight over the same tag.
   */
  deviceId: string | null;
  /** Whether the user wants this rod armed when they start monitoring. */
  enabled: boolean;
  /**
   * Identity colour, so rods are told apart at a glance rather than by reading.
   * On the bank the question is "which rod just went off", and a name in small
   * type on a crowded strip is a slow answer.
   */
  colour: RodColour;
  createdAt: number;
}

export type AddRodRefusal = 'max-rods';

export interface AddRodVerdict {
  allowed: boolean;
  /** Why not, when disallowed. */
  reason?: AddRodRefusal;
}

/**
 * Whether another rod may be added. The only refusal is the hard ceiling, which
 * paying cannot lift — so the UI must never offer the paywall here.
 */
export function canAddRod(currentCount: number): AddRodVerdict {
  if (currentCount >= MAX_RODS) return { allowed: false, reason: 'max-rods' };
  return { allowed: true };
}

/**
 * Rods that may actually be armed for a session: the ones the user switched on,
 * capped at the practical ceiling. Order is stable (creation order).
 */
export function activeRods(rods: readonly Rod[]): Rod[] {
  return rods.filter((r) => r.enabled).slice(0, MAX_RODS);
}

/**
 * The least-used colour, so a new rod is as distinguishable as possible.
 *
 * Least-used rather than round-robin by index: after deleting and re-adding rods
 * an index-based scheme happily assigns a colour already on screen, which is the
 * one thing it exists to avoid.
 */
export function nextRodColour(existing: readonly RodColour[]): RodColour {
  const counts = new Map<RodColour, number>(ROD_COLOUR_KEYS.map((k) => [k, 0]));
  for (const c of existing) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best = ROD_COLOUR_KEYS[0]!;
  for (const key of ROD_COLOUR_KEYS) {
    if ((counts.get(key) ?? 0) < (counts.get(best) ?? 0)) best = key;
  }
  return best;
}

/** Trim and fall back, so a rod can never end up with a blank name. */
export function normaliseRodName(input: string, fallbackIndex: number): string {
  const trimmed = input.trim();
  if (trimmed.length > 0) return trimmed.slice(0, 40);
  return defaultRodName(fallbackIndex);
}

/**
 * Untranslated fallback name for the nth rod.
 *
 * This module stays pure and i18n-free on purpose. Rod names are PERSISTED and
 * user-editable, so the localised default is produced once at creation time by
 * rodStore (which already has side effects) — not here, and not at render time,
 * which would silently rewrite a name the user had accepted.
 */
export function defaultRodName(index: number): string {
  return `Rod ${index + 1}`;
}

/**
 * True when this rod can stream. A broadcast sensor needs a bound device; the
 * simulator does not, since it generates its own signal.
 */
export function isRodArmable(rod: Rod, requiresDevice: boolean): boolean {
  return !requiresDevice || rod.deviceId !== null;
}

/**
 * Rescue a rod whose sensor kind this build does not define.
 *
 * Rods are persisted, so an upgrading user can hold a kind that no longer exists
 * ('minew', 'cp27', 'generic'). Left alone, `getSensorDevice` has nothing to
 * return and arming the rod throws on the first property access — a crash on the
 * Fishing tab, which is why this runs on every rehydrate and not only on a
 * version bump.
 *
 * Bindings are kept ONLY where they still mean something. A 'minew' rod was
 * bound to the MAC read out of the tag's own advertisement, which is exactly what
 * the Castmate G spec keys on, so it still resolves to the same physical tag. A
 * 'cp27' or 'generic' rod was bound to a platform peripheral id from a GATT
 * connection; compared against a MAC that never matches, the rod would look like
 * a dead sensor rather than an unpaired one, so those are cleared and the user is
 * asked to pair again.
 *
 * Idempotent, and it leaves any CURRENTLY VALID kind alone — including 'mock'.
 * Retiring the simulator is a one-time step; see retireSimulatorRod.
 */
export function normaliseRodSensorKind(rod: Rod): Rod {
  // Colour was added after rods were already persisted, so a stored rod may have
  // none. Assigned here rather than defaulted at render time, because it is
  // identity: a rod whose colour changed between launches would be worse than
  // one with no colour at all.
  const withColour: Rod =
    rod.colour && ROD_COLOUR_KEYS.includes(rod.colour)
      ? rod
      : { ...rod, colour: ROD_COLOUR_KEYS[0]! };

  if (isSensorKind(withColour.sensorKind)) return withColour;

  const keepsBinding = (withColour.sensorKind as string) === 'minew';
  return {
    ...withColour,
    sensorKind: DEFAULT_SENSOR_KIND,
    deviceId: keepsBinding ? withColour.deviceId : null,
  };
}

/**
 * Move a rod off the simulator — ONE TIME ONLY, on the version bump.
 *
 * 'mock' used to be the default kind for every rod this app created, so a stored
 * simulator rod overwhelmingly means "never configured" rather than a deliberate
 * choice. Now that the simulator is dev-only and the sensor picker is hidden from
 * customers, leaving those rods alone would strand every existing user on
 * invented data with no visible way out.
 *
 * This must NOT run on every rehydrate: a developer who picks the simulator in
 * admin mode would have the choice silently reverted on the next launch. That is
 * why it is separate from normaliseRodSensorKind rather than folded into it.
 */
export function retireSimulatorRod(rod: Rod): Rod {
  if (rod.sensorKind !== 'mock') return rod;
  // A simulator rod has no binding to preserve — it never had a device.
  return { ...rod, sensorKind: DEFAULT_SENSOR_KIND, deviceId: null };
}

/** Every-launch normalisation: rescue unknown kinds, change nothing else. */
export function normaliseRods(rods: readonly Rod[]): Rod[] {
  return rods.map(normaliseRodSensorKind);
}

/** One-time upgrade from the multi-device build. */
export function migrateRods(rods: readonly Rod[]): Rod[] {
  return rods.map((r) => retireSimulatorRod(normaliseRodSensorKind(r)));
}
