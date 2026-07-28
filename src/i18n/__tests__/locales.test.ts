import en from '../locales/en';
import es from '../locales/es';
import fr from '../locales/fr';
import { SUPPORTED_LANGUAGES } from '../languages';

/**
 * Structural checks across locale files.
 *
 * The `Translation` type already makes a missing key a compile error, so these
 * catch what types cannot: interpolation placeholders that were dropped or
 * renamed in translation, and plural variants that exist in one language but
 * not another. Both fail silently at runtime — a dropped `{{count}}` just
 * renders a sentence with a hole in it.
 */

type Tree = { [k: string]: string | Tree };

function flatten(obj: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const placeholders = (s: string): string[] =>
  (s.match(/\{\{(\w+)\}\}/g) ?? []).map((m) => m.slice(2, -2)).sort();

const EN = flatten(en as unknown as Tree);
const LOCALES: Record<string, Record<string, string>> = {
  fr: flatten(fr as unknown as Tree),
  es: flatten(es as unknown as Tree),
};

describe.each(Object.keys(LOCALES))('%s locale', (name) => {
  const locale = LOCALES[name]!;

  it('has exactly the same keys as English', () => {
    expect(Object.keys(locale).sort()).toEqual(Object.keys(EN).sort());
  });

  it('uses the same interpolation placeholders as English', () => {
    const mismatched: string[] = [];
    for (const [key, value] of Object.entries(EN)) {
      const theirs = placeholders(locale[key] ?? '');
      if (JSON.stringify(placeholders(value)) !== JSON.stringify(theirs)) {
        mismatched.push(key);
      }
    }
    // A dropped {{count}} renders a sentence with a hole in it and never throws.
    expect(mismatched).toEqual([]);
  });

  it('leaves no string empty', () => {
    const empty = Object.entries(locale)
      .filter(([, v]) => v.trim().length === 0)
      .map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it('actually translates — is not just a copy of English', () => {
    const identical = Object.entries(EN).filter(([k, v]) => locale[k] === v);
    // Some keys legitimately match (brand names, "Premium", "n", "Sensor"),
    // but the bulk must differ or the file was never translated.
    expect(identical.length).toBeLessThan(Object.keys(EN).length * 0.2);
  });
});

describe('plural variants', () => {
  it('defines _one and _other together in every locale', () => {
    for (const [name, locale] of Object.entries({ en: EN, ...LOCALES })) {
      for (const key of Object.keys(locale)) {
        if (key.endsWith('_one')) {
          const other = `${key.slice(0, -4)}_other`;
          expect(`${name}:${other}`).toBe(
            locale[other] !== undefined ? `${name}:${other}` : `${name}:MISSING ${other}`,
          );
        }
      }
    }
  });

  it('gives every plural key a {{count}} placeholder', () => {
    // i18next only selects a plural form when `count` is passed; a plural key
    // without the placeholder means the number never reaches the user.
    for (const [name, locale] of Object.entries({ en: EN, ...LOCALES })) {
      for (const [key, value] of Object.entries(locale)) {
        if (key.endsWith('_one') || key.endsWith('_other')) {
          expect(`${name}:${key}:${placeholders(value).includes('count')}`).toBe(
            `${name}:${key}:true`,
          );
        }
      }
    }
  });
});

describe('coverage', () => {
  it('ships a locale file for every supported language', () => {
    expect(SUPPORTED_LANGUAGES.slice().sort()).toEqual(['en', 'es', 'fr']);
  });
});
