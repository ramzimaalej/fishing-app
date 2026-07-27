import { IAP_PRODUCT_IDS, PLAN_KIND, PLAN_ORDER } from '@/config/constants';

import {
  planForProductId,
  resolvePremium,
  shouldPromptSubscriptionCancel,
  sourceForProductId,
} from '../premiumSource';

const LIFETIME = IAP_PRODUCT_IDS.lifetime;
const YEARLY = IAP_PRODUCT_IDS.yearly;

describe('plan catalogue', () => {
  it('declares a product type for every plan', () => {
    for (const plan of PLAN_ORDER) {
      expect(PLAN_KIND[plan]).toBeDefined();
    }
  });

  it('lists every plan exactly once in display order', () => {
    const ids = Object.keys(IAP_PRODUCT_IDS).sort();
    expect([...PLAN_ORDER].sort()).toEqual(ids);
    expect(new Set(PLAN_ORDER).size).toBe(PLAN_ORDER.length);
  });

  it('keeps lifetime a one-off and yearly a subscription', () => {
    // Getting this backwards sends the wrong react-native-iap call and the
    // product list silently comes back empty.
    expect(PLAN_KIND.lifetime).toBe('oneTime');
    expect(PLAN_KIND.yearly).toBe('subscription');
  });

  it('gives the two plans distinct product ids', () => {
    expect(LIFETIME).not.toBe(YEARLY);
  });
});

describe('resolvePremium', () => {
  it('is not premium with no purchases', () => {
    expect(resolvePremium([])).toEqual({ isPremium: false, source: null });
  });

  it('recognises a lifetime purchase', () => {
    expect(resolvePremium([LIFETIME])).toEqual({ isPremium: true, source: 'lifetime' });
  });

  it('recognises a yearly subscription', () => {
    expect(resolvePremium([YEARLY])).toEqual({ isPremium: true, source: 'subscription' });
  });

  it('prefers lifetime when the user holds both', () => {
    // Lifetime cannot expire, so it is the durable truth — and this is what
    // lets the UI tell them to cancel the redundant yearly plan.
    expect(resolvePremium([YEARLY, LIFETIME])).toEqual({ isPremium: true, source: 'lifetime' });
    expect(resolvePremium([LIFETIME, YEARLY])).toEqual({ isPremium: true, source: 'lifetime' });
  });

  it('ignores unrelated product ids', () => {
    expect(resolvePremium(['co.castmate.something.else'])).toEqual({
      isPremium: false,
      source: null,
    });
  });

  it('is unaffected by ordering or duplicates', () => {
    expect(resolvePremium([YEARLY, YEARLY])).toEqual({ isPremium: true, source: 'subscription' });
  });
});

describe('planForProductId', () => {
  it('maps known ids to plans', () => {
    expect(planForProductId(LIFETIME)).toBe('lifetime');
    expect(planForProductId(YEARLY)).toBe('yearly');
  });

  it('returns null for unknown, empty or missing ids', () => {
    expect(planForProductId('nope')).toBeNull();
    expect(planForProductId('')).toBeNull();
    expect(planForProductId(undefined)).toBeNull();
    expect(planForProductId(null)).toBeNull();
  });
});

describe('sourceForProductId', () => {
  it('maps a completed purchase to the entitlement it grants', () => {
    expect(sourceForProductId(LIFETIME)).toBe('lifetime');
    expect(sourceForProductId(YEARLY)).toBe('subscription');
  });

  it('is null for anything unrecognised', () => {
    expect(sourceForProductId('nope')).toBeNull();
    expect(sourceForProductId(undefined)).toBeNull();
  });
});

describe('shouldPromptSubscriptionCancel', () => {
  it('warns a lifetime owner who still has a yearly plan', () => {
    // The double-pay case. We cannot cancel for them, so we must say so.
    expect(shouldPromptSubscriptionCancel('lifetime', [LIFETIME, YEARLY])).toBe(true);
  });

  it('stays quiet for a lifetime owner with no subscription', () => {
    expect(shouldPromptSubscriptionCancel('lifetime', [LIFETIME])).toBe(false);
  });

  it('stays quiet for a plain subscriber', () => {
    // Nothing redundant here — telling them to cancel would remove their access.
    expect(shouldPromptSubscriptionCancel('subscription', [YEARLY])).toBe(false);
  });

  it('stays quiet when there is no entitlement at all', () => {
    expect(shouldPromptSubscriptionCancel(null, [])).toBe(false);
    expect(shouldPromptSubscriptionCancel(null, [YEARLY])).toBe(false);
  });
});
