import { useCallback, useEffect, useMemo, useState } from 'react';

import type { EnvironmentSnapshot, GeoCoords } from '@/types';

import { DEFAULT_COORDS, openMeteoProvider } from './openMeteo';

const REFRESH_MS = 30 * 60 * 1000; // 30 minutes

/** How far the multi-day outlook reaches. Open-Meteo serves up to 16 days. */
export const FORECAST_DAYS = 7;

/** Index of the hourly snapshot nearest to `now`. */
function nearestIndex(hourly: EnvironmentSnapshot[], now = Date.now()): number {
  let best = -1;
  let bestDelta = Infinity;
  for (let i = 0; i < hourly.length; i++) {
    const delta = Math.abs(new Date(hourly[i]!.time).getTime() - now);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}

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

export interface UseEnvironmentResult {
  /** Today's hours only — drives the current conditions + hourly strip. */
  hourly: EnvironmentSnapshot[];
  /** FORECAST_DAYS of grouped days, today first. */
  daily: DayForecast[];
  current: EnvironmentSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Loads a multi-day hourly forecast on mount and every 30 minutes, exposing
 * both the snapshot nearest to "now" and a per-day grouping for the outlook.
 */
export function useEnvironment(coords: GeoCoords = DEFAULT_COORDS): UseEnvironmentResult {
  const [series, setSeries] = useState<EnvironmentSnapshot[]>([]);
  const [current, setCurrent] = useState<EnvironmentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await openMeteoProvider.fetchRange(coords, new Date(), FORECAST_DAYS);
      setSeries(data);
      const idx = nearestIndex(data);
      setCurrent(idx >= 0 ? (data[idx] ?? null) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load conditions.');
    } finally {
      setLoading(false);
    }
    // Key on the coordinate values, not the object identity, so passing an
    // equivalent inline `{ latitude, longitude }` does not trigger a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords.latitude, coords.longitude]);

  useEffect(() => {
    let active = true;
    void load();
    const timer = setInterval(() => {
      if (active) void load();
    }, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [load]);

  const daily = useMemo(() => groupByDay(series), [series]);
  // "Today" is the day containing `current` rather than the first bucket: a
  // refresh crossing local midnight would otherwise keep showing yesterday.
  const hourly = useMemo(() => {
    if (daily.length === 0) return [];
    const todayKey = current?.time.slice(0, 10);
    return (daily.find((d) => d.date === todayKey) ?? daily[0]!).hours;
  }, [daily, current]);

  return { hourly, daily, current, loading, error, refresh: () => void load() };
}

/**
 * One-shot fetch of the current conditions for tagging a bite. Never throws —
 * returns null on any failure so bite persistence is never blocked.
 */
export async function getCurrentConditions(
  coords: GeoCoords = DEFAULT_COORDS,
): Promise<EnvironmentSnapshot | null> {
  try {
    const data = await openMeteoProvider.fetchDay(coords);
    if (data.length === 0) return null;
    const idx = nearestIndex(data);
    return idx >= 0 ? (data[idx] ?? null) : null;
  } catch {
    return null;
  }
}
