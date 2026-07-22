import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { IAP_PRODUCT_IDS } from '@/config/constants';

/**
 * Premium subscription store backed by react-native-iap.
 *
 * The whole IAP surface is loaded lazily and guarded: when the native module
 * is unavailable (e.g. running in Expo Go or a build without the IAP native
 * code linked) the store degrades gracefully to `isPremium: false` and never
 * throws. Real receipt validation should happen server-side (see follow-ups).
 */

const PREMIUM_KEY = 'fishon:premium';
const PRODUCT_IDS = Object.values(IAP_PRODUCT_IDS) as string[];

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

async function persistPremium(value: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(PREMIUM_KEY, value ? '1' : '0');
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
  products: any[];
  initialized: boolean;
  purchasing: boolean;
  error: string | null;
  init: () => Promise<void>;
  purchase: (productId: string) => Promise<void>;
  restore: () => Promise<void>;
  /** DEVELOPMENT ONLY — force premium on/off for testing without a real purchase. */
  setPremiumDev: (v: boolean) => void;
  teardown: () => void;
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  isPremium: false,
  products: [],
  initialized: false,
  purchasing: false,
  error: null,

  init: async () => {
    if (get().initialized) return;
    set({ initialized: true });

    // 1. Hydrate the last known premium flag so the UI is correct instantly.
    try {
      const stored = await AsyncStorage.getItem(PREMIUM_KEY);
      if (stored === '1') set({ isPremium: true });
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

      // 2. Load subscription products for display/pricing.
      try {
        const products = await iap.getSubscriptions({ skus: PRODUCT_IDS });
        set({ products: products ?? [] });
      } catch {
        set({ products: [] });
      }

      // 3. React to purchases (including deferred / restored ones).
      purchaseUpdateSub = iap.purchaseUpdatedListener(async (purchase: any) => {
        const receipt = purchase?.transactionReceipt ?? purchase?.purchaseToken;
        if (!receipt) return;
        try {
          // NOTE: validate `receipt` server-side before granting entitlements.
          await iap.finishTransaction({ purchase, isConsumable: false });
          set({ isPremium: true, purchasing: false, error: null });
          await persistPremium(true);
          void syncPremiumToBackend(true);
        } catch (e: any) {
          set({ purchasing: false, error: e?.message ?? 'Failed to finalize purchase' });
        }
      });

      purchaseErrorSub = iap.purchaseErrorListener((err: any) => {
        // E_USER_CANCELLED is a normal, non-error outcome.
        const cancelled = err?.code === 'E_USER_CANCELLED';
        set({ purchasing: false, error: cancelled ? null : err?.message ?? 'Purchase error' });
      });
    } catch (e: any) {
      set({ error: e?.message ?? 'Store connection failed' });
    }
  },

  purchase: async (productId: string) => {
    const iap = getIap();
    if (!iap) {
      set({ error: 'In-app purchases are unavailable in this build.' });
      return;
    }
    set({ purchasing: true, error: null });
    try {
      // Platform arg shapes differ across RN-IAP versions; pass both spellings.
      await iap.requestSubscription({ sku: productId, subscriptionOffers: [] as any });
      // Success is finalized by the purchaseUpdatedListener.
    } catch (e: any) {
      const cancelled = e?.code === 'E_USER_CANCELLED';
      set({ purchasing: false, error: cancelled ? null : e?.message ?? 'Purchase failed' });
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
      const purchases = await iap.getAvailablePurchases();
      const active = (purchases ?? []).some((p: any) =>
        PRODUCT_IDS.includes(p?.productId),
      );
      set({ isPremium: active, purchasing: false });
      await persistPremium(active);
      if (active) void syncPremiumToBackend(true);
      else set({ error: 'No active subscription found to restore.' });
    } catch (e: any) {
      set({ purchasing: false, error: e?.message ?? 'Restore failed' });
    }
  },

  // DEVELOPMENT ONLY: bypass the store to toggle premium locally.
  setPremiumDev: (v: boolean) => {
    set({ isPremium: v });
    void persistPremium(v);
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
