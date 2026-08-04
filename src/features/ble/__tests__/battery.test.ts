import {
  BATTERY_CRITICAL_PCT,
  BATTERY_LOW_PCT,
  batteryState,
  isBatteryConcerning,
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
