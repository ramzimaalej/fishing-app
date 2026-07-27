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
  /**
   * Session length in seconds, still owed to the session-end interstitial.
   *
   * The ad fires when the user LEAVES the report, not before it opens: the
   * report is the payoff for hours of fishing, and putting a full-screen ad in
   * front of it taxes the one moment the app earns goodwill. Same impression,
   * better order. Null once spent.
   */
  pendingInterstitialSeconds: number | null;
  setLast: (summary: SessionSummary, sessionSeconds: number) => void;
  clearPendingInterstitial: () => void;
  clear: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  last: null,
  pendingInterstitialSeconds: null,
  setLast: (summary, sessionSeconds) =>
    set({ last: summary, pendingInterstitialSeconds: sessionSeconds }),
  clearPendingInterstitial: () => set({ pendingInterstitialSeconds: null }),
  clear: () => set({ last: null, pendingInterstitialSeconds: null }),
}));
