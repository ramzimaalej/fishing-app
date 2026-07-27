/**
 * Daily solunar outlook — pure, dependency-free (moonPhase.ts aside), so it is
 * fully unit-tested and needs no network.
 *
 * Why this exists alongside fishActivity.ts: the hourly model needs live
 * pressure/wind, so it only reaches as far as the weather forecast does (~16
 * days). Trip planning happens further out than that. The moon, however, is
 * predictable indefinitely — so a month view is built from the solunar factors
 * alone and is honestly labelled as such in the UI.
 *
 * Classic solunar theory: the major periods are the lunar transit (moon
 * overhead) and its opposite (moon underfoot), which are strongest around new
 * and full moon when sun and moon pull together. Quarters are minor periods.
 */

import type { MoonPhase } from '@/types';

import { getMoonPhase, moonAgeDays } from './moonPhase';

const SYNODIC_MONTH = 29.530588853;
/** Age (days) of a full moon — half a synodic cycle from new. */
const FULL_MOON_AGE = SYNODIC_MONTH / 2;

export type SolunarRating = 'poor' | 'fair' | 'good' | 'excellent';

export interface DayOutlook {
  /** Local calendar date as yyyy-mm-dd. */
  date: string;
  /** Day-of-month, for calendar cells. */
  day: number;
  /** Solunar day rating in [0, 1]. */
  score: number;
  rating: SolunarRating;
  moon: MoonPhase;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Days from `age` to the nearest new moon, accounting for cycle wrap-around. */
function daysToNewMoon(age: number): number {
  return Math.min(age, SYNODIC_MONTH - age);
}

/** Days from `age` to the full moon. */
function daysToFullMoon(age: number): number {
  return Math.abs(age - FULL_MOON_AGE);
}

/** Days to the nearest quarter moon (the minor solunar periods). */
function daysToQuarter(age: number): number {
  const first = SYNODIC_MONTH / 4;
  const last = (3 * SYNODIC_MONTH) / 4;
  return Math.min(Math.abs(age - first), Math.abs(age - last));
}

/**
 * Solunar rating for a calendar day in [0, 1].
 *
 * Baseline 0.35, peaking ~0.9 on a new or full moon and decaying over ~2 days
 * either side; quarters contribute a smaller, narrower bump. Deliberately never
 * returns 0 or 1 — this is planning guidance, not a promise about the fish.
 */
export function solunarDayScore(date: Date): number {
  const age = moonAgeDays(date);

  // Major periods: Gaussian falloff, sigma ≈ 2 days.
  const major = Math.exp(-Math.pow(Math.min(daysToNewMoon(age), daysToFullMoon(age)), 2) / 8);
  // Minor periods: narrower (sigma ≈ 1.4 days) and weaker.
  const minor = Math.exp(-Math.pow(daysToQuarter(age), 2) / 3.92);

  return clamp01(0.35 + 0.55 * major + 0.12 * minor);
}

export function ratingOf(score: number): SolunarRating {
  if (score >= 0.75) return 'excellent';
  if (score >= 0.6) return 'good';
  if (score >= 0.45) return 'fair';
  return 'poor';
}

function localIsoDate(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

/**
 * Outlook for every day of the calendar month containing `anchor`.
 * Scores are evaluated at local midday so a day gets its representative moon
 * age rather than the value at 00:00.
 */
export function monthOutlook(anchor: Date): DayOutlook[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const out: DayOutlook[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const midday = new Date(year, month, day, 12, 0, 0);
    const score = solunarDayScore(midday);
    out.push({
      date: localIsoDate(midday),
      day,
      score,
      rating: ratingOf(score),
      moon: getMoonPhase(midday),
    });
  }
  return out;
}

/** Weekday index (0 = Sunday) of the 1st of `anchor`'s month — for grid offset. */
export function monthStartWeekday(anchor: Date): number {
  return new Date(anchor.getFullYear(), anchor.getMonth(), 1).getDay();
}

/** The highest-rated days of a month, best first. Used for the "plan around" list. */
export function bestDays(outlook: DayOutlook[], count = 5): DayOutlook[] {
  return [...outlook].sort((a, b) => b.score - a.score).slice(0, count);
}
