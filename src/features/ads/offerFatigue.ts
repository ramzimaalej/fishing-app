/**
 * Rewarded-offer fatigue — pure, so the back-off rule is testable.
 *
 * A rewarded offer the user keeps ignoring is worse than no offer at all: it
 * costs goodwill on every screen it appears on and earns nothing. Worse, it
 * trains the user to ignore the *card* rather than the offer, so the next
 * genuinely relevant one is invisible too.
 *
 * So an offer that has been shown repeatedly without ever being taken goes quiet
 * for a while. This raises effective eCPM (impressions are no longer spent on
 * people who won't watch) at the same time as reducing nagging — the two goals
 * point the same way here.
 */

import type { RewardKind } from './rewards';

export interface OfferStats {
  /** Times this offer has been presented since the last time it was taken. */
  shown: number;
  /** Lifetime times the user actually watched for it. */
  taken: number;
  /** Quiet until this epoch ms, or null when not suppressed. */
  suppressedUntil: number | null;
}

export type OfferLedger = Partial<Record<RewardKind, OfferStats>>;

/** Consecutive untaken presentations before an offer goes quiet. */
export const MAX_UNTAKEN_OFFERS = 3;
/** How long it stays quiet. Long enough to stop feeling nagged by it. */
export const SUPPRESSION_MS = 3 * 24 * 60 * 60 * 1000;

const EMPTY: OfferStats = { shown: 0, taken: 0, suppressedUntil: null };

export function statsFor(ledger: OfferLedger, kind: RewardKind): OfferStats {
  return ledger[kind] ?? EMPTY;
}

/** False while an offer is in its quiet period. */
export function shouldOffer(ledger: OfferLedger, kind: RewardKind, now: number): boolean {
  const s = statsFor(ledger, kind);
  return s.suppressedUntil === null || s.suppressedUntil <= now;
}

/**
 * Record that the offer was presented. Once MAX_UNTAKEN_OFFERS presentations
 * have gone by without a take, it goes quiet.
 */
export function recordShown(ledger: OfferLedger, kind: RewardKind, now: number): OfferLedger {
  const s = statsFor(ledger, kind);
  const shown = s.shown + 1;
  const suppress = shown >= MAX_UNTAKEN_OFFERS;
  return {
    ...ledger,
    [kind]: {
      shown: suppress ? 0 : shown,
      taken: s.taken,
      suppressedUntil: suppress ? now + SUPPRESSION_MS : s.suppressedUntil,
    },
  };
}

/**
 * Record that the user watched for it. Clears the run of ignored presentations
 * and any suppression: someone who engages with an offer should keep seeing it.
 */
export function recordTaken(ledger: OfferLedger, kind: RewardKind): OfferLedger {
  const s = statsFor(ledger, kind);
  return {
    ...ledger,
    [kind]: { shown: 0, taken: s.taken + 1, suppressedUntil: null },
  };
}

/** Drop expired suppressions. Hygiene for the persisted blob only. */
export function pruneLedger(ledger: OfferLedger, now: number): OfferLedger {
  const next: OfferLedger = {};
  for (const [kind, stats] of Object.entries(ledger) as [RewardKind, OfferStats][]) {
    if (!stats) continue;
    next[kind] =
      stats.suppressedUntil !== null && stats.suppressedUntil <= now
        ? { ...stats, suppressedUntil: null }
        : stats;
  }
  return next;
}
