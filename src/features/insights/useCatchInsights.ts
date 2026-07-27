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

  const load = useCallback(
    async (force = false) => {
      if (!window.valid || records.length === 0) {
        setSeries([]);
        return;
      }
      const key = cacheKey(coords, window.from, window.to);
      if (!force) {
        const hit = cache.get(key);
        if (hit) {
          setSeries(hit);
          return;
        }
      }

      setLoading(true);
      setError(null);
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
    // Depend on the window's day boundaries, not the Date identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coords.latitude, coords.longitude, window.valid, window.from.getTime(), window.to.getTime(), records.length],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const insights = useMemo(
    () => (series === null ? null : analyseCatches(records, series)),
    [records, series],
  );

  return { insights, pendingRecent, loading, error, refresh: () => void load(true) };
}
