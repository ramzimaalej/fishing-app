/**
 * The analysis window — pure, so the clamping rules are testable without a
 * network or a clock.
 *
 * Two hard bounds:
 *  - the window ends ERA5_LAG_DAYS before today, because reanalysis behind that
 *    point is a mix of ERA5T and model estimates (see openMeteo.ts);
 *  - it spans at most INSIGHTS_WINDOW_DAYS, because the archive request is one
 *    contiguous range and an unbounded history would fetch a payload
 *    proportional to how long the user has owned the app.
 */

import { ERA5_LAG_DAYS } from '@/features/environment/openMeteo';

/** Longest span analysed. ~6 months balances signal against payload size. */
export const INSIGHTS_WINDOW_DAYS = 180;

export interface AnalysisWindow {
  from: Date;
  to: Date;
  /** False when the window collapsed to nothing (clock skew / absurd inputs). */
  valid: boolean;
}

/** Local midnight `offset` days from `ref`. */
function midnightOffset(ref: Date, offset: number): Date {
  return new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + offset);
}

/**
 * Window to request, given the oldest bite the user has. Narrower of
 * "since the first bite" and INSIGHTS_WINDOW_DAYS, ending at the ERA5 cutoff —
 * so a user with two weeks of history doesn't pull six months of reanalysis.
 */
export function analysisWindow(
  oldestBiteAt: number | null,
  now: Date = new Date(),
): AnalysisWindow {
  const to = midnightOffset(now, -ERA5_LAG_DAYS);
  const earliestAllowed = midnightOffset(now, -INSIGHTS_WINDOW_DAYS);

  let from = earliestAllowed;
  if (oldestBiteAt !== null) {
    const oldest = new Date(oldestBiteAt);
    const oldestMidnight = midnightOffset(oldest, 0);
    // Start at the first bite unless that predates the cap.
    if (oldestMidnight.getTime() > earliestAllowed.getTime()) from = oldestMidnight;
  }

  return { from, to, valid: from.getTime() <= to.getTime() };
}

/** Oldest timestamp in a set of records, or null when there are none. */
export function oldestTimestamp(records: readonly { timestamp: number }[]): number | null {
  let oldest: number | null = null;
  for (const r of records) {
    if (oldest === null || r.timestamp < oldest) oldest = r.timestamp;
  }
  return oldest;
}

/** True when a bite is recent enough that reanalysis won't cover it yet. */
export function isWithinEra5Lag(timestamp: number, now: Date = new Date()): boolean {
  return timestamp > midnightOffset(now, -ERA5_LAG_DAYS).getTime();
}
