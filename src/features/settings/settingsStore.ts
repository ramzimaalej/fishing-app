/**
 * Persisted user settings store (zustand + AsyncStorage).
 *
 * Settings survive app restarts via the `persist` middleware. On rehydrate we
 * merge any keys missing from stored state with DEFAULT_SETTINGS so that adding
 * a new setting in a future release never leaves it `undefined`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_SETTINGS } from '@/config/constants';
import type { AppSettings } from '@/types';

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

interface SettingsState {
  settings: AppSettings;
  /** True once persisted state has been loaded from disk. */
  hydrated: boolean;
  setSensitivity: (n: number) => void;
  setLiveBaitMode: (b: boolean) => void;
  setVibration: (b: boolean) => void;
  setSoundEnabled: (b: boolean) => void;
  setSoundKey: (k: string) => void;
  setPushEnabled: (b: boolean) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      hydrated: false,
      setSensitivity: (n) =>
        set((s) => ({ settings: { ...s.settings, sensitivity: clamp01(n) } })),
      setLiveBaitMode: (b) =>
        set((s) => ({ settings: { ...s.settings, liveBaitMode: b } })),
      setVibration: (b) =>
        set((s) => ({ settings: { ...s.settings, vibrationEnabled: b } })),
      setSoundEnabled: (b) =>
        set((s) => ({ settings: { ...s.settings, soundEnabled: b } })),
      setSoundKey: (k) => set((s) => ({ settings: { ...s.settings, soundKey: k } })),
      setPushEnabled: (b) =>
        set((s) => ({ settings: { ...s.settings, pushEnabled: b } })),
      reset: () => set({ settings: DEFAULT_SETTINGS }),
    }),
    {
      name: 'fishon:settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ settings: state.settings }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Backfill any keys added since the persisted version was written.
          state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
          state.hydrated = true;
        }
      },
    },
  ),
);

/** Convenience selector — the settings object only. */
export const useSettings = (): AppSettings => useSettingsStore((s) => s.settings);
