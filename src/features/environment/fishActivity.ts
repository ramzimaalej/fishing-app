import type { MoonPhase, TidePoint } from '@/types';

/**
 * Heuristic "solunar"-style fish-activity score in [0, 1]. This is guidance,
 * not science — it blends the classic factors anglers watch:
 *
 *  • Time of day — dawn (≈05–08h) and dusk (≈17–20h) are the strongest feeding
 *    windows; midday is slow.
 *  • Moon — full and new moons are the major solunar periods (strong tides →
 *    more feeding); quarters are minor periods.
 *  • Barometric pressure — a FALLING barometer (front approaching) fires fish
 *    up; a rising/high barometer after a front slows them down.
 *  • Wind — a light ripple helps; a flat calm or a gale both hurt.
 *  • Tide — moving water (rising / high) beats slack low water.
 */
export interface FishActivityInput {
  /** Surface pressure (hPa). */
  pressure: number;
  /** Pressure change rate (hPa/hour); negative = falling. */
  pressureTrendHpaPerHr?: number;
  /** Wind speed (m/s). */
  windSpeed: number;
  moon: MoonPhase;
  /** Local hour of day, 0–23. */
  hour: number;
  tide?: TidePoint | null;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Bell-shaped boost centred on `peak` hours, width `sigma`. */
function timeBoost(hour: number, peak: number, sigma: number): number {
  const d = hour - peak;
  return Math.exp(-(d * d) / (2 * sigma * sigma));
}

export function predictFishActivity(input: FishActivityInput): number {
  const { pressure, pressureTrendHpaPerHr = 0, windSpeed, moon, hour, tide } = input;

  let score = 0.3; // baseline

  // Dawn & dusk feeding windows (max ~+0.28 combined near a peak).
  const dawn = timeBoost(hour, 6.5, 1.6);
  const dusk = timeBoost(hour, 18.5, 1.6);
  score += 0.28 * Math.max(dawn, dusk);

  // Moon: full/new major (+0.18), quarters minor (+0.08).
  if (moon.phase === 'full' || moon.phase === 'new') score += 0.18;
  else if (moon.phase === 'first-quarter' || moon.phase === 'last-quarter') score += 0.08;

  // Barometric trend.
  if (pressureTrendHpaPerHr <= -0.4) score += 0.16; // falling fast
  else if (pressureTrendHpaPerHr < -0.1) score += 0.08; // falling
  else if (pressureTrendHpaPerHr > 0.4) score -= 0.12; // rising fast
  else if (pressureTrendHpaPerHr > 0.1) score -= 0.06; // rising
  // Absolute pressure: very high (stable bluebird) suppresses a touch.
  if (pressure >= 1025) score -= 0.05;

  // Wind: light ripple ideal; calm or strong wind reduce activity.
  if (windSpeed < 1) score -= 0.05;
  else if (windSpeed <= 6) score += 0.05;
  else if (windSpeed > 12) score -= 0.2;
  else if (windSpeed > 9) score -= 0.1;

  // Tide movement.
  if (tide) {
    if (tide.state === 'rising' || tide.state === 'high') score += 0.1;
    else if (tide.state === 'low') score -= 0.05;
  }

  return clamp01(score);
}
