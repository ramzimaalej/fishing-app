import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { useEntitlements } from '@/features/subscription/useEntitlements';

import { grantRewardNow, unlockRewarded } from './adsController';
import { REWARDS, type RewardKind, type RewardSpec } from './rewards';

/**
 * Rewarded-ad → scoped feature unlock.
 *
 * Why this format earns its place (revenue design): rewarded video is the only
 * ad the user *chooses*, it carries several times the eCPM of a banner, and the
 * reward doubles as a paywall demo — the user experiences the exact feature
 * they'd be subscribing for. Because grants are per-feature and short (see
 * rewards.ts) the same user can legitimately be offered one at several points
 * over a week, instead of a single day-pass that suppresses everything.
 */
export interface RewardedUnlock {
  spec: RewardSpec;
  /** Already available — via the paid tier or a live grant. Hide the offer. */
  unlocked: boolean;
  /** True when the unlock came from an ad rather than the subscription. */
  fromReward: boolean;
  /** Expiry of an active rewarded grant, for "unlocked until…" copy. */
  until: number | null;
  /** True when an ad is loaded and the user could actually use this unlock. */
  available: boolean;
  /** Present the ad. Returns false if it could not be shown. */
  watch: () => boolean;
}

export function useRewardedUnlock(kind: RewardKind): RewardedUnlock {
  const { isPremium, has, rewardUntil } = useEntitlements();
  const unlocked = has(kind);
  const until = rewardUntil(kind);

  // Load-state read via subscription — reactive, never a stale ref capture.
  const loaded = useSyncExternalStore(unlockRewarded.subscribe, () => unlockRewarded.isLoaded);

  // Only warm the rewarded slot for users who could actually use it.
  useEffect(() => {
    if (!isPremium && !unlocked) unlockRewarded.preload();
  }, [isPremium, unlocked]);

  const watch = useCallback(
    (): boolean => unlockRewarded.show({ onEarned: () => grantRewardNow(kind) }),
    [kind],
  );

  return {
    spec: REWARDS[kind],
    unlocked,
    fromReward: !isPremium && until !== null,
    until,
    available: loaded && !isPremium && !unlocked,
    watch,
  };
}
