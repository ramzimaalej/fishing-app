/**
 * Tunable detection parameters.
 *
 * Every one of these is user-tunable from the debug settings screen, because the
 * shipped defaults will NOT work as-is: the right values depend on rod action,
 * where the tag is mounted, casting weight and sea state. Shipping these as
 * constants would be shipping a guess as though it were a measurement.
 */

export interface DetectionParams {
  /** Angular deviation from baseline that counts as a deflection (degrees). */
  thetaDeg: number;
  /** How long θ must stay above threshold for a sustained-load alert (ms). */
  dwellMs: number;
  /** Baseline EMA time constant (seconds). */
  tauS: number;
  /** Sliding window for the repeated-deflection features (ms). */
  windowMs: number;
  /** Upward threshold crossings required within the window. */
  crossingsN: number;
  /**
   * Minimum leading-edge slope for a crossing to count as fish-like (deg/s).
   *
   * A GUESS, and the single most important number to calibrate. A wave loads the
   * rod through drag over 1–3 s; a fish loads it through a tight line in
   * 100–300 ms. This threshold is the whole fish/wave discriminator, and no
   * value of it is defensible until it has been set from labelled session data
   * (see the calibration view).
   */
  onsetRateMinDegPerS: number;
  /** DC offset of the window mean from baseline that supports Path B (degrees). */
  meanDevDeg: number;
  /** Crossing-interval coefficient of variation that supports Path B. */
  cvMin: number;
}

export const DEFAULT_DETECTION_PARAMS: DetectionParams = {
  thetaDeg: 9.0,
  dwellMs: 2500,
  tauS: 45,
  windowMs: 8000,
  crossingsN: 3,
  onsetRateMinDegPerS: 25,
  meanDevDeg: 4.0,
  cvMin: 0.5,
};

/** Permitted range per parameter, for the settings UI and for clamping. */
export const DETECTION_PARAM_RANGES: Record<
  keyof DetectionParams,
  { min: number; max: number; unit: string }
> = {
  thetaDeg: { min: 3, max: 20, unit: '°' },
  dwellMs: { min: 500, max: 8000, unit: 'ms' },
  tauS: { min: 15, max: 120, unit: 's' },
  windowMs: { min: 3000, max: 20000, unit: 'ms' },
  crossingsN: { min: 2, max: 8, unit: '' },
  onsetRateMinDegPerS: { min: 5, max: 100, unit: '°/s' },
  meanDevDeg: { min: 1, max: 15, unit: '°' },
  cvMin: { min: 0.2, max: 1.5, unit: '' },
};

/**
 * Maximum Δt between two samples for their slope to be trusted (ms). FIXED —
 * deliberately not user-tunable.
 *
 * READ THIS TWICE. Dropped packets manufacture false sharpness. If three packets
 * are lost during a gradual wave ramp, the samples either side look like one
 * large jump, producing an artificially high onset rate on the single feature the
 * entire discriminator rests on. The advertising stream carries no sequence
 * number, so there is no other way to detect the loss.
 *
 * Raising this would silently re-admit exactly the artifact it exists to reject,
 * which is why it is not exposed alongside the tunables above.
 */
export const MAX_DT_FOR_RATE_MS = 150;

/**
 * A dropped packet is not evidence of a return to baseline, so a dwell tolerates
 * this much silence before it is broken (ms).
 */
export const DWELL_GAP_TOLERANCE_MS = 1500;

/** Silence after which the stream is declared lost (ms). */
export const SIGNAL_LOST_MS = 5000;

/** Reset hysteresis: θ must fall below thetaDeg × this, for RESET_HOLD_MS. */
export const RESET_THETA_FACTOR = 0.6;
export const RESET_HOLD_MS = 5000;

/**
 * Fraction of the alarm threshold above which the baseline stops tracking.
 *
 * The freeze used to be gated on the ALARM threshold itself, which meant any
 * load below it was actively erased: the EMA pulled the baseline toward the
 * load, which lowered theta, which produced more sub-threshold samples. Measured
 * on the real code, a steady 8.5° load (94% of threshold) decayed to 0.17° in
 * under three minutes, and one minute of an 8° pre-load — a fish mouthing the
 * bait — made a subsequent genuine 13° run read as 6.7° and never alarm.
 *
 * Half the threshold is a compromise, not a free win. The baseline still has to
 * follow tide, and the lag it can absorb is roughly (drift rate x tau): about
 * 2.7° for 18° over five minutes. Freezing at 4.5° stays clear of that while
 * catching a load well before it alarms. Freezing much lower would trade a
 * missed fish for a baseline that cannot follow a tide.
 */
export const BASELINE_FREEZE_FACTOR = 0.5;

/**
 * Dwell tolerates theta dipping this far below the threshold.
 *
 * Without it a load sitting AT the threshold never accumulates dwell: any single
 * sample below zeroes it, and at 16 mg quantisation the theta grid near 9° steps
 * in ~0.9°, so there is a band that cannot be occupied stably. Asymmetric with
 * the 5 s reset hysteresis on purpose — entering an alarm should be easier than
 * leaving one.
 */
export const DWELL_DEADBAND_DEG = 0.5;

/**
 * A reading this far from one gravity contains real linear acceleration — a
 * violent run, or somebody knocking the rod — rather than a change of
 * orientation. Routed to IMPACT and never allowed to move the baseline.
 */
export const IMPACT_DEVIATION_MG = 400;

/** Arming requirements. */
export const ARMING_DURATION_MS = 60_000;
export const ARMING_MIN_SAMPLES = 200;

export function clampParams(p: DetectionParams): DetectionParams {
  const out = { ...p };
  for (const key of Object.keys(DETECTION_PARAM_RANGES) as (keyof DetectionParams)[]) {
    const { min, max } = DETECTION_PARAM_RANGES[key];
    const v = out[key];
    out[key] = v < min ? min : v > max ? max : v;
  }
  return out;
}
