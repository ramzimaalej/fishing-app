import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { dayKeyOf } from '@/utils/dayKey';

import { createWindow, extendWindow, type SessionWindow } from './sessionLimit';

/**
 * The active fishing session and the day's free allowance.
 *
 * PERSISTED deliberately. If the window lived in memory, force-quitting the app
 * would hand out a fresh 6 hours and the cap would be trivially bypassable. It
 * also means a session survives the phone being restarted mid-night, which is
 * what an angler asleep next to three rods actually needs.
 */

interface FishingSessionState {
  /** Null when no session is running. Survives restarts. */
  window: SessionWindow | null;
  /** Local day the counters below belong to (see dayKeyOf). */
  dayKey: string;
  /**
   * Blocks of fishing consumed today — the opening session plus every
   * extension. Both grant the same amount of time, so both count; otherwise a
   * user could end and restart instead of watching the extension ad.
   */
  blocksUsedToday: number;

  start: (isPremium: boolean) => SessionWindow;
  /** Apply one extension block to the running session. */
  extend: () => void;
  end: () => void;
  /** Blocks used on the local day containing `now`, normalised across midnight. */
  usedToday: (now: number) => number;
}

export const useFishingSessionStore = create<FishingSessionState>()(
  persist(
    (set, get) => ({
      window: null,
      dayKey: '',
      blocksUsedToday: 0,

      start: (isPremium) => {
        const now = Date.now();
        const key = dayKeyOf(now);
        const window = createWindow(now, isPremium, key);
        set((s) => ({
          window,
          dayKey: key,
          // Premium sessions are unlimited, so they consume no allowance —
          // counting them would be meaningless and would leak into the free
          // tally if a subscription later lapsed.
          blocksUsedToday: isPremium
            ? s.dayKey === key
              ? s.blocksUsedToday
              : 0
            : (s.dayKey === key ? s.blocksUsedToday : 0) + 1,
        }));
        return window;
      },

      extend: () =>
        set((s) => {
          if (!s.window) return s;
          const now = Date.now();
          const key = dayKeyOf(now);
          return {
            window: extendWindow(s.window, now),
            dayKey: key,
            blocksUsedToday: (s.dayKey === key ? s.blocksUsedToday : 0) + 1,
          };
        }),

      end: () => set({ window: null }),

      usedToday: (now) => {
        const s = get();
        return s.dayKey === dayKeyOf(now) ? s.blocksUsedToday : 0;
      },
    }),
    {
      name: 'castmate:session',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        window: s.window,
        dayKey: s.dayKey,
        blocksUsedToday: s.blocksUsedToday,
      }),
    },
  ),
);

export const useSessionWindow = (): SessionWindow | null =>
  useFishingSessionStore((s) => s.window);
