import type en from './locales/en';

/**
 * Makes `t()` CALL SITES type-checked against the English resource.
 *
 * Without this, i18next accepts any string, so `t('paywall.legal')` compiled
 * happily after that key was deleted and would have rendered the literal text
 * "paywall.legal" to a user. The `Translation` type in locales/types.ts only
 * enforces parity BETWEEN locale files — it says nothing about whether a key a
 * screen asks for exists.
 *
 * With this augmentation both halves are covered: a key missing from a
 * translation fails via `Translation`, and a key no locale defines fails here.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: typeof en;
    };
  }
}
