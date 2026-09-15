/**
 * Lifetime record of whether waking a sleeping tag actually works.
 *
 * The keep-alive counts attempts against wakes because nothing captured says a
 * connection makes a sleeping CP27 resume broadcasting — the feature has to be
 * able to report whether it ever does. Those counters lived on the rod runtime,
 * which is built fresh on every arm, so they reset every time a session ended.
 *
 * That made the measurement unobtainable in practice rather than merely
 * inconvenient. Getting a number required one uninterrupted armed session in
 * which the tag also happened to go quiet, and across several attempts every
 * session ended first — killed by Android, backed out of, or stopped. A
 * measurement that cannot survive the thing it needs to outlast is not a
 * measurement.
 *
 * WHAT PERSISTS AND WHAT DOES NOT. Evidence persists; schedule does not. The
 * retry interval and its backoff stay on the runtime and start fresh each
 * session — a rod armed this morning should not inherit a ten-minute backoff
 * earned by a tag that was left at home yesterday. Attempts and wakes are facts
 * about the hardware and accumulate for the life of the install.
 *
 * KEYED BY TAG, NOT ROD. The question is whether waking THIS tag works, and a
 * tag moved between rods carries its own answer with it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface DeviceWakeStats {
  /** Connection attempts made because the tag had gone quiet. */
  attempts: number;
  /** Attempts followed by an advertisement soon enough to be credited. */
  wakes: number;
  /** Wall-clock ms of the most recent attempt, for "when did we last try". */
  lastAttemptAt: number | null;
  /** Rod name as it was at the last attempt — display only. */
  label: string | null;
}

interface WakeStatsState {
  byDevice: Record<string, DeviceWakeStats>;
  recordAttempt: (deviceId: string, label: string) => void;
  recordWake: (deviceId: string) => void;
  reset: () => void;
}

const EMPTY: DeviceWakeStats = { attempts: 0, wakes: 0, lastAttemptAt: null, label: null };

export const useWakeStatsStore = create<WakeStatsState>()(
  persist(
    (set) => ({
      byDevice: {},

      recordAttempt: (deviceId, label) =>
        set((s) => {
          const prev = s.byDevice[deviceId] ?? EMPTY;
          return {
            byDevice: {
              ...s.byDevice,
              [deviceId]: {
                ...prev,
                attempts: prev.attempts + 1,
                lastAttemptAt: Date.now(),
                label,
              },
            },
          };
        }),

      recordWake: (deviceId) =>
        set((s) => {
          // Only ever credited against an attempt that was recorded, so a wake
          // can never exceed the attempts it is measured against.
          const prev = s.byDevice[deviceId];
          if (!prev) return s;
          return {
            byDevice: { ...s.byDevice, [deviceId]: { ...prev, wakes: prev.wakes + 1 } },
          };
        }),

      reset: () => set({ byDevice: {} }),
    }),
    {
      name: 'castmate:wake-stats',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

/** Totals for every tag ever woken, newest attempt first. */
export function wakeStatsByDevice(): (DeviceWakeStats & { deviceId: string })[] {
  return Object.entries(useWakeStatsStore.getState().byDevice)
    .map(([deviceId, stats]) => ({ deviceId, ...stats }))
    .sort((a, b) => (b.lastAttemptAt ?? 0) - (a.lastAttemptAt ?? 0));
}
