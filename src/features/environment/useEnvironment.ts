import { useCallback, useEffect, useMemo, useState } from 'react';

import { resolveCoords } from '@/features/location/location';
import type { EnvironmentSnapshot, GeoCoords } from '@/types';

import { useLocationStore } from '@/features/location/locationStore';

import { type DayForecast, groupByDay } from './grouping';
import { openMeteoProvider } from './openMeteo';
import { nearestHourIndex } from './snapshotTime';

const REFRESH_MS = 30 * 60 * 1000; // 30 minutes

/** How far the multi-day outlook reaches. Open-Meteo serves up to 16 days. */
export const FORECAST_DAYS = 7;

export type { DayForecast } from './grouping';
export { groupByDay } from './grouping';

export interface UseEnvironmentResult {
  /** False when no location is known yet — render a prompt, not a forecast. */
  hasLocation: boolean;
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
 * Loads a multi-day hourly forecast for the ACTIVE FISHING LOCATION on mount and
 * every 30 minutes, exposing both the snapshot nearest to "now" and a per-day
 * grouping for the outlook.
 *
 * There is deliberately NO default coordinate. When the location is unknown the
 * hook fetches nothing and reports `hasLocation: false`, so callers prompt the
 * user. Falling back to a hardcoded coordinate is what previously showed
 * Californian tides to anglers on other continents without saying so.
 */
export function useEnvironment(): UseEnvironmentResult {
  const coords = useLocationStore((st) => resolveCoords(st.mode, st.device, st.manual));
  const [series, setSeries] = useState<EnvironmentSnapshot[]>([]);
  const [current, setCurrent] = useState<EnvironmentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!coords) {
      setSeries([]);
      setCurrent(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await openMeteoProvider.fetchRange(coords, new Date(), FORECAST_DAYS);
      setSeries(data);
      const idx = nearestHourIndex(data);
      setCurrent(idx >= 0 ? (data[idx] ?? null) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load conditions.');
    } finally {
      setLoading(false);
    }
    // Key on the coordinate values, not the object identity, so an equivalent
    // inline `{ latitude, longitude }` does not trigger a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords?.latitude, coords?.longitude]);

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

  return {
    hasLocation: coords !== null,
    hourly,
    daily,
    current,
    loading,
    error,
    refresh: () => void load(),
  };
}

/**
 * One-shot fetch of the current conditions for tagging a bite. Never throws —
 * returns null on any failure so bite persistence is never blocked.
 */
export async function getCurrentConditions(
  coords: GeoCoords | null = useLocationStore.getState().coords(),
): Promise<EnvironmentSnapshot | null> {
  // No location → no conditions. Tagging a bite with a guessed coordinate would
  // poison the catch-insights analysis with data from somewhere the user never
  // fished.
  if (!coords) return null;
  try {
    const data = await openMeteoProvider.fetchDay(coords);
    if (data.length === 0) return null;
    const idx = nearestHourIndex(data);
    return idx >= 0 ? (data[idx] ?? null) : null;
  } catch {
    return null;
  }
}
