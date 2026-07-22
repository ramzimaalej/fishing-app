import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { useEntitlements } from '@/features/subscription/useEntitlements';

import { grantPreviewNow, previewRewarded } from './adsController';

/**
 * Rewarded-ad → 24h "Premium Preview" flow.
 *
 * Why this exists (revenue design): rewarded video is the only ad format the
 * user *chooses*, it carries the highest eCPM by an order of magnitude over
 * banners, and the reward — a day of the premium experience — doubles as a
 * paywall funnel: users learn what they'd be paying for. One opted-in
 * impression per active free user/day typically out-earns a full day of
 * passive banner refreshes, with zero resentment.
 */
export interface RewardedPreview {
  /** True when an ad is loaded and the user is eligible (not already ad-free). */
  available: boolean;
  /** True while a granted preview is running (for "active until…" UI). */
  previewActive: boolean;
  previewUntil: number | null;
  /** Present the ad. Returns false if it could not be shown. */
  watch: () => boolean;
}

export function useRewardedPreview(): RewardedPreview {
  const { adFree, previewActive, previewUntil } = useEntitlements();

  // Load-state read via subscription — reactive, never a stale ref capture.
  const loaded = useSyncExternalStore(
    previewRewarded.subscribe,
    () => previewRewarded.isLoaded,
  );

  // Only warm the rewarded slot for users who could actually use it.
  useEffect(() => {
    if (!adFree) previewRewarded.preload();
  }, [adFree]);

  const watch = useCallback(
    (): boolean => previewRewarded.show(() => grantPreviewNow()),
    [],
  );

  return { available: loaded && !adFree, previewActive, previewUntil, watch };
}
