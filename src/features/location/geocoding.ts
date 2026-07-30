import type { GeoPlace } from './location';

/**
 * City search via Open-Meteo's Geocoding API (GeoNames data, no key).
 *
 * Same provider as the forecast, so it inherits the same licence position — see
 * the licensing note in the README.
 *
 * The response mapping is exported separately and kept pure, because that is
 * where the defensiveness lives: GeoNames rows have wildly inconsistent
 * completeness, and a result missing `admin1`, `country` or even `timezone` must
 * still be usable rather than crashing a list render.
 */

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/** Raw row shape. Everything except name/lat/lon is genuinely optional. */
interface GeocodingRow {
  id?: number;
  name?: string;
  latitude?: number;
  longitude?: number;
  admin1?: string;
  country?: string;
  country_code?: string;
  timezone?: string;
}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * Map raw rows to places, dropping anything unusable.
 *
 * A row without usable coordinates is discarded rather than defaulted: a search
 * result that silently points at 0°,0° would send someone fishing in the Gulf of
 * Guinea.
 */
export function mapGeocodingResults(rows: readonly GeocodingRow[] | undefined | null): GeoPlace[] {
  if (!rows) return [];
  const out: GeoPlace[] = [];
  for (const row of rows) {
    if (!row?.name) continue;
    if (!isFiniteNumber(row.latitude) || !isFiniteNumber(row.longitude)) continue;
    if (Math.abs(row.latitude) > 90 || Math.abs(row.longitude) > 180) continue;

    out.push({
      // GeoNames ids are stable; fall back to a coordinate key so a row without
      // one still gets a usable React key.
      id: row.id != null ? String(row.id) : `${row.latitude},${row.longitude}`,
      name: row.name,
      admin1: row.admin1 || undefined,
      country: row.country || undefined,
      countryCode: row.country_code || undefined,
      latitude: row.latitude,
      longitude: row.longitude,
      timezone: row.timezone || undefined,
    });
  }
  return out;
}

export interface SearchOptions {
  /** UI language, so results come back in the user's own language. */
  language?: string;
  count?: number;
  signal?: AbortSignal;
}

/**
 * Search for places by name. Returns [] for a blank or too-short query rather
 * than hitting the network on every keystroke of a single letter.
 */
export async function searchPlaces(
  query: string,
  { language = 'en', count = 10, signal }: SearchOptions = {},
): Promise<GeoPlace[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const url =
    `${GEOCODING_URL}?name=${encodeURIComponent(trimmed)}` +
    `&count=${count}&language=${encodeURIComponent(language)}&format=json`;

  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  const body = (await res.json()) as { results?: GeocodingRow[] };
  return mapGeocodingResults(body.results);
}
