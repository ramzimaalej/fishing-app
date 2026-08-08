/**
 * Battery level classification — pure, so it is testable without a radio.
 *
 * The Castmate G carries its battery percentage inside its advertisement frame,
 * so decoding it belongs to the frame decoder and this module only has to decide
 * what a percentage MEANS.
 *
 * The standard GATT Battery Service decode lives here too. It was removed with
 * the GATT clients and is back because the CP27 turns out to advertise NO
 * battery at all: three frame types were captured (accel, a short 0x61/0x62
 * identity frame, and a 0x56 device-info frame) and none carries an
 * identifiable level. 0x180F over a connection is the only trustworthy source.
 */

/** 128-bit forms, which is what react-native-ble-plx expects. */
export const BATTERY_SERVICE_UUID = '0000180f-0000-1000-8000-00805f9b34fb';
export const BATTERY_LEVEL_CHAR_UUID = '00002a19-0000-1000-8000-00805f9b34fb';

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


/**
 * Decode a Battery Level characteristic value (base64 → percent).
 *
 * Returns null rather than a wrong number for anything unexpected: an empty
 * value, undecodable base64, or a byte outside 0–100. A bogus "197%" on a tag
 * card is worse than no reading, because the user stops trusting the field —
 * and this is the field they will use to decide whether a tag will last a
 * session.
 */
export function decodeBatteryLevel(base64: string | null | undefined): number | null {
  if (!base64) return null;
  let raw: string;
  try {
    // atob is available in Hermes; guard anyway so a decode failure cannot throw
    // inside a BLE callback.
    raw = globalThis.atob ? globalThis.atob(base64) : '';
  } catch {
    return null;
  }
  if (raw.length === 0) return null;

  const percent = raw.charCodeAt(0);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  return percent;
}

/** Encode a percentage the way the characteristic would report it (tests/mock). */
export function encodeBatteryLevel(percent: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const raw = String.fromCharCode(clamped);
  return globalThis.btoa ? globalThis.btoa(raw) : '';
}

/**
 * How long a battery reading stays meaningful.
 *
 * Readings come from an on-demand CONNECTION, not the advertisement stream, so
 * they are snapshots rather than live. Six hours is long enough that a reading
 * taken before a session is still good at the end of it, short enough that a
 * days-old number is not presented as current.
 */
export const BATTERY_READING_FRESH_MS = 6 * 60 * 60 * 1000;

export function isBatteryReadingStale(readAtMs: number | null, nowMs: number): boolean {
  return readAtMs === null || nowMs - readAtMs > BATTERY_READING_FRESH_MS;
}
