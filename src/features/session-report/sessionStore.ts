import { create } from 'zustand';

import type { SessionSummary } from './sessionSummary';

/**
 * Holds the most recently completed session so the report screen can render it
 * after the Fishing screen has already torn its live state down.
 *
 * Deliberately NOT persisted: a report is a debrief for the trip you just
 * finished, and a stale one greeting you on cold start would be noise. The
 * durable record of what happened is the bite history in Firestore.
 */
interface SessionState {
  last: SessionSummary | null;
  setLast: (summary: SessionSummary) => void;
  clear: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  last: null,
  setLast: (summary) => set({ last: summary }),
  clear: () => set({ last: null }),
}));
