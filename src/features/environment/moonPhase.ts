import type { MoonPhase } from '@/types';

/**
 * Moon-phase approximation from the mean synodic cycle.
 *
 * We measure the age of the Moon (days since the last new moon) against a known
 * new-moon epoch and the mean synodic month. Illuminated fraction is derived
 * from the age via (1 − cos(2π · age/synodic)) / 2 — 0 at new, 1 at full. This
 * is accurate to ~a few hours for phase and is plenty for fishing guidance.
 */

const SYNODIC_MONTH = 29.530588853; // days
/** Reference new moon: 2000-01-06 18:14 UTC (Meeus). */
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14, 0);
const MS_PER_DAY = 86_400_000;

type Phase = MoonPhase['phase'];

interface PhaseBand {
  max: number; // exclusive upper age boundary (days)
  phase: Phase;
  name: string;
}

// 8 equal bands of the synodic cycle (~3.69 days each). New moon wraps around
// both ends of the cycle, so it appears first and is also the fallback.
const BANDS: PhaseBand[] = [
  { max: 1.84566, phase: 'new', name: 'New Moon' },
  { max: 5.53699, phase: 'waxing-crescent', name: 'Waxing Crescent' },
  { max: 9.22831, phase: 'first-quarter', name: 'First Quarter' },
  { max: 12.91963, phase: 'waxing-gibbous', name: 'Waxing Gibbous' },
  { max: 16.61096, phase: 'full', name: 'Full Moon' },
  { max: 20.30228, phase: 'waning-gibbous', name: 'Waning Gibbous' },
  { max: 23.99361, phase: 'last-quarter', name: 'Last Quarter' },
  { max: 27.68493, phase: 'waning-crescent', name: 'Waning Crescent' },
];

/** Age of the Moon in days [0, SYNODIC_MONTH). */
export function moonAgeDays(date: Date): number {
  const daysSince = (date.getTime() - KNOWN_NEW_MOON) / MS_PER_DAY;
  return ((daysSince % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
}

export function getMoonPhase(date: Date): MoonPhase {
  const age = moonAgeDays(date);
  const illuminationFraction = (1 - Math.cos((2 * Math.PI * age) / SYNODIC_MONTH)) / 2;

  const band = BANDS.find((b) => age < b.max) ?? BANDS[0]!;

  return {
    illuminationFraction,
    phase: band.phase,
    name: band.name,
  };
}
