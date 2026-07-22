import { useEffect, useState } from 'react';

import type { BiteRecord } from '@/types';

import { biteRepository } from './biteRepository';

export interface UseBiteHistoryResult {
  records: BiteRecord[];
  loading: boolean;
  error: string | null;
}

/**
 * Live-subscribes to the signed-in user's bite history. No-op (empty, not
 * loading) when `uid` is null so it is safe to call before authentication.
 */
export function useBiteHistory(uid: string | null): UseBiteHistoryResult {
  const [records, setRecords] = useState<BiteRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(uid !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setRecords([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    let unsubscribe = () => {};
    try {
      unsubscribe = biteRepository.subscribe(uid, (next) => {
        setRecords(next);
        setLoading(false);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bite history');
      setLoading(false);
    }

    return () => unsubscribe();
  }, [uid]);

  return { records, loading, error };
}
