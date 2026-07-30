import { SUBSCRIPTIONS_ENABLED } from '@/config/features';

import type { PremiumFeature } from './premiumFeatures';
import { useSubscriptionStore } from './subscriptionStore';

/**
 * Single source of truth for "what is this user entitled to".
 *
 * Also the CHOKE POINT for the subscription feature flag. Every gate in the app
 * asks this module, so switching subscriptions off unlocks the full forecast,
 * unlimited history, all alert sounds, unlimited session length, cloud photo
 * backup, full session reports and catch insights — without a single screen
 * needing to know a flag exists.
 *
 * There is no `adFree` concept: the app serves no ads. The revenue model is the
 * hardware.
 */
export interface Entitlements {
  /**
   * Genuinely paid for it. Distinct from `pro` — use this only for copy that
   * thanks someone, never to decide access.
   */
  isPremium: boolean;
  /**
   * Access to the premium feature set. TRUE FOR EVERYONE when subscriptions are
   * disabled, because there is no paid tier to gate behind.
   */
  pro: boolean;
  /** Whether a specific gated feature is available. */
  has: (feature: PremiumFeature) => boolean;
}

/**
 * Pure derivation, exported so the flag interaction is testable without mocking
 * expo-constants.
 */
export function deriveEntitlements(
  isPremium: boolean,
  subscriptionsEnabled: boolean = SUBSCRIPTIONS_ENABLED,
): Entitlements {
  // No paid tier → nothing is gated.
  const pro = !subscriptionsEnabled || isPremium;
  return {
    isPremium,
    pro,
    has: () => pro,
  };
}

/** Reactive entitlements for components. */
export function useEntitlements(): Entitlements {
  const isPremium = useSubscriptionStore((s) => s.isPremium);
  return deriveEntitlements(isPremium);
}

/** Non-hook snapshot for imperative code paths. */
export function getEntitlementsSnapshot(): Entitlements {
  return deriveEntitlements(useSubscriptionStore.getState().isPremium);
}
