import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { applyLanguagePreference, getDeviceLanguageTags, initI18n } from './index';
import { type Language, type LanguagePreference, resolveLanguage } from './languages';

/**
 * The user's language preference, persisted.
 *
 * Kept out of settingsStore deliberately: i18n has to initialise before the
 * first render, and settingsStore hydrates asynchronously alongside everything
 * else. A separate tiny store lets the language be resolved and applied on its
 * own schedule without the rest of settings waiting on it, or vice versa.
 */
interface LanguageState {
  /** What the user picked. 'system' (the default) follows the device. */
  preference: LanguagePreference;
  /** The language actually in effect, after resolving 'system'. */
  active: Language;
  setPreference: (preference: LanguagePreference) => void;
}

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set) => ({
      preference: 'system',
      active: resolveLanguage('system', getDeviceLanguageTags()),

      setPreference: (preference) => {
        const active = applyLanguagePreference(preference);
        set({ preference, active });
      },
    }),
    {
      name: 'castmate:language',
      storage: createJSONStorage(() => AsyncStorage),
      // Only the choice is persisted; `active` is derived on every launch so a
      // user on 'system' follows their phone if they change its language.
      partialize: (s) => ({ preference: s.preference }),
      onRehydrateStorage: () => (state) => {
        const preference = state?.preference ?? 'system';
        const active = initI18n(preference);
        useLanguageStore.setState({ active });
      },
    },
  ),
);

export const useActiveLanguage = (): Language => useLanguageStore((s) => s.active);
export const useLanguagePreference = (): LanguagePreference =>
  useLanguageStore((s) => s.preference);
