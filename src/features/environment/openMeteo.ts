import type { EnvironmentSnapshot, GeoCoords, TidePoint } from '@/types';

import { predictFishActivity } from './fishActivity';
import { getMoonPhase } from './moonPhase';

/**
 * Environmental data provider abstraction. Open-Meteo is the default (free, no
 * API key), but the app depends only on this interface so the source can be
 * swapped (Stormglass, NOAA, …) without touching the UI.
 */
export interface EnvironmentProvider {
  fetchDay(coords: GeoCoords, date?: Date): Promise<EnvironmentSnapshot[]>;
  /**
   * Hourly snapshots spanning `days` calendar days starting at `startDate`.
   * Returns a single flat, chronologically ordered series — callers group it by
   * local date (the `time` field is local when the provider requests
   * `timezone=auto`, so `time.slice(0, 10)` is a safe local day key).
   */
  fetchRange(coords: GeoCoords, startDate: Date, days: number): Promise<EnvironmentSnapshot[]>;
  /**
   * Hourly ERA5 reanalysis for an inclusive past date window. Reanalysis is the
   * best available *retrospective* record — unlike a forecast it has been
   * corrected against observations — which is what makes it the right source
   * for "what conditions did I actually catch in".
   *
   * The window must end at least ERA5_LAG_DAYS ago; callers are responsible for
   * clamping (see historyWindow).
   */
  fetchHistory(coords: GeoCoords, from: Date, to: Date): Promise<EnvironmentSnapshot[]>;
}

/**
 * Longest range Open-Meteo serves on the free tier. Requests are clamped to it
 * rather than erroring, so a caller asking for a month quietly gets 16 days.
 */
export const MAX_FORECAST_DAYS = 16;

/**
 * Default location — San Francisco Bay. Real device geolocation via
 * expo-location is a follow-up; wire it into the store and pass coords here.
 */
export const DEFAULT_COORDS: GeoCoords = { latitude: 37.81, longitude: -122.36 };

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
/** ERA5 reanalysis archive — same hourly variable names as the forecast API. */
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

/**
 * How far behind "now" the ERA5 archive is considered reliable.
 *
 * ERA5 proper runs ~5 days behind; Open-Meteo backfills the gap with ERA5T and
 * model data of varying quality. We simply don't analyse the tail rather than
 * mix reanalysis with near-real-time estimates in the same statistics.
 */
export const ERA5_LAG_DAYS = 5;

interface HourlyWeather {
  time: string[];
  surface_pressure: (number | null)[];
  temperature_2m: (number | null)[];
  wind_speed_10m: (number | null)[];
  wind_direction_10m: (number | null)[];
}

interface HourlyMarine {
  time: string[];
  wave_height?: (number | null)[];
  sea_level_height_msl?: (number | null)[];
}

/**
 * yyyy-mm-dd from the date's LOCAL calendar fields. Must not go via
 * toISOString(): that converts to UTC first, so anyone east/west of Greenwich
 * would request the wrong day for part of every day.
 */
