import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { useEntitlements } from '@/features/subscription/useEntitlements';

import { unlockRewarded } from './adsController';

/**
 * Rewarded ad in front of a ONE-OFF action, rather than a time-boxed feature
 * unlock (that is useRewardedUnlock / RewardGrants).
 *
 * Used for things that add something to the app's state instead of opening a
 * door — extending a fishing session being the case in point: there is no
 * "extension entitlement" to hold, just six more hours to grant.
 */
export interface RewardedAction {
  /** True when the paid tier means no ad is required at all. */
  exempt: boolean;
  /** True when an ad is loaded and ready to present. */
  ready: boolean;
  /**
   * Run the action, showing an ad first when one is required AND available.
   *
   * Returns 'granted' when the action ran immediately (premium, or no ad could
   * be shown), 'showing' when an ad was presented and the action will run once
   * the reward is earned.
   *
   * NOTE the fail-open behaviour: if no ad is loaded, the action proceeds
   * anyway. Every gate built on this hook stands in front of something the user
   * needs, so blocking them because an ad network had no inventory trades a
   * cent of revenue for a broken product.
   */
  run: () => 'granted' | 'showing';
}

export function useRewardedAction(onGranted: () => void): RewardedAction {
  const { isPremium } = useEntitlements();

  const loaded = useSyncExternalStore(unlockRewarded.subscribe, () => unlockRewarded.isLoaded);

  // Only warm the slot for users who would actually be shown one.
  useEffect(() => {
    if (!isPremium) unlockRewarded.preload();
  }, [isPremium]);

  const run = useCallback((): 'granted' | 'showing' => {
    if (isPremium) {
      onGranted();
      return 'granted';
    }
    const shown = unlockRewarded.show({ onEarned: onGranted });
    if (shown) return 'showing';
    // Fail open — see the note above.
    onGranted();
    return 'granted';
  }, [isPremium, onGranted]);

  return { exempt: isPremium, ready: loaded, run };
}
