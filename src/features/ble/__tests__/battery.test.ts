import {
  BATTERY_CRITICAL_PCT,
  BATTERY_LOW_PCT,
  BATTERY_READING_FRESH_MS,
  batteryState,
  decodeBatteryLevel,
  encodeBatteryLevel,
  isBatteryConcerning,
  isBatteryReadingStale,
} from '../battery';

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
    // A bogus "197%" is worse than no reading: this is the field someone uses to
    // decide whether a tag will last the session, so a wrong number costs them
    // a trip. Null renders as "not read yet".
    const overRange = globalThis.btoa(String.fromCharCode(197));
    expect(decodeBatteryLevel(overRange)).toBeNull();
  });

  it('survives undecodable base64 without throwing', () => {
    expect(() => decodeBatteryLevel('!!!not base64!!!')).not.toThrow();
    expect(decodeBatteryLevel('!!!not base64!!!')).toBeNull();
  });

  it('reads only the first byte, ignoring trailing data', () => {
    const padded = globalThis.btoa(String.fromCharCode(42, 99, 7));
    expect(decodeBatteryLevel(padded)).toBe(42);
  });
});

describe('isBatteryReadingStale', () => {
  const NOW = 1_700_000_000_000;

  it('treats a never-read battery as stale', () => {
    expect(isBatteryReadingStale(null, NOW)).toBe(true);
  });

  it('keeps a recent reading fresh', () => {
    expect(isBatteryReadingStale(NOW - 60_000, NOW)).toBe(false);
    expect(isBatteryReadingStale(NOW - BATTERY_READING_FRESH_MS, NOW)).toBe(false);
  });

  it('stales a reading older than the window', () => {
    expect(isBatteryReadingStale(NOW - BATTERY_READING_FRESH_MS - 1, NOW)).toBe(true);
  });

  it('stays fresh across a whole session', () => {
    // Readings are connection snapshots, not live, so the window has to outlast
    // a session or a pre-trip reading would read as stale by the end of it.
    expect(BATTERY_READING_FRESH_MS).toBeGreaterThanOrEqual(6 * 60 * 60 * 1000);
  });
});
