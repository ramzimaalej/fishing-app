import {
  baseLanguage,
  FALLBACK_LANGUAGE,
  isSupported,
  LANGUAGE_NAMES,
  matchDeviceLanguage,
  resolveLanguage,
  SUPPORTED_LANGUAGES,
} from '../languages';

describe('language catalogue', () => {
  it('names every supported language', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(LANGUAGE_NAMES[lang]).toBeTruthy();
    }
  });

  it('names each language in itself, not in English', () => {
    // Someone hunting for their own language scans for the word they recognise
    // and may not read the current UI language at all.
    expect(LANGUAGE_NAMES.fr).toBe('Français');
    expect(LANGUAGE_NAMES.es).toBe('Español');
  });

  it('includes the fallback among the supported set', () => {
    expect(SUPPORTED_LANGUAGES).toContain(FALLBACK_LANGUAGE);
  });
});

describe('baseLanguage', () => {
  it.each([
    ['fr', 'fr'],
    ['fr-FR', 'fr'],
    ['fr-CA', 'fr'],
    ['es-419', 'es'],
    ['en_GB', 'en'],
    ['PT-BR', 'pt'],
  ])('reduces %s to %s', (tag, expected) => {
    expect(baseLanguage(tag)).toBe(expected);
  });

  it('handles an empty tag', () => {
    expect(baseLanguage('')).toBe('');
  });
});

describe('isSupported', () => {
  it('accepts shipped languages and rejects others', () => {
    expect(isSupported('en')).toBe(true);
    expect(isSupported('fr')).toBe(true);
    expect(isSupported('es')).toBe(true);
    expect(isSupported('de')).toBe(false);
    expect(isSupported('fr-FR')).toBe(false); // base language only
  });
});

describe('matchDeviceLanguage', () => {
  it('matches a regional variant to its base language', () => {
    // A Quebecois user getting France French beats falling through to English.
    expect(matchDeviceLanguage(['fr-CA'])).toBe('fr');
    expect(matchDeviceLanguage(['es-MX'])).toBe('es');
  });

  it('honours the device preference ORDER, not our own', () => {
    // Someone who ranks Spanish above English wants Spanish, even though we
    // ship both.
    expect(matchDeviceLanguage(['es-ES', 'en-GB'])).toBe('es');
    expect(matchDeviceLanguage(['en-GB', 'es-ES'])).toBe('en');
  });

  it('skips unsupported languages to reach a supported one', () => {
    expect(matchDeviceLanguage(['de-DE', 'it-IT', 'fr-FR'])).toBe('fr');
  });

  it('returns null when nothing matches', () => {
    expect(matchDeviceLanguage(['de-DE', 'ja-JP'])).toBeNull();
    expect(matchDeviceLanguage([])).toBeNull();
  });
});

describe('resolveLanguage', () => {
  it('follows the device when the preference is "system"', () => {
    expect(resolveLanguage('system', ['fr-FR'])).toBe('fr');
  });

  it('falls back to English when the device speaks nothing we ship', () => {
    expect(resolveLanguage('system', ['de-DE'])).toBe(FALLBACK_LANGUAGE);
    expect(resolveLanguage('system', [])).toBe(FALLBACK_LANGUAGE);
  });

  it('lets an explicit choice override the device', () => {
    // Someone who picked English on a French phone meant it, and must not be
    // overridden on the next launch.
    expect(resolveLanguage('en', ['fr-FR'])).toBe('en');
    expect(resolveLanguage('es', ['fr-FR', 'en-GB'])).toBe('es');
  });

  it('always returns a supported language', () => {
    for (const tags of [[], ['zz'], ['de-DE'], ['fr-CA', 'es-MX']]) {
      expect(SUPPORTED_LANGUAGES).toContain(resolveLanguage('system', tags));
    }
  });
});
