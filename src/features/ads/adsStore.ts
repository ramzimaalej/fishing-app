import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { dayKeyOf } from './adPolicy';
import {
  pruneGrants,
  REWARD_KINDS,
  rewardExpiry,
  type RewardGrants,
  type RewardKind,
} from './rewards';

/**
 * Durable ad-governance state. Frequency caps survive app restarts on purpose:
 * killing the app must not reset the daily interstitial budget.
 *
 * Volatile flags (fishingActive, nonPersonalized) are intentionally excluded
 * from persistence via `partialize`.
 */

interface AdsState {
  /** Epoch ms of first launch (0 until stamped after first hydration). */
  installedAt: number;
  /** Lifetime completed (meaningful) fishing sessions. */
  completedSessions: number;
  lastInterstitialAt: number | null;
  /** Local day the daily counter belongs to (see dayKeyOf). */
  interstitialDayKey: string;
  interstitialCountToday: number;
  /** Per-feature rewarded unlocks: kind → expiry epoch ms (see rewards.ts). */
  rewardGrants: RewardGrants;

  // Volatile (not persisted).
  /** True while a fishing session is running — hard-blocks full-screen ads. */
  fishingActive: boolean;
  /** True when consent was not obtained → request non-personalized ads only. */
  nonPersonalized: boolean;

  stampInstall: () => void;
  setFishingActive: (active: boolean) => void;
  recordCompletedSession: () => void;
  recordInterstitialShown: (now: number) => void;
  /** Interstitials shown today, normalized across the local-midnight rollover. */
  shownToday: (now: number) => number;
  /** Unlock one feature for its configured duration (rewarded ad earned). */
  grantReward: (kind: RewardKind) => void;
  setNonPersonalized: (value: boolean) => void;
}

/** v1 persisted a single 24h all-features `previewUntil`. */
interface LegacyV1 {
  previewUntil?: number | null;
}

export const useAdsStore = create<AdsState>()(
  persist(
    (set, get) => ({
      installedAt: 0,
      completedSessions: 0,
      lastInterstitialAt: null,
      interstitialDayKey: '',
      interstitialCountToday: 0,
      rewardGrants: {},

      fishingActive: false,
      nonPersonalized: true,

      stampInstall: () => {
        if (get().installedAt === 0) set({ installedAt: Date.now() });
      },

      setFishingActive: (active) => set({ fishingActive: active }),

      recordCompletedSession: () =>
        set((s) => ({ completedSessions: s.completedSessions + 1 })),

      recordInterstitialShown: (now) => {
        const key = dayKeyOf(now);
        set((s) => ({
          lastInterstitialAt: now,
          interstitialDayKey: key,
          interstitialCountToday: s.interstitialDayKey === key ? s.interstitialCountToday + 1 : 1,
        }));
      },

      shownToday: (now) => {
        const s = get();
        return s.interstitialDayKey === dayKeyOf(now) ? s.interstitialCountToday : 0;
      },

      grantReward: (kind) => {
        const now = Date.now();
        set((s) => ({
          // Prune while we're here so lapsed keys don't accumulate forever.
          rewardGrants: { ...pruneGrants(s.rewardGrants, now), [kind]: rewardExpiry(kind, now) },
        }));
      },

      setNonPersonalized: (value) => set({ nonPersonalized: value }),
    }),
    {
      name: 'castmate:ads',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      partialize: (s) => ({
        installedAt: s.installedAt,
        completedSessions: s.completedSessions,
        lastInterstitialAt: s.lastInterstitialAt,
        interstitialDayKey: s.interstitialDayKey,
        interstitialCountToday: s.interstitialCountToday,
        rewardGrants: s.rewardGrants,
      }),
      /**
       * v1 → v2: the single 24h "Premium Preview" became per-feature unlocks.
       * Anyone mid-preview keeps it: we honour the remaining time across every
       * kind rather than revoking something they already watched an ad for.
       */
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<AdsState> & LegacyV1;
        if (version >= 2) return state as AdsState;
        const until = state.previewUntil;
        const grants: RewardGrants = {};
        if (typeof until === 'number' && until > Date.now()) {
          for (const k of REWARD_KINDS) grants[k] = until;
        }
        delete state.previewUntil;
        return { ...state, rewardGrants: grants } as AdsState;
      },
      // Stamp the install timestamp once, after hydration, so the 24h grace
      // window anchors to genuine first launch instead of every cold start.
      onRehydrateStorage: () => () => {
        useAdsStore.getState().stampInstall();
      },
    },
  ),
);
