import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { dayKeyOf } from './adPolicy';

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
  /** Rewarded "Premium Preview" expiry (epoch ms) or null. */
  previewUntil: number | null;

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
  grantPreview: (until: number) => void;
  setNonPersonalized: (value: boolean) => void;
}

export const useAdsStore = create<AdsState>()(
  persist(
    (set, get) => ({
      installedAt: 0,
      completedSessions: 0,
      lastInterstitialAt: null,
      interstitialDayKey: '',
      interstitialCountToday: 0,
      previewUntil: null,

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

      grantPreview: (until) => set({ previewUntil: until }),

      setNonPersonalized: (value) => set({ nonPersonalized: value }),
    }),
    {
      name: 'fishon:ads',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        installedAt: s.installedAt,
        completedSessions: s.completedSessions,
        lastInterstitialAt: s.lastInterstitialAt,
        interstitialDayKey: s.interstitialDayKey,
        interstitialCountToday: s.interstitialCountToday,
        previewUntil: s.previewUntil,
      }),
      // Stamp the install timestamp once, after hydration, so the 24h grace
      // window anchors to genuine first launch instead of every cold start.
      onRehydrateStorage: () => () => {
        useAdsStore.getState().stampInstall();
      },
    },
  ),
);
