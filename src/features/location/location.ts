/**
 * Fishing-location model and resolution — pure, so the rules are testable
 * without a GPS chip or a network.
 *
 * The app previously fetched every forecast for a hardcoded San Francisco Bay
 * coordinate, which meant an angler in Tunisia was shown Californian tides
 * without being told. The fix is not merely to read the GPS: it is to make the
 * location EXPLICIT, and to show nothing rather than something wrong when it
 * isn't known yet.
 */

import type { GeoCoords } from '@/types';

/** A place the user can fish, from the geocoder or from the device. */
export interface GeoPlace {
  /** Stable key for lists and persistence. */
  id: string;
  /** "Bizerte" */
  name: string;
  /** Region/state, when the geocoder supplies one. */
  admin1?: string;
  country?: string;
  /** ISO-3166 alpha-2, for a flag or disambiguation. */
  countryCode?: string;
  latitude: number;
  longitude: number;
  /** IANA zone, e.g. "Africa/Tunis". */
  timezone?: string;
}

/** Where the coordinates come from. */
export type LocationMode = 'device' | 'manual';

export type PermissionState = 'unknown' | 'granted' | 'denied';

export interface DeviceFix {
  coords: GeoCoords;
  /** Epoch ms the fix was obtained, so staleness can be shown or refreshed. */
  capturedAt: number;
}

/**
 * The coordinates actually in use, or null when unknown.
 *
 * Returning null is deliberate and load-bearing: every caller must then render a
 * prompt instead of a forecast. Falling back to a default coordinate is what
 * produced the silent wrong-continent bug.
 */
export function resolveCoords(
  mode: LocationMode,
  device: DeviceFix | null,
  manual: GeoPlace | null,
): GeoCoords | null {
  if (mode === 'manual') {
    return manual ? { latitude: manual.latitude, longitude: manual.longitude } : null;
  }
  return device ? device.coords : null;
}

/** True when a forecast can be requested at all. */
export function hasLocation(
  mode: LocationMode,
  device: DeviceFix | null,
  manual: GeoPlace | null,
): boolean {
  return resolveCoords(mode, device, manual) !== null;
}

/**
 * "Bizerte, Tunisia" — name plus the coarsest useful qualifier.
 *
 * Region is included only when it adds information: "Bizerte, Bizerte" reads as
 * a bug, and there are enough duplicate city names worldwide that country alone
 * is sometimes not enough to tell two results apart.
 */
export function formatPlace(place: GeoPlace): string {
  const parts = [place.name];
  if (place.admin1 && place.admin1 !== place.name) parts.push(place.admin1);
  if (place.country) parts.push(place.country);
  return parts.join(', ');
}

/** Rounded coordinate pair, for showing a device fix that has no name. */
export function formatCoords(coords: GeoCoords): string {
  const ns = coords.latitude >= 0 ? 'N' : 'S';
  const ew = coords.longitude >= 0 ? 'E' : 'W';
  return `${Math.abs(coords.latitude).toFixed(3)}°${ns} ${Math.abs(coords.longitude).toFixed(3)}°${ew}`;
}

/** How old a device fix may be before it is worth refreshing. */
export const FIX_STALE_MS = 30 * 60 * 1000;

export function isFixStale(fix: DeviceFix | null, now: number): boolean {
  return fix === null || now - fix.capturedAt > FIX_STALE_MS;
}