function isoDate(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo request failed (${res.status})`);
  return (await res.json()) as T;
}

/** Classify each hour's tide from the sea-level series (rising/falling/high/low). */
function deriveTides(times: string[], levels: (number | null)[] | undefined): (TidePoint | null)[] {
  if (!levels) return times.map(() => null);
  return times.map((time, i) => {
    const h = levels[i];
    if (h == null) return null;
    const prev = i > 0 ? levels[i - 1] : null;
    const next = i < levels.length - 1 ? levels[i + 1] : null;

    let state: TidePoint['state'] = 'rising';
    if (prev != null && next != null) {
      if (h >= prev && h >= next) state = 'high'; // local maximum
      else if (h <= prev && h <= next) state = 'low'; // local minimum
      else state = h > prev ? 'rising' : 'falling';
    } else if (prev != null) {
      state = h > prev ? 'rising' : 'falling';
    }
    return { time, height: h, state };
  });
}

/**
 * Pressure change rate (hPa/hour) at index i from neighbouring samples, or
 * undefined at the series start / across a data gap. Undefined means "unknown"
 * and must not be conflated with 0, which means "steady".
 */
function pressureTrend(pressures: (number | null)[], i: number): number | undefined {
  const cur = pressures[i];
  const prev = i > 0 ? pressures[i - 1] : null;
  if (cur == null || prev == null) return undefined;
  return cur - prev; // samples are hourly → already hPa/hr
}

/**
 * Shared fetch+map for an inclusive [startDay, endDay] window of local dates.
 * `baseUrl` selects the forecast API or the ERA5 archive — the hourly variable
 * names and response shape are identical across both.
 */
async function fetchWindow(
  coords: GeoCoords,
  startDay: string,
  endDay: string,
  baseUrl: string = FORECAST_URL,
): Promise<EnvironmentSnapshot[]> {
  const { latitude, longitude } = coords;

  const weatherUrl =
    `${baseUrl}?latitude=${latitude}&longitude=${longitude}` +
    `&hourly=surface_pressure,temperature_2m,wind_speed_10m,wind_direction_10m` +
    `&wind_speed_unit=ms&start_date=${startDay}&end_date=${endDay}&timezone=auto`;

  const marineUrl =
    `${MARINE_URL}?latitude=${latitude}&longitude=${longitude}` +
    `&hourly=wave_height,sea_level_height_msl&start_date=${startDay}&end_date=${endDay}` +
    `&timezone=auto`;

  // Marine data is unavailable inland — treat its failure as "no marine data"
  // rather than failing the whole request.
  const [weather, marine] = await Promise.all([
    fetchJson<{ hourly: HourlyWeather; utc_offset_seconds?: number }>(weatherUrl),
    fetchJson<{ hourly: HourlyMarine }>(marineUrl).catch(
      () => ({ hourly: { time: [] } }) as { hourly: HourlyMarine },
    ),
  ]);

  const w = weather.hourly;
  const m = marine.hourly;
  // Needed to turn the naive local times above back into real instants once the
  // location may be in a different timezone than the phone.
  const utcOffsetSeconds = weather.utc_offset_seconds;
  const marineIndex = new Map(m.time.map((t, i) => [t, i]));
  const tides = deriveTides(m.time, m.sea_level_height_msl);

  return w.time.map((time, i) => {
    const mi = marineIndex.get(time);
    const waveHeight = mi != null ? (m.wave_height?.[mi] ?? 0) : 0;
    const tide = mi != null ? (tides[mi] ?? null) : null;
    // Local-clock Date, for the hour-of-day the activity model wants (dawn/dusk
    // are local concepts). `.getHours()` on a naive string yields the location's
    // local hour, which is exactly right.
    const when = new Date(time);
    // Moon phase depends on the true instant, not the local clock.
    const instant =
      utcOffsetSeconds === undefined
        ? when
        : new Date(Date.parse(`${time}Z`) - utcOffsetSeconds * 1000);
    const moon = getMoonPhase(instant);
    const pressure = w.surface_pressure[i] ?? 1013;
    const windSpeed = w.wind_speed_10m[i] ?? 0;
    const trend = pressureTrend(w.surface_pressure, i);

    const fishActivity = predictFishActivity({
      pressure,
      // The model treats a missing trend as steady; the snapshot keeps the
      // distinction so retrospective analysis can exclude unknowns.
      pressureTrendHpaPerHr: trend ?? 0,
      windSpeed,
      moon,
      hour: when.getHours(),
      tide,
    });

    return {
      time,
      utcOffsetSeconds,
      pressure,
      pressureTrend: trend,
      temperature: w.temperature_2m[i] ?? 0,
      windSpeed,
      windDirection: w.wind_direction_10m[i] ?? 0,
      waveHeight: waveHeight ?? 0,
      tide,
      moon,
      fishActivity,
    };
  });
}

/** Local-midnight date `offset` days from `from`, as an ISO yyyy-mm-dd string. */
function dayOffset(from: Date, offset: number): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
  return isoDate(d);
}

export const openMeteoProvider: EnvironmentProvider = {
  fetchDay(coords, date = new Date()): Promise<EnvironmentSnapshot[]> {
    const day = isoDate(date);
    return fetchWindow(coords, day, day);
  },

  fetchRange(coords, startDate, days): Promise<EnvironmentSnapshot[]> {
    const span = Math.max(1, Math.min(Math.trunc(days), MAX_FORECAST_DAYS));
    return fetchWindow(coords, dayOffset(startDate, 0), dayOffset(startDate, span - 1));
  },

  fetchHistory(coords, from, to): Promise<EnvironmentSnapshot[]> {
    return fetchWindow(coords, isoDate(from), isoDate(to), ARCHIVE_URL);
  },
};
