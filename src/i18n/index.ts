import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import {
  FALLBACK_LANGUAGE,
  type Language,
  type LanguagePreference,
  resolveLanguage,
  SUPPORTED_LANGUAGES,
} from './languages';
import en from './locales/en';
import es from './locales/es';
import fr from './locales/fr';

/**
 * i18next setup.
 *
 * Why i18next rather than a plain lookup table: plural rules. English has two
 * forms, but CLDR gives French `one/many/other` and Spanish `one/many/other`,
 * and a hand-rolled `count === 1 ? a : b` is wrong in both. i18next drives
 * plurals off Intl.PluralRules, so each language gets its own categories
 * without the call sites knowing anything about them.
 */

const resources = {
  en: { translation: en },
  fr: { translation: fr },
  es: { translation: es },
} as const;

/**
 * Device locale tags in the user's own preference order.
 *
 * expo-localization is required lazily and defensively: it is a native module,
 * so it is absent in Jest and in any build where it hasn't been linked. Falling
 * back to an empty list simply means "no device preference", which resolves to
 * English rather than throwing at startup.
 */
export function getDeviceLanguageTags(): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getLocales } = require('expo-localization') as typeof import('expo-localization');
    return getLocales()
      .map((l) => l.languageTag)
      .filter((t): t is string => typeof t === 'string');
  } catch {
    return [];
  }
}

let initialized = false;

/** Idempotent init. Call once, as early as possible, before the first render. */
export function initI18n(preference: LanguagePreference = 'system'): Language {
  const language = resolveLanguage(preference, getDeviceLanguageTags());

  if (!initialized) {
    void i18n.use(initReactI18next).init({
      resources,
      lng: language,
      fallbackLng: FALLBACK_LANGUAGE,
      supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
      // React already escapes everything it renders; letting i18next escape too
      // would double-encode apostrophes, which French and Spanish are full of.
      interpolation: { escapeValue: false },
      returnNull: false,
      // Nothing is loaded over the network — all three locales are bundled — so
      // there is no suspense boundary to wait on.
      react: { useSuspense: false },
    });
    initialized = true;
  } else if (i18n.language !== language) {
    void i18n.changeLanguage(language);
  }

  return language;
}

/** Switch language at runtime. Components re-render via react-i18next. */
export function applyLanguagePreference(preference: LanguagePreference): Language {
  const language = resolveLanguage(preference, getDeviceLanguageTags());
  if (i18n.language !== language) void i18n.changeLanguage(language);
  return language;
}

/** Current language, always one of SUPPORTED_LANGUAGES. */
export function currentLanguage(): Language {
  const base = (i18n.language ?? FALLBACK_LANGUAGE).split('-')[0] ?? FALLBACK_LANGUAGE;
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(base)
    ? (base as Language)
    : FALLBACK_LANGUAGE;
}

export default i18n;
export * from './languages';
