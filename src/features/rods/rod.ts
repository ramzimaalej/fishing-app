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
import type { SensorKind } from '@/features/ble/deviceRegistry';

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
 * True when this rod can stream. Broadcast and GATT sensors both need a bound
 * device; the simulator does not, since it generates its own signal.
 */
export function isRodArmable(rod: Rod, requiresDevice: boolean): boolean {
  return !requiresDevice || rod.deviceId !== null;
}
