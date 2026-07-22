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
}

/**
 * Default location — San Francisco Bay. Real device geolocation via
 * expo-location is a follow-up; wire it into the store and pass coords here.
 */
export const DEFAULT_COORDS: GeoCoords = { latitude: 37.81, longitude: -122.36 };

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';

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

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
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

/** Pressure change rate (hPa/hour) at index i from neighbouring samples. */
function pressureTrend(pressures: (number | null)[], i: number): number {
  const cur = pressures[i];
  const prev = i > 0 ? pressures[i - 1] : null;
  if (cur == null || prev == null) return 0;
  return cur - prev; // samples are hourly → already hPa/hr
}

export const openMeteoProvider: EnvironmentProvider = {
  async fetchDay(coords, date = new Date()): Promise<EnvironmentSnapshot[]> {
    const day = isoDate(date);
    const { latitude, longitude } = coords;

    const weatherUrl =
      `${FORECAST_URL}?latitude=${latitude}&longitude=${longitude}` +
      `&hourly=surface_pressure,temperature_2m,wind_speed_10m,wind_direction_10m` +
      `&wind_speed_unit=ms&start_date=${day}&end_date=${day}&timezone=auto`;

    const marineUrl =
      `${MARINE_URL}?latitude=${latitude}&longitude=${longitude}` +
      `&hourly=wave_height,sea_level_height_msl&start_date=${day}&end_date=${day}&timezone=auto`;

    // Marine data is unavailable inland — treat its failure as "no marine data"
    // rather than failing the whole request.
    const [weather, marine] = await Promise.all([
      fetchJson<{ hourly: HourlyWeather }>(weatherUrl),
      fetchJson<{ hourly: HourlyMarine }>(marineUrl).catch(
        () => ({ hourly: { time: [] } }) as { hourly: HourlyMarine },
      ),
    ]);

    const w = weather.hourly;
    const m = marine.hourly;
    const marineIndex = new Map(m.time.map((t, i) => [t, i]));
    const tides = deriveTides(m.time, m.sea_level_height_msl);

    return w.time.map((time, i) => {
      const mi = marineIndex.get(time);
      const waveHeight = mi != null ? (m.wave_height?.[mi] ?? 0) : 0;
      const tide = mi != null ? (tides[mi] ?? null) : null;
      const when = new Date(time);
      const moon = getMoonPhase(when);
      const pressure = w.surface_pressure[i] ?? 1013;
      const windSpeed = w.wind_speed_10m[i] ?? 0;

      const fishActivity = predictFishActivity({
        pressure,
        pressureTrendHpaPerHr: pressureTrend(w.surface_pressure, i),
        windSpeed,
        moon,
        hour: when.getHours(),
        tide,
      });

      return {
        time,
        pressure,
        temperature: w.temperature_2m[i] ?? 0,
        windSpeed,
        windDirection: w.wind_direction_10m[i] ?? 0,
        waveHeight: waveHeight ?? 0,
        tide,
        moon,
        fishActivity,
      };
    });
  },
};
