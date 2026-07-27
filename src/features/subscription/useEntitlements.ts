import { useAdsStore } from '@/features/ads/adsStore';
import { isRewardActive, type RewardGrants, type RewardKind } from '@/features/ads/rewards';

import { useSubscriptionStore } from './subscriptionStore';

/**
 * Single source of truth for "what is this user entitled to".
 *
 * Decouples *why* someone has a perk (paid subscription vs a rewarded unlock)
 * from *what* the perk gates:
 *  - `adFree` — every ad surface checks this and nothing else.
 *  - `pro`    — the paid tier; unconditional access to every gated feature.
 *  - `has(k)` — this specific feature, whether via `pro` or a rewarded grant.
 *
 * Note that a rewarded unlock deliberately does NOT confer `adFree`. Watching
 * one ad buys the feature you asked for, not a pass on the whole business
 * model — see features/ads/rewards.ts for the reasoning.
 */
export interface Entitlements {
  isPremium: boolean;
  adFree: boolean;
  pro: boolean;
  /** Raw rewarded-grant expiries — safe to use as a hook dependency. */
  grants: RewardGrants;
  /** True when `kind` is available: paid tier OR an active rewarded unlock. */
  has: (kind: RewardKind) => boolean;
  /** Expiry of a rewarded unlock, for "unlocked until…" copy. Null if none. */
  rewardUntil: (kind: RewardKind) => number | null;
}

function derive(isPremium: boolean, grants: RewardGrants): Entitlements {
  // Expiry is evaluated lazily at read time; a stale minute at the boundary is
  // acceptable (next render/interaction re-derives it).
  return {
    isPremium,
    adFree: isPremium,
    pro: isPremium,
    grants,
    has: (kind) => isPremium || isRewardActive(grants, kind, Date.now()),
    rewardUntil: (kind) => {
      const until = grants[kind];
      return until !== undefined && until > Date.now() ? until : null;
    },
  };
}

/** Reactive entitlements for components. */
export function useEntitlements(): Entitlements {
  const isPremium = useSubscriptionStore((s) => s.isPremium);
  const grants = useAdsStore((s) => s.rewardGrants);
  return derive(isPremium, grants);
}

/** Non-hook snapshot for imperative code paths (controllers, callbacks). */
export function getEntitlementsSnapshot(): Entitlements {
  return derive(
    useSubscriptionStore.getState().isPremium,
    useAdsStore.getState().rewardGrants,
  );
}
