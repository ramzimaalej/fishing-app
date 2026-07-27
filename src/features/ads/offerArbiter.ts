/**
 * Chooses the ONE rewarded offer a screen may show — pure and testable.
 *
 * The problem this solves: before it existed, the bite-history screen carried an
 * anchored banner, in-feed native units, AND two rewarded cards. Four ad
 * surfaces in one scroll reads as desperation, and they cannibalise each other —
 * two offers side by side convert worse than the better one alone, because the
 * user's decision changes from "do I want this?" to "am I being farmed?".
 *
 * So a screen declares its candidates in priority order (most contextually
 * relevant first) and gets back at most one.
 */

import type { RewardKind } from './rewards';

export interface OfferContext {
  /** Already available — via the paid tier or a live grant. */
  isUnlocked: (kind: RewardKind) => boolean;
  /** Passes fatigue back-off (see offerFatigue). */
  isEligible: (kind: RewardKind) => boolean;
}

/**
 * First candidate that is neither already unlocked nor fatigued, or null.
 *
 * Order is the screen's judgement of relevance, not expected revenue: an offer
 * for the thing the user just reached for converts far better than the one that
 * pays marginally more, and a relevant offer costs no goodwill.
 */
export function pickOffer(
  candidates: readonly RewardKind[],
  { isUnlocked, isEligible }: OfferContext,
): RewardKind | null {
  for (const kind of candidates) {
    if (isUnlocked(kind)) continue;
    if (!isEligible(kind)) continue;
    return kind;
  }
  return null;
}
