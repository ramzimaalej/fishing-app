/**
 * Standard BLE Battery Service — pure decode + level classification, so both
 * are testable without a radio.
 *
 * Broadcast tags (Minew) carry battery inside their advertisement frame, so they
 * already report it. Connectable GATT sensors did NOT: `GattSensorClient` only
 * picked up battery when the device happened to embed it in its accel
 * notification, which neither the CP27 nor the generic decoder does. Since the
 * Battery Service is one of the most widely implemented GATT profiles, reading
 * it directly fills that gap for every connectable sensor.
 *
 * Spec: service 0x180F, characteristic 0x2A19 — a single uint8 percentage.
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
 * value, undecodable base64, or a byte outside 0–100. A bogus "197%" on a rod
 * card is worse than no reading, because the user would stop trusting the field.
 */
export function decodeBatteryLevel(base64: string | null | undefined): number | null {
  if (!base64) return null;
  let raw: string;
  try {
    // atob is available in Hermes; guard anyway so a decode failure can't throw
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
