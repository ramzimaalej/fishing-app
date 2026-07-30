import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { IAP_PRODUCT_IDS, PLAN_KIND, type PlanKey } from '@/config/constants';
import { SUBSCRIPTIONS_ENABLED } from '@/config/features';
import { trackPurchase } from '@/services/firebase/analytics';

import {
  type PremiumSource,
  resolvePremium,
  sourceForProductId,
} from './premiumSource';

/**
 * Premium store backed by react-native-iap, offering the same entitlement two
 * ways: a one-off `lifetime` purchase and a `yearly` subscription (see
 * IAP_PRODUCT_IDS). Those are different STORE PRODUCT TYPES, so every call has
 * to be dispatched on PLAN_KIND — a subscription fetched via getProducts (or
 * vice versa) simply comes back empty.
 *
 * The whole IAP surface is loaded lazily and guarded: when the native module is
 * unavailable (Expo Go, or a build without the IAP native code linked) the store
 * degrades gracefully to `isPremium: false` and never throws. Real receipt
 * validation should happen server-side (see follow-ups).
 */

const PREMIUM_KEY = 'castmate:premium';
/** Separate key so the existing '1'/'0' flag needs no migration. */
const SOURCE_KEY = 'castmate:premiumSource';

const ONE_TIME_SKUS = (Object.keys(PLAN_KIND) as PlanKey[])
  .filter((k) => PLAN_KIND[k] === 'oneTime')
  .map((k) => IAP_PRODUCT_IDS[k]);
const SUBSCRIPTION_SKUS = (Object.keys(PLAN_KIND) as PlanKey[])
  .filter((k) => PLAN_KIND[k] === 'subscription')
  .map((k) => IAP_PRODUCT_IDS[k]);

/** Lazily require react-native-iap so a missing native module can't crash import. */
function getIap(): typeof import('react-native-iap') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-iap');
  } catch {
    return null;
  }
}

// Listener handles kept module-local so teardown can remove them.
let purchaseUpdateSub: { remove: () => void } | null = null;
let purchaseErrorSub: { remove: () => void } | null = null;

async function persistPremium(value: boolean, source: PremiumSource): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [PREMIUM_KEY, value ? '1' : '0'],
      [SOURCE_KEY, source ?? ''],
    ]);
  } catch {
    /* storage best-effort */
  }
}

/** Best-effort mirror of premium status to Firestore (never fatal). */
async function syncPremiumToBackend(isPremium: boolean): Promise<void> {
  try {
    const [{ getAuth }, firestore] = await Promise.all([
      import('@react-native-firebase/auth'),
      import('@/services/firebase/firestore'),
    ]);
    const uid = getAuth().currentUser?.uid;
    if (uid && typeof firestore.setUserPremium === 'function') {
      await firestore.setUserPremium(uid, isPremium);
    }
  } catch {
    /* firebase layer may not be built yet — ignore */
  }
}

interface SubscriptionState {
  isPremium: boolean;
  /** Which purchase grants it — for UI copy only, never for access decisions. */
  source: PremiumSource;
  /** Store catalogue for both plans, keyed by plan. */
  products: Partial<Record<PlanKey, any>>;
  /** Product ids the store reports as owned (drives the "cancel yearly" hint). */
  ownedProductIds: string[];
  initialized: boolean;
  purchasing: boolean;
  /** Plan currently being bought, so only its card shows a spinner. */
  pendingPlan: PlanKey | null;
  error: string | null;
  init: () => Promise<void>;
  purchase: (plan: PlanKey) => Promise<void>;
  restore: () => Promise<void>;
  /** DEVELOPMENT ONLY — force premium on/off for testing without a real purchase. */
  setPremiumDev: (v: boolean) => void;
  teardown: () => void;
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  isPremium: false,
  source: null,
  products: {},
  ownedProductIds: [],
  initialized: false,
  purchasing: false,
  pendingPlan: null,
  error: null,

