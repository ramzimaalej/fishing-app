import type { EnvironmentSnapshot } from '@/types';

/**
 * Turning a forecast hour into a real instant — pure and testable.
 *
 * Open-Meteo is queried with `timezone=auto`, so `time` is a NAIVE local string
 * for the FISHING LOCATION ("2026-07-30T14:00"), with no offset. JavaScript
 * parses such a string in the *device's* zone, which silently equates the two.
 *
 * That was harmless while every forecast used one hardcoded coordinate. As soon
 * as a user can pin a remote city it is a real bug: picking Bizerte from a phone
 * in California would have matched "now" to an hour eleven off, so the Conditions
 * card would show the wrong part of the day.
 *
 * `utcOffsetSeconds` (from the API's `utc_offset_seconds`) is what resolves it.
 */

/** True UTC epoch ms for a snapshot's hour. */
export function instantOf(snapshot: EnvironmentSnapshot): number {
  // Appending Z forces UTC parsing, then the location's offset is removed to
  // recover the actual instant. Local 14:00 at UTC+1 is 13:00 UTC.
  const asUtc = Date.parse(`${snapshot.time}Z`);
  if (Number.isNaN(asUtc)) return NaN;
  const offset = snapshot.utcOffsetSeconds;
  // No offset (older cached data) → fall back to device-local parsing, which is
  // exactly the old behaviour and correct whenever the zones happen to agree.
  if (offset === undefined) return new Date(snapshot.time).getTime();
  return asUtc - offset * 1000;
}

/**
 * Index of the hour nearest `now`, or -1 for an empty series.
 * Compares true instants, so it is correct for a location in any timezone.
 */
export function nearestHourIndex(
  hourly: readonly EnvironmentSnapshot[],
  now: number = Date.now(),
): number {
  let best = -1;
  let bestDelta = Infinity;
  for (let i = 0; i < hourly.length; i++) {
    const instant = instantOf(hourly[i]!);
    if (Number.isNaN(instant)) continue;
    const delta = Math.abs(instant - now);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}
