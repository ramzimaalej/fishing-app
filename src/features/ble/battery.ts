/**
 * Battery level classification — pure, so it is testable without a radio.
 *
 * The Castmate G carries its battery percentage inside its advertisement frame,
 * so decoding it belongs to the frame decoder and this module only has to decide
 * what a percentage MEANS.
 *
 * This file used to also implement the standard GATT Battery Service (0x180F /
 * 0x2A19), which existed to fill a gap for connectable sensors: they reported
 * battery only if they happened to embed it in their accel notification. Those
 * clients were removed when the app collapsed to one broadcast device, so the
 * characteristic decode went with them rather than sitting here uncalled.
 */

/**
 * Battery health bands.
 *
 * `low` warns; `critical` means the sensor is about to stop watching a rod, and
 * a bite alarm that dies silently is the failure this app exists to prevent —
 * the same reasoning as the session-expiry warning.
 */
export type BatteryState = 'ok' | 'low' | 'critical';

export const BATTERY_LOW_PCT = 25;
export const BATTERY_CRITICAL_PCT = 10;

export function batteryState(percent: number): BatteryState {
  if (percent <= BATTERY_CRITICAL_PCT) return 'critical';
  if (percent <= BATTERY_LOW_PCT) return 'low';
  return 'ok';
}

/** True when the level warrants telling the user. */
export function isBatteryConcerning(percent: number | null | undefined): boolean {
  return percent != null && batteryState(percent) !== 'ok';
}

