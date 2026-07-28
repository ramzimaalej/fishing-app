/**
 * Language catalogue and resolution — pure, so locale negotiation is testable
 * without a device, a store, or i18next.
 */

/** Languages the app ships copy for. `en` is the base and the fallback. */
export const SUPPORTED_LANGUAGES = ['en', 'fr', 'es'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** What the user chose. `system` follows the device and is the default. */
export type LanguagePreference = Language | 'system';

export const FALLBACK_LANGUAGE: Language = 'en';

/**
 * Endonyms — each language named in itself. Never "French/Spanish" in English:
 * someone hunting for their own language scans for the word they recognise, and
 * may not read the current UI language at all.
 */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
};

export function isSupported(tag: string): tag is Language {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(tag);
}

/**
 * Base language of a BCP-47 tag: `fr-CA` → `fr`, `es-419` → `es`.
 *
 * Regional variants collapse to their base because we ship one file per
 * language. A Quebecois user getting France French is a far better outcome than
 * falling through to English.
 */
export function baseLanguage(tag: string): string {
  return tag.toLowerCase().split(/[-_]/)[0] ?? '';
}

/**
 * First supported language among the device's preferred locales.
 *
 * Device locales arrive in the user's own priority order, so the first match
 * wins — someone who lists Spanish above English wants Spanish, even though we
 * support both.
 */
export function matchDeviceLanguage(deviceTags: readonly string[]): Language | null {
  for (const tag of deviceTags) {
    const base = baseLanguage(tag);
    if (isSupported(base)) return base;
  }
  return null;
}

/**
 * The language to actually render in.
 *
 * An explicit choice always wins over the device — someone who picked English
 * on a French phone meant it, and must not be overridden on next launch.
 */
export function resolveLanguage(
  preference: LanguagePreference,
  deviceTags: readonly string[],
): Language {
  if (preference !== 'system') return preference;
  return matchDeviceLanguage(deviceTags) ?? FALLBACK_LANGUAGE;
}
