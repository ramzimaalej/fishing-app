import { useCallback } from 'react';

import { useEntitlements } from '@/features/subscription/useEntitlements';

import { grantRewardNow, unlockRewarded } from './adsController';
import { REWARDS, type RewardKind, type RewardSpec } from './rewards';

/**
 * Rewarded ad in front of an action the user must be able to take, where the
 * reward is a time-boxed grant (RewardGrants) rather than a one-off.
 *
 * The difference from useRewardedUnlock: that hook *offers* an unlock the user
 * may ignore, so it can render nothing when no ad is loaded. A gate stands in
 * the way of something they need, so it must always resolve — hence `fail open`.
 */
export interface RewardedGate {
  spec: RewardSpec;
  /** True when the action may proceed right now with no ad. */
  open: boolean;
  /** True when the gate is open because they pay, rather than because of an ad. */
  exempt: boolean;
  /**
   * Ensure the gate is open, showing an ad if one is required and available.
   *
   * Returns 'open' when the caller may proceed immediately, or 'showing' when an
   * ad is up and the grant will land when the reward is earned.
   *
   * FAILS OPEN. If no ad is loaded — no fill, offline, SDK missing — the grant
   * is issued anyway. A user at the water who cannot pair a sensor because an
   * ad network had no inventory owns a bite alarm that does not work; that costs
   * incomparably more than one impression is worth.
   */
  ensureOpen: () => 'open' | 'showing';
}

export function useRewardedGate(kind: RewardKind): RewardedGate {
  const { isPremium, has } = useEntitlements();
  const open = has(kind);

  const ensureOpen = useCallback((): 'open' | 'showing' => {
    if (isPremium || has(kind)) return 'open';

    const shown = unlockRewarded.show({ onEarned: () => grantRewardNow(kind) });
    if (shown) return 'showing';

    // Fail open, and record the grant so the user isn't re-prompted on every
    // tap while the network stays empty.
    grantRewardNow(kind);
    return 'open';
  }, [isPremium, has, kind]);

  return { spec: REWARDS[kind], open, exempt: isPremium, ensureOpen };
}
