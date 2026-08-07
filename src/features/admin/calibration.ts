/**
 * Separate the onset-rate distribution of fish from that of waves, so
 * ONSET_RATE_MIN can be set from evidence instead of guessed.
 *
 * Pure and clock-free. This is the module whose answer decides a threshold that
 * the entire fish/wave discriminator rests on, so it has to be checkable without
 * a sensor or a session.
 *
 * THE HONEST-FAILURE REQUIREMENT. If the two distributions overlap heavily, the
 * conclusion is not "pick the least-bad threshold" — it is that at ~10 Hz the
 * sensor cannot separate these events at all, and no setting will fix it. That
 * has to be reported plainly. Tuning into a number that looks precise while
 * overlapping badly is how someone ends up trusting an alarm that is guessing.
 */

import type { CaptureEvent } from './captureTypes';
import { DEFAULT_MATCH_OPTIONS, type MatchOptions } from './matching';

export type OnsetLabel = 'fish' | 'wave';

export interface LabelledOnset {
  onsetRateDegPerS: number;
  label: OnsetLabel;
  atMs: number;
}

/**
 * Attach the operator's labels to the crossings they were describing.
 *
 * Same asymmetric window as detection matching, and for the same reason: the
 * operator presses AFTER noticing, so the crossing they mean normally sits
 * BEFORE the press. Each crossing takes the nearest label whose window contains
 * it; unlabelled crossings are dropped rather than assumed to be waves, because
 * "the operator was not watching" is not evidence of anything.
 */
export function labelCrossings(
  events: readonly CaptureEvent[],
  options: Partial<MatchOptions> = {},
): LabelledOnset[] {
  const opts = { ...DEFAULT_MATCH_OPTIONS, ...options };
  const marks = events.filter((e) => e.kind === 'fish' || e.kind === 'wave');
  const crossings = events.filter((e) => e.kind === 'crossing');

  const out: LabelledOnset[] = [];
  for (const c of crossings) {
    // A crossing whose onset rate could not be measured — every sample pair on
    // its rising edge was too far apart to trust — is UNKNOWN, not slow. Feeding
    // it in as 0 would drag the fish distribution down and manufacture overlap.
    if (c.onsetRateDegPerS == null) continue;

    let best: CaptureEvent | null = null;
    let bestDist = Infinity;
    for (const m of marks) {
      if (opts.sameRodOnly && m.rodId !== c.rodId) continue;
      const delta = c.at - m.at;
      if (delta < -opts.preMs || delta > opts.postMs) continue;
      const dist = Math.abs(delta);
      if (dist < bestDist) {
        bestDist = dist;
        best = m;
      }
    }
    if (!best) continue;

    out.push({
      onsetRateDegPerS: c.onsetRateDegPerS,
      label: best.kind as OnsetLabel,
      atMs: c.at,
    });
  }
  return out;
}

export interface Distribution {
  count: number;
  min: number;
  max: number;
  median: number;
  /** 10th and 90th percentiles — more robust than min/max for a small sample. */
  p10: number;
  p90: number;
}

function describe(values: readonly number[]): Distribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return {
    count: sorted.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    median: at(0.5),
    p10: at(0.1),
    p90: at(0.9),
  };
}

export interface CalibrationResult {
  fish: Distribution | null;
  wave: Distribution | null;
  /** Onset rate that best separates the two, deg/s. Null without both labels. */
  suggestedThreshold: number | null;
  /**
   * Youden's J at the suggested threshold: (fish above) − (waves above), in
   * [0, 1]. 1 is perfect separation, 0 is none.
   */
  separation: number | null;
  /** True when the distributions overlap too much for any threshold to work. */
  overlapping: boolean;
  /** How many labelled crossings were discarded as unmeasurable. */
  unmeasurable: number;
  /** Operator-facing conclusion, including the honest failure. */
  verdict: string;
}

/** Below this, no threshold is worth shipping and the UI must say so. */
const USABLE_SEPARATION = 0.6;
/** Fewer labelled events than this and any conclusion is noise. */
const MIN_PER_CLASS = 5;

/**
 * Choose the threshold maximising Youden's J.
 *
 * Candidates are the observed values themselves rather than a fixed grid, so the
 * answer does not depend on an arbitrary step size.
 */
function bestThreshold(
  fish: readonly number[],
  wave: readonly number[],
): { threshold: number; separation: number } | null {
  if (fish.length === 0 || wave.length === 0) return null;

  let best = { threshold: 0, separation: -Infinity };
  for (const candidate of [...fish, ...wave].sort((a, b) => a - b)) {
    const tpr = fish.filter((v) => v >= candidate).length / fish.length;
    const fpr = wave.filter((v) => v >= candidate).length / wave.length;
    const j = tpr - fpr;
    if (j > best.separation) best = { threshold: candidate, separation: j };
  }
  return best.separation === -Infinity ? null : best;
}

export function calibrate(
  events: readonly CaptureEvent[],
  options: Partial<MatchOptions> = {},
): CalibrationResult {
  const labelled = labelCrossings(events, options);
  const fish = labelled.filter((l) => l.label === 'fish').map((l) => l.onsetRateDegPerS);
  const wave = labelled.filter((l) => l.label === 'wave').map((l) => l.onsetRateDegPerS);

  const unmeasurable = events.filter(
    (e) => e.kind === 'crossing' && e.onsetRateDegPerS == null,
  ).length;

  const best = bestThreshold(fish, wave);
  const separation = best?.separation ?? null;
  const overlapping = separation !== null && separation < USABLE_SEPARATION;

  return {
    fish: describe(fish),
    wave: describe(wave),
    suggestedThreshold: best ? Math.round(best.threshold) : null,
    separation,
    overlapping,
    unmeasurable,
    verdict: verdictFor(fish.length, wave.length, best, overlapping),
  };
}

function verdictFor(
  fishCount: number,
  waveCount: number,
  best: { threshold: number; separation: number } | null,
  overlapping: boolean,
): string {
  if (fishCount === 0 && waveCount === 0) {
    return 'No labelled events yet. Mark fish and waves during a session as you see them.';
  }
  if (fishCount < MIN_PER_CLASS || waveCount < MIN_PER_CLASS) {
    return (
      `Not enough labelled events (${fishCount} fish, ${waveCount} wave; ` +
      `need ${MIN_PER_CLASS} of each). Any threshold from this would be noise.`
    );
  }
  if (!best) return 'Could not compare — one class has no measurable onsets.';

  if (overlapping) {
    return (
      `Fish and wave onsets OVERLAP (separation ${(best.separation * 100).toFixed(0)}%). ` +
      `No threshold will separate them reliably — at ~10 Hz the sensor is the limit, ` +
      `not the setting. Expect false alarms in swell whatever you choose.`
    );
  }
  return (
    `Good separation (${(best.separation * 100).toFixed(0)}%). ` +
    `Suggested ONSET_RATE_MIN: ${Math.round(best.threshold)}°/s.`
  );
}
