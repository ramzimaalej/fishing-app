import { useCallback, useEffect, useState } from 'react';

import type { EnvironmentSnapshot, GeoCoords } from '@/types';

import { DEFAULT_COORDS, openMeteoProvider } from './openMeteo';

const REFRESH_MS = 30 * 60 * 1000; // 30 minutes

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

export interface UseEnvironmentResult {
  hourly: EnvironmentSnapshot[];
  current: EnvironmentSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Loads a full day of hourly environmental data on mount and every 30 minutes,
 * exposing the snapshot nearest to "now" as `current`.
 */
export function useEnvironment(coords: GeoCoords = DEFAULT_COORDS): UseEnvironmentResult {
  const [hourly, setHourly] = useState<EnvironmentSnapshot[]>([]);
  const [current, setCurrent] = useState<EnvironmentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await openMeteoProvider.fetchDay(coords);
      setHourly(data);
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

  return { hourly, current, loading, error, refresh: () => void load() };
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
