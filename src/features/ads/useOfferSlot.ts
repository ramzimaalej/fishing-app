import { useEffect, useMemo } from 'react';

import { useEntitlements } from '@/features/subscription/useEntitlements';

import { useAdsStore } from './adsStore';
import { pickOffer } from './offerArbiter';
import type { RewardKind } from './rewards';

/**
 * The single rewarded offer a screen may present, chosen from its candidates.
 *
 * Screens declare candidates in order of contextual relevance and render at most
 * one card. Two offers side by side convert worse than the better one alone —
 * the user's question stops being "do I want this?" and becomes "am I being
 * farmed?" — and the second card costs goodwill on every screen it appears on.
 *
 * Presenting an offer is recorded so repeatedly-ignored offers go quiet (see
 * offerFatigue). That lifts effective eCPM and reduces nagging at once.
 */
export function useOfferSlot(candidates: readonly RewardKind[]): RewardKind | null {
  const { isPremium, has } = useEntitlements();
  const ledger = useAdsStore((s) => s.offerLedger);
  const noteOfferShown = useAdsStore((s) => s.noteOfferShown);
  const mayOffer = useAdsStore((s) => s.mayOffer);

  const chosen = useMemo(() => {
    // Subscribers are never offered anything: they already paid for all of it.
    if (isPremium) return null;
    return pickOffer(candidates, { isUnlocked: has, isEligible: mayOffer });
    // `ledger` is a dependency because mayOffer reads it — without it a
    // suppression would not take effect until some unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, isPremium, has, mayOffer, ledger]);

  // Counted once per mount, not per render, so scrolling a list doesn't burn
  // through the fatigue budget in a second.
  useEffect(() => {
    if (chosen) noteOfferShown(chosen);
  }, [chosen, noteOfferShown]);

  return chosen;
}
