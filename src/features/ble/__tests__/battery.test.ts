import {
  BATTERY_CRITICAL_PCT,
  BATTERY_LEVEL_CHAR_UUID,
  BATTERY_LOW_PCT,
  BATTERY_SERVICE_UUID,
  batteryState,
  decodeBatteryLevel,
  encodeBatteryLevel,
  isBatteryConcerning,
} from '../battery';

describe('service identifiers', () => {
  it('uses the 128-bit forms react-native-ble-plx expects', () => {
    // The 16-bit shorthand (0x180F) is not accepted by the library's lookups.
    expect(BATTERY_SERVICE_UUID).toBe('0000180f-0000-1000-8000-00805f9b34fb');
    expect(BATTERY_LEVEL_CHAR_UUID).toBe('00002a19-0000-1000-8000-00805f9b34fb');
  });
});

describe('decodeBatteryLevel', () => {
  it('round-trips every valid percentage', () => {
    for (const pct of [0, 1, 10, 25, 50, 87, 99, 100]) {
      expect(decodeBatteryLevel(encodeBatteryLevel(pct))).toBe(pct);
    }
  });

  it('returns null for absent or empty values', () => {
    expect(decodeBatteryLevel(null)).toBeNull();
    expect(decodeBatteryLevel(undefined)).toBeNull();
    expect(decodeBatteryLevel('')).toBeNull();
  });

  it('rejects a byte outside 0–100 rather than reporting nonsense', () => {
    // A bogus "197%" on a rod card is worse than no reading: the user stops
    // trusting the field entirely.
    expect(decodeBatteryLevel(encodeBatteryLevel(100))).toBe(100);
    const overRange = globalThis.btoa(String.fromCharCode(197));
    expect(decodeBatteryLevel(overRange)).toBeNull();
  });

  it('survives undecodable base64 without throwing', () => {
    // This runs inside a BLE callback, where a throw would be swallowed at best.
    expect(() => decodeBatteryLevel('!!!not base64!!!')).not.toThrow();
  });

  it('reads only the first byte, ignoring trailing data', () => {
    const padded = globalThis.btoa(String.fromCharCode(42, 99, 7));
    expect(decodeBatteryLevel(padded)).toBe(42);
  });
});

describe('batteryState', () => {
  it('classifies the three bands', () => {
    expect(batteryState(100)).toBe('ok');
    expect(batteryState(BATTERY_LOW_PCT + 1)).toBe('ok');
    expect(batteryState(BATTERY_LOW_PCT)).toBe('low');
    expect(batteryState(BATTERY_CRITICAL_PCT + 1)).toBe('low');
    expect(batteryState(BATTERY_CRITICAL_PCT)).toBe('critical');
    expect(batteryState(0)).toBe('critical');
  });

  it('keeps the thresholds ordered', () => {
    expect(BATTERY_CRITICAL_PCT).toBeLessThan(BATTERY_LOW_PCT);
  });

  it('never reports ok at or below the low threshold', () => {
    for (let p = 0; p <= BATTERY_LOW_PCT; p++) {
      expect(batteryState(p)).not.toBe('ok');
    }
  });
});

describe('isBatteryConcerning', () => {
  it('is true only in the low and critical bands', () => {
    expect(isBatteryConcerning(100)).toBe(false);
    expect(isBatteryConcerning(BATTERY_LOW_PCT)).toBe(true);
    expect(isBatteryConcerning(0)).toBe(true);
  });

  it('is false when the level is unknown', () => {
    // Most sensors omit the Battery Service; "unknown" must not read as "flat".
    expect(isBatteryConcerning(null)).toBe(false);
    expect(isBatteryConcerning(undefined)).toBe(false);
  });
});
