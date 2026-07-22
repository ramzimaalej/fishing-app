import { useAdsStore } from '@/features/ads/adsStore';

import { useSubscriptionStore } from './subscriptionStore';

/**
 * Single source of truth for "what is this user entitled to".
 *
 * Decouples *why* someone has a perk (paid subscription vs a rewarded-ad
 * 24h Premium Preview) from *what* the perk gates:
 *  - `adFree` — every ad surface checks this and nothing else.
 *  - `pro`    — premium feature gates (insights, sounds, …) check this.
 *
 * Today both derive from the same sources; keeping them separate lets a future
 * tier (e.g. "supporter" = ad-free only) ship without touching ad code.
 */
export interface Entitlements {
  isPremium: boolean;
  /** True while a rewarded Premium Preview is running (never for subscribers). */
  previewActive: boolean;
  previewUntil: number | null;
  adFree: boolean;
  pro: boolean;
}

function derive(isPremium: boolean, previewUntil: number | null): Entitlements {
  // Expiry is evaluated lazily at read time; a stale minute at the boundary is
  // acceptable (next render/interaction re-derives it).
  const previewActive = !isPremium && previewUntil !== null && previewUntil > Date.now();
  return {
    isPremium,
    previewActive,
    previewUntil,
    adFree: isPremium || previewActive,
    pro: isPremium || previewActive,
  };
}

/** Reactive entitlements for components. */
export function useEntitlements(): Entitlements {
  const isPremium = useSubscriptionStore((s) => s.isPremium);
  const previewUntil = useAdsStore((s) => s.previewUntil);
  return derive(isPremium, previewUntil);
}

/** Non-hook snapshot for imperative code paths (controllers, callbacks). */
export function getEntitlementsSnapshot(): Entitlements {
  return derive(
    useSubscriptionStore.getState().isPremium,
    useAdsStore.getState().previewUntil,
  );
}
