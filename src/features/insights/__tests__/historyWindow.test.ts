import { ERA5_LAG_DAYS } from '@/features/environment/openMeteo';

import {
  analysisWindow,
  INSIGHTS_WINDOW_DAYS,
  isWithinEra5Lag,
  oldestTimestamp,
} from '../historyWindow';

const DAY = 86_400_000;
const NOW = new Date(2026, 6, 27, 15, 30, 0); // 27 Jul 2026, mid-afternoon

/** Local midnight `n` days before NOW. */
const midnightBefore = (n: number) =>
  new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - n);

describe('analysisWindow', () => {
  it('ends at the ERA5 cutoff, not today', () => {
    const w = analysisWindow(null, NOW);
    expect(w.to.getTime()).toBe(midnightBefore(ERA5_LAG_DAYS).getTime());
  });

  it('starts at the oldest bite when that is inside the cap', () => {
    const oldest = midnightBefore(30).getTime() + 9 * 3_600_000; // 30 days ago, 09:00
    const w = analysisWindow(oldest, NOW);
    // Truncated to local midnight of that day.
    expect(w.from.getTime()).toBe(midnightBefore(30).getTime());
    expect(w.valid).toBe(true);
  });

  it('clamps to INSIGHTS_WINDOW_DAYS for a long history', () => {
    const ancient = midnightBefore(5 * 365).getTime();
    const w = analysisWindow(ancient, NOW);
    expect(w.from.getTime()).toBe(midnightBefore(INSIGHTS_WINDOW_DAYS).getTime());
  });

  it('falls back to the full cap when there are no bites', () => {
    const w = analysisWindow(null, NOW);
    expect(w.from.getTime()).toBe(midnightBefore(INSIGHTS_WINDOW_DAYS).getTime());
  });

  it('is invalid when every bite is inside the ERA5 lag', () => {
    // A user who started fishing yesterday has nothing analysable yet.
    const w = analysisWindow(midnightBefore(1).getTime(), NOW);
    expect(w.valid).toBe(false);
  });

  it('is valid when the oldest bite sits exactly on the cutoff', () => {
    const w = analysisWindow(midnightBefore(ERA5_LAG_DAYS).getTime(), NOW);
    expect(w.valid).toBe(true);
    expect(w.from.getTime()).toBe(w.to.getTime());
  });

  it('always produces from <= to when valid', () => {
    for (const days of [0, 1, ERA5_LAG_DAYS, 10, 100, INSIGHTS_WINDOW_DAYS, 1000]) {
      const w = analysisWindow(midnightBefore(days).getTime(), NOW);
      if (w.valid) expect(w.from.getTime()).toBeLessThanOrEqual(w.to.getTime());
    }
  });

  it('uses local midnight, so the window never depends on the time of day', () => {
    const morning = new Date(2026, 6, 27, 0, 5, 0);
    const night = new Date(2026, 6, 27, 23, 55, 0);
    const a = analysisWindow(null, morning);
    const b = analysisWindow(null, night);
    expect(a.from.getTime()).toBe(b.from.getTime());
    expect(a.to.getTime()).toBe(b.to.getTime());
  });
});

describe('oldestTimestamp', () => {
  it('finds the minimum', () => {
    expect(oldestTimestamp([{ timestamp: 500 }, { timestamp: 100 }, { timestamp: 900 }])).toBe(100);
  });

  it('is null for an empty list', () => {
    expect(oldestTimestamp([])).toBeNull();
  });

  it('handles a single record', () => {
    expect(oldestTimestamp([{ timestamp: 42 }])).toBe(42);
  });
});

describe('isWithinEra5Lag', () => {
  it('is true for a bite from today', () => {
    expect(isWithinEra5Lag(NOW.getTime(), NOW)).toBe(true);
  });

  it('is false for a bite well before the cutoff', () => {
    expect(isWithinEra5Lag(NOW.getTime() - (ERA5_LAG_DAYS + 2) * DAY, NOW)).toBe(false);
  });

  it('is false exactly at the cutoff midnight', () => {
    expect(isWithinEra5Lag(midnightBefore(ERA5_LAG_DAYS).getTime(), NOW)).toBe(false);
  });
});