  init: async () => {
    if (get().initialized) return;
    set({ initialized: true });

    // Subscriptions disabled → no store connection, no product lookups, no
    // purchase listeners. The products need not even exist in the stores.
    // Entitlements grant everything anyway (see useEntitlements), so there is
    // nothing to restore either.
    if (!SUBSCRIPTIONS_ENABLED) return;

    // 1. Hydrate the last known entitlement so the UI is correct instantly.
    try {
      const pairs = await AsyncStorage.multiGet([PREMIUM_KEY, SOURCE_KEY]);
      const stored = pairs[0]?.[1];
      const storedSource = pairs[1]?.[1];
      if (stored === '1') {
        // An older install has the flag but no source — entitled, source
        // unknown. Never branch on source for access, only for copy.
        const source: PremiumSource =
          storedSource === 'lifetime' || storedSource === 'subscription' ? storedSource : null;
        set({ isPremium: true, source });
      }
    } catch {
      /* ignore */
    }

    const iap = getIap();
    if (!iap) {
      set({ error: null });
      return; // No native module — remain in the hydrated/free state.
    }

    try {
      await iap.initConnection();

      // 2. Load BOTH catalogues. They are separate calls because the products
      //    are separate types; one failing must not hide the other.
      const products: Partial<Record<PlanKey, any>> = {};
      const [oneTime, subs] = await Promise.all([
        ONE_TIME_SKUS.length > 0
          ? iap.getProducts({ skus: ONE_TIME_SKUS }).catch(() => [])
          : Promise.resolve([]),
        SUBSCRIPTION_SKUS.length > 0
          ? iap.getSubscriptions({ skus: SUBSCRIPTION_SKUS }).catch(() => [])
          : Promise.resolve([]),
      ]);
      for (const p of [...(oneTime ?? []), ...(subs ?? [])] as any[]) {
        const id = p?.productId ?? p?.sku;
        if (id === IAP_PRODUCT_IDS.lifetime) products.lifetime = p;
        else if (id === IAP_PRODUCT_IDS.yearly) products.yearly = p;
      }
      set({ products });

      // 3. React to purchases (including deferred / restored ones).
      purchaseUpdateSub = iap.purchaseUpdatedListener(async (purchase: any) => {
        const receipt = purchase?.transactionReceipt ?? purchase?.purchaseToken;
        if (!receipt) return;
        const productId: string | undefined = purchase?.productId ?? purchase?.sku;
        try {
          // NOTE: validate `receipt` server-side before granting entitlements.
          // isConsumable is false for BOTH plans: a lifetime unlock must stay
          // owned, and a subscription is never consumed either.
          await iap.finishTransaction({ purchase, isConsumable: false });

          const source = sourceForProductId(productId) ?? get().source;
          const owned = productId
            ? [...new Set([...get().ownedProductIds, productId])]
            : get().ownedProductIds;
          set({
            isPremium: true,
            source,
            ownedProductIds: owned,
            purchasing: false,
            pendingPlan: null,
            error: null,
          });
          await persistPremium(true, source);
          void syncPremiumToBackend(true);
          trackPurchase(productId ?? 'premium');
        } catch (e: any) {
          set({
            purchasing: false,
            pendingPlan: null,
            error: e?.message ?? 'Failed to finalize purchase',
          });
        }
      });

      purchaseErrorSub = iap.purchaseErrorListener((err: any) => {
        // E_USER_CANCELLED is a normal, non-error outcome.
        const cancelled = err?.code === 'E_USER_CANCELLED';
        set({
          purchasing: false,
          pendingPlan: null,
          error: cancelled ? null : err?.message ?? 'Purchase error',
        });
      });
    } catch (e: any) {
      set({ error: e?.message ?? 'Store connection failed' });
    }
  },

  purchase: async (plan: PlanKey) => {
    const iap = getIap();
    if (!iap) {
      set({ error: 'In-app purchases are unavailable in this build.' });
      return;
    }
    set({ purchasing: true, pendingPlan: plan, error: null });
    const sku = IAP_PRODUCT_IDS[plan];
    try {
      if (PLAN_KIND[plan] === 'subscription') {
        await iap.requestSubscription({ sku, subscriptionOffers: [] as any });
      } else {
        // Non-consumable. Arg shape differs across platforms and RN-IAP
        // versions, so pass both spellings.
        await iap.requestPurchase({ sku, skus: [sku] } as any);
      }
      // Success is finalized by the purchaseUpdatedListener.
    } catch (e: any) {
      const cancelled = e?.code === 'E_USER_CANCELLED';
      set({
        purchasing: false,
        pendingPlan: null,
        error: cancelled ? null : e?.message ?? 'Purchase failed',
      });
    }
  },

  restore: async () => {
    const iap = getIap();
    if (!iap) {
      set({ error: 'Restore is unavailable in this build.' });
      return;
    }
    set({ purchasing: true, error: null });
    try {
      // onlyIncludeActiveItems is the library default, but state it: relying on
      // a default for whether a lapsed subscription counts as owned is exactly
      // the kind of thing that changes under you in a minor version bump.
      const purchases = (await iap.getAvailablePurchases({ onlyIncludeActiveItems: true })) ?? [];
      const ids = purchases
        .map((p: any) => p?.productId ?? p?.sku)
        .filter((id: unknown): id is string => typeof id === 'string');

      // Precedence (lifetime over subscription) lives in a pure, tested helper.
      const { isPremium, source } = resolvePremium(ids);
      set({ isPremium, source, ownedProductIds: ids, purchasing: false });
      await persistPremium(isPremium, source);
      if (isPremium) void syncPremiumToBackend(true);
      else set({ error: 'No previous purchase found to restore.' });
    } catch (e: any) {
      set({ purchasing: false, error: e?.message ?? 'Restore failed' });
    }
  },

  // DEVELOPMENT ONLY: bypass the store to toggle premium locally.
  setPremiumDev: (v: boolean) => {
    set({ isPremium: v, source: v ? 'lifetime' : null });
    void persistPremium(v, v ? 'lifetime' : null);
  },

  teardown: () => {
    try {
      purchaseUpdateSub?.remove();
      purchaseErrorSub?.remove();
      purchaseUpdateSub = null;
      purchaseErrorSub = null;
      getIap()?.endConnection?.();
    } catch {
      /* ignore */
    }
    set({ initialized: false });
  },
}));

/** Convenience selector hook. */
export const useIsPremium = (): boolean => useSubscriptionStore((s) => s.isPremium);
