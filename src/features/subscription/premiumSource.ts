/**
 * Resolving Premium from store purchases — pure, so the precedence rule is
 * testable without a native module.
 */

import { IAP_PRODUCT_IDS, type PlanKey } from '@/config/constants';

/**
 * How the user came by Premium. `null` with `isPremium: true` means "entitled,
 * but we don't know which" — the state of anyone who bought before this field
 * existed, and a reason never to branch on source for *access* decisions.
 */
export type PremiumSource = 'lifetime' | 'subscription' | null;

export interface PremiumState {
  isPremium: boolean;
  source: PremiumSource;
}

/**
 * Resolve entitlement from the product ids the store reports as owned.
 *
 * Lifetime wins over subscription because it cannot expire: if a user holds
 * both (bought lifetime while a yearly plan was still running), the durable
 * one is the truth, and the UI can then tell them to cancel the subscription.
 *
 * CAVEAT on subscriptions: the caller filters to active items, which on
 * StoreKit 2 does exclude lapsed auto-renewables — but that is the *client*
 * deciding it is entitled, which a determined user can influence. Only
 * server-side receipt validation actually settles whether a subscription is
 * live. A lifetime id needs no such judgement: owned is owned, permanently.
 * That makes the one-off purchase strictly more reliable to restore.
 */
export function resolvePremium(ownedProductIds: readonly string[]): PremiumState {
  if (ownedProductIds.includes(IAP_PRODUCT_IDS.lifetime)) {
    return { isPremium: true, source: 'lifetime' };
  }
  if (ownedProductIds.includes(IAP_PRODUCT_IDS.yearly)) {
    return { isPremium: true, source: 'subscription' };
  }
  return { isPremium: false, source: null };
}

/** Which plan a completed purchase corresponds to, or null if unrecognised. */
export function planForProductId(productId: string | undefined | null): PlanKey | null {
  if (!productId) return null;
  if (productId === IAP_PRODUCT_IDS.lifetime) return 'lifetime';
  if (productId === IAP_PRODUCT_IDS.yearly) return 'yearly';
  return null;
}

/** The entitlement source a completed purchase grants. */
export function sourceForProductId(productId: string | undefined | null): PremiumSource {
  const plan = planForProductId(productId);
  if (plan === 'lifetime') return 'lifetime';
  if (plan === 'yearly') return 'subscription';
  return null;
}

/**
 * True when the user should be told to cancel a still-running subscription:
 * they now own lifetime, so continuing to pay yearly is pure waste. We cannot
 * cancel it for them — only the store can — so the UI has to say so.
 */
export function shouldPromptSubscriptionCancel(
  source: PremiumSource,
  ownedProductIds: readonly string[],
): boolean {
  return source === 'lifetime' && ownedProductIds.includes(IAP_PRODUCT_IDS.yearly);
}
