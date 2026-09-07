import { useEffect, useState } from 'react';

import type { BiteRecord } from '@/types';

import { biteRepository } from './biteRepository';

export interface UseBiteHistoryResult {
  records: BiteRecord[];
  loading: boolean;
  error: string | null;
}

/** Stable identity, so the signed-out result does not change every render. */
const NO_RECORDS: BiteRecord[] = [];

/**
 * Live-subscribes to the signed-in user's bite history. No-op (empty, not
 * loading) when `uid` is null so it is safe to call before authentication.
 */
export function useBiteHistory(uid: string | null): UseBiteHistoryResult {
  const [records, setRecords] = useState<BiteRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(uid !== null);
  const [error, setError] = useState<string | null>(null);
  const [subscribedTo, setSubscribedTo] = useState<string | null>(uid);

  // Reset DURING render when the user changes, rather than from an effect.
  //
  // An effect resets after the commit, so the first paint under the new uid
  // still shows the previous user's bites — a privacy problem as much as a
  // flicker. This is React's documented way to derive state from a prop change,
  // and it re-renders before anything is shown rather than after.
  if (subscribedTo !== uid) {
    setSubscribedTo(uid);
    setRecords(NO_RECORDS);
    setError(null);
    setLoading(uid !== null);
  }

  useEffect(() => {
    // Nothing to subscribe to without a user; the reset above already cleared
    // whatever the previous one had.
    if (!uid) return;

    let unsubscribe = () => {};
    try {
      unsubscribe = biteRepository.subscribe(uid, (next) => {
        setRecords(next);
        setLoading(false);
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load bite history';
      // Reported on a microtask rather than inline. This branch runs
      // synchronously inside the effect, and setting state there forces a
      // second render pass before the first paint. A synchronous throw here
      // means Firestore is misconfigured, so a tick of delay costs nothing.
      queueMicrotask(() => {
        setError(message);
        setLoading(false);
      });
    }

    return () => unsubscribe();
  }, [uid]);

  // Signed out: no history, and nothing is loading. Derived so it can never
  // disagree with `uid` even for the render in which the user changed.
  if (uid === null) return { records: NO_RECORDS, loading: false, error: null };

  return { records, loading, error };
}
