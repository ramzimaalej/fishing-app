import { enGB, es as esLocale, fr as frLocale } from 'date-fns/locale';
import type { Locale } from 'date-fns';

import { currentLanguage } from './index';
import type { Language } from './languages';

/**
 * Locale-aware date and number formatting.
 *
 * Translating strings is the visible half of i18n; this is the half that gets
 * forgotten and then looks broken. A French user shown "Mon 27 Jul" or
 * "1,234.5" knows the app was translated but not localised.
 *
 * Two formatting systems are in play and both need the locale:
 *  - date-fns `format()` takes a locale OBJECT (the imports above);
 *  - `Intl` / `toLocaleDateString` take a locale TAG string.
 * Hence the two maps.
 */

/** date-fns locale objects. en → enGB for day-first dates and 24-hour time. */
const DATE_FNS_LOCALES: Record<Language, Locale> = {
  en: enGB,
  fr: frLocale,
  es: esLocale,
};

/** BCP-47 tags for Intl. */
const INTL_TAGS: Record<Language, string> = {
  en: 'en-GB',
  fr: 'fr-FR',
  es: 'es-ES',
};

export function dateFnsLocale(language: Language = currentLanguage()): Locale {
  return DATE_FNS_LOCALES[language];
}

export function intlTag(language: Language = currentLanguage()): string {
  return INTL_TAGS[language];
}

/** Options bag for date-fns `format()`. Spread it at the call site. */
export function dateFnsOptions(language: Language = currentLanguage()): { locale: Locale } {
  return { locale: dateFnsLocale(language) };
}

/**
 * A number formatted for the current language — 1.5 renders as "1,5" in French
 * and Spanish. Use anywhere a raw `toFixed()` would otherwise leak an
 * English decimal point into translated copy.
 */
export function formatNumber(
  value: number,
  fractionDigits = 0,
  language: Language = currentLanguage(),
): string {
  try {
    return new Intl.NumberFormat(intlTag(language), {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  } catch {
    // Hermes ships Intl, but never let a formatting failure blank out a value.
    return value.toFixed(fractionDigits);
  }
}

/** Percentage as a whole number, localised. */
export function formatPercent(fraction: number, language: Language = currentLanguage()): string {
  return formatNumber(Math.round(fraction * 100), 0, language);
}
