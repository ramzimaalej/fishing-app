import { moonAgeDays } from '../moonPhase';
import {
  bestDays,
  monthOutlook,
  monthStartWeekday,
  ratingOf,
  solunarDayScore,
} from '../solunar';

const SYNODIC = 29.530588853;
const DAY_MS = 86_400_000;
const BASE = new Date(2026, 6, 1, 12, 0, 0);

/**
 * A date whose moon age is (approximately) `target` days. Derived from
 * moonAgeDays rather than hard-coded almanac dates, so the test tracks the
 * implementation's own epoch instead of duplicating it.
 */
function dateAtAge(target: number): Date {
  let delta = target - moonAgeDays(BASE);
  while (delta < 0) delta += SYNODIC;
  return new Date(BASE.getTime() + delta * DAY_MS);
}

const NEW_MOON = dateAtAge(0);
const FULL_MOON = dateAtAge(SYNODIC / 2);
const FIRST_QUARTER = dateAtAge(SYNODIC / 4);
/** Between a major and a minor period — the weakest part of the cycle. */
const TROUGH = dateAtAge(SYNODIC / 8);

describe('solunarDayScore', () => {
  it('stays within [0, 1]', () => {
    for (let d = 0; d < 30; d++) {
      const score = solunarDayScore(new Date(BASE.getTime() + d * DAY_MS));
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('peaks on the new and full moon', () => {
    expect(solunarDayScore(NEW_MOON)).toBeGreaterThan(solunarDayScore(TROUGH));
    expect(solunarDayScore(FULL_MOON)).toBeGreaterThan(solunarDayScore(TROUGH));
  });

  it('rates the major periods above the quarters', () => {
    expect(solunarDayScore(NEW_MOON)).toBeGreaterThan(solunarDayScore(FIRST_QUARTER));
    expect(solunarDayScore(FULL_MOON)).toBeGreaterThan(solunarDayScore(FIRST_QUARTER));
  });

  it('still lifts the quarters above the trough (minor periods count)', () => {
    expect(solunarDayScore(FIRST_QUARTER)).toBeGreaterThan(solunarDayScore(TROUGH));
  });

  it('treats new and full moon as near-equivalent', () => {
    expect(solunarDayScore(NEW_MOON)).toBeCloseTo(solunarDayScore(FULL_MOON), 2);
  });

  it('is continuous across the cycle wrap (day before new ≈ day after)', () => {
    const before = solunarDayScore(new Date(NEW_MOON.getTime() - DAY_MS));
    const after = solunarDayScore(new Date(NEW_MOON.getTime() + DAY_MS));
    expect(before).toBeCloseTo(after, 2);
  });

  it('rates a major period as excellent', () => {
    expect(ratingOf(solunarDayScore(NEW_MOON))).toBe('excellent');
  });
});

describe('ratingOf', () => {
  it.each([
    [0.9, 'excellent'],
    [0.75, 'excellent'],
    [0.7, 'good'],
    [0.6, 'good'],
    [0.5, 'fair'],
    [0.45, 'fair'],
    [0.2, 'poor'],
  ])('maps %f to %s', (score, expected) => {
    expect(ratingOf(score)).toBe(expected);
  });
});

describe('monthOutlook', () => {
  it('returns one entry per day of the month', () => {
    expect(monthOutlook(new Date(2026, 1, 10))).toHaveLength(28); // Feb 2026
    expect(monthOutlook(new Date(2026, 6, 10))).toHaveLength(31); // Jul 2026
    expect(monthOutlook(new Date(2026, 3, 10))).toHaveLength(30); // Apr 2026
  });

  it('handles a leap February', () => {
    expect(monthOutlook(new Date(2028, 1, 10))).toHaveLength(29);
  });

  it('numbers days 1..n and dates them consistently', () => {
    const out = monthOutlook(new Date(2026, 6, 15));
    expect(out[0]!.day).toBe(1);
    expect(out[0]!.date).toBe('2026-07-01');
    expect(out[30]!.day).toBe(31);
    expect(out[30]!.date).toBe('2026-07-31');
  });

  it('uses local dates, not UTC-shifted ones', () => {
    // Every emitted date must belong to the requested month, which a
    // toISOString-based implementation would break for part of the day.
    for (const d of monthOutlook(new Date(2026, 6, 15))) {
      expect(d.date.startsWith('2026-07-')).toBe(true);
    }
  });

  it('attaches a rating consistent with the score', () => {
    for (const d of monthOutlook(new Date(2026, 6, 15))) {
      expect(d.rating).toBe(ratingOf(d.score));
    }
  });
});

describe('monthStartWeekday', () => {
  it('returns the weekday index of the 1st', () => {
    // 1 July 2026 is a Wednesday.
    expect(monthStartWeekday(new Date(2026, 6, 20))).toBe(3);
  });

  it('is independent of the anchor day within the month', () => {
    expect(monthStartWeekday(new Date(2026, 6, 1))).toBe(monthStartWeekday(new Date(2026, 6, 28)));
  });
});

describe('bestDays', () => {
  const outlook = monthOutlook(new Date(2026, 6, 15));

  it('returns the requested count, best first', () => {
    const top = bestDays(outlook, 5);
    expect(top).toHaveLength(5);
    for (let i = 1; i < top.length; i++) {
      expect(top[i - 1]!.score).toBeGreaterThanOrEqual(top[i]!.score);
    }
  });

  it('never mutates the input order', () => {
    const before = outlook.map((d) => d.day);
    bestDays(outlook, 5);
    expect(outlook.map((d) => d.day)).toEqual(before);
  });

  it('caps at the available days', () => {
    expect(bestDays(outlook, 500)).toHaveLength(outlook.length);
  });
});
