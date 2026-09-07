import { useCallback, useEffect, useMemo, useState } from 'react';

import { DEFAULT_COORDS, openMeteoProvider } from '@/features/environment/openMeteo';
import type { BiteRecord, EnvironmentSnapshot, GeoCoords } from '@/types';

import { analyseCatches, type CatchInsights } from './catchInsights';
import { analysisWindow, isWithinEra5Lag, oldestTimestamp } from './historyWindow';

/**
 * Loads the ERA5 window covering a user's bite history and analyses it.
 *
 * The archive is fetched as ONE contiguous range rather than per-bite or
 * per-day: a season of bites is a single request, and the same series doubles
 * as the background hour distribution the lift calculation needs (see
 * catchInsights.ts). Fetching per-bite would give us no background at all.
 */

/** Cache keyed by coords + window so re-entering the screen is instant. */
const cache = new Map<string, EnvironmentSnapshot[]>();

const cacheKey = (c: GeoCoords, from: Date, to: Date): string =>
  `${c.latitude.toFixed(3)},${c.longitude.toFixed(3)}:${from.toDateString()}:${to.toDateString()}`;

export interface UseCatchInsightsResult {
  insights: CatchInsights | null;
  /** Bites too recent for reanalysis to cover yet — surfaced, not hidden. */
  pendingRecent: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** Stable identity for "nothing to analyse", so a reset does not churn memos. */
const NO_SERIES: EnvironmentSnapshot[] = [];

export function useCatchInsights(
  records: BiteRecord[],
  coords: GeoCoords = DEFAULT_COORDS,
): UseCatchInsightsResult {
  const [series, setSeries] = useState<EnvironmentSnapshot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const oldest = useMemo(() => oldestTimestamp(records), [records]);
  const pendingRecent = useMemo(
    () => records.filter((r) => isWithinEra5Lag(r.timestamp)).length,
    [records],
  );

  // Window depends only on the oldest bite, so adding today's catches does not
  // invalidate a fetched season of reanalysis.
  const window = useMemo(() => analysisWindow(oldest), [oldest]);

  // What is being analysed right now. Null when there is nothing to fetch.
  const key =
    window.valid && records.length > 0 ? cacheKey(coords, window.from, window.to) : null;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Seeded DURING render, which is what makes re-entering the screen instant:
  // a cached window is already on screen for the first paint instead of
  // arriving an effect later behind a spinner.
  if (loadedFor !== key) {
    setLoadedFor(key);
    const hit = key === null ? null : (cache.get(key) ?? null);
    setSeries(key === null ? NO_SERIES : hit);
    setError(null);
    setLoading(key !== null && hit === null);
  }

  const load = useCallback(
    async (force = false) => {
      // Touches no state before the first await — see the effect below. The
      // render-time seeding above has already handled the empty and cached
      // cases, so this only ever performs the fetch they could not.
      if (key === null) return;
      if (!force && cache.has(key)) return;
      try {
        const data = await openMeteoProvider.fetchHistory(coords, window.from, window.to);
        cache.set(key, data);
        setSeries(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load historical conditions.');
      } finally {
        setLoading(false);
      }
    },
    // Keyed on the cache key rather than the window's Date identities: it
    // already encodes the coordinates and both day boundaries, and a dependency
    // list has to be simple expressions — `window.from.getTime()` is a call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, coords.latitude, coords.longitude],
  );

  useEffect(() => {
    // Every setState inside `load` is behind its first await, so none of them
    // can run synchronously with this effect. The rule cannot see across the
    // await and reports the call itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const insights = useMemo(
    () => (series === null ? null : analyseCatches(records, series)),
    [records, series],
  );

  return {
    insights,
    pendingRecent,
    loading,
    error,
    refresh: () => {
      setLoading(key !== null);
      setError(null);
      void load(true);
    },
  };
}
