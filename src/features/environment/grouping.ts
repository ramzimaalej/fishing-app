import type { EnvironmentSnapshot } from '@/types';

/**
 * Grouping the hourly series into days — pure, and deliberately in its own
 * module rather than inside useEnvironment.
 *
 * It used to live alongside the hook. Once the hook started reading the location
 * store, its test began pulling AsyncStorage transitively and failed to run at
 * all. Pure logic should not be reachable only through a module with native
 * dependencies.
 */

/** One calendar day of the outlook, with its peak feeding window pre-computed. */
export interface DayForecast {
  /** Local yyyy-mm-dd. */
  date: string;
  hours: EnvironmentSnapshot[];
  /** The single best hour of the day. */
  peak: EnvironmentSnapshot;
  /** Mean fish activity across the day. */
  avgActivity: number;
}

/**
 * Group a flat hourly series into days.
 *
 * The provider requests `timezone=auto`, so `time` is a local ISO string with no
 * offset ("2026-07-27T14:00") — its first 10 chars are the local day key. That
 * avoids re-deriving the day through Date, which would reintroduce a UTC shift.
 */
export function groupByDay(hourly: EnvironmentSnapshot[]): DayForecast[] {
  const byDate = new Map<string, EnvironmentSnapshot[]>();
  for (const h of hourly) {
    const key = h.time.slice(0, 10);
    const bucket = byDate.get(key);
    if (bucket) bucket.push(h);
    else byDate.set(key, [h]);
  }

  const days: DayForecast[] = [];
  for (const [date, hours] of byDate) {
    let peak = hours[0]!;
    let total = 0;
    for (const h of hours) {
      total += h.fishActivity;
      if (h.fishActivity > peak.fishActivity) peak = h;
    }
    days.push({ date, hours, peak, avgActivity: total / hours.length });
  }
  // Map iteration order follows insertion, which follows the provider's
  // chronological series — but sort explicitly rather than rely on that.
  return days.sort((a, b) => a.date.localeCompare(b.date));
}
