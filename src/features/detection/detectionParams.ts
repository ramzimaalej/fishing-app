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

/**
 * The tag's MEASURED advertising interval (ms). THE ONE NUMBER TO CHANGE.
 *
 * Every rate-dependent constant below is derived from this, because they are not
 * independent: a dwell tolerance shorter than the sample interval makes dwell
 * unreachable, an arming budget above the delivered rate makes arming
 * unreachable, and setting either by hand drifts out of step with the other.
 *
 * Measured on the CP27 tag (MAC …9D:C0:0C) over four sniffer captures,
 * 105.5 s / 48 advertisements: 0.27 Hz of accelerometer frames, 0.45 Hz of
 * advertisements overall, 60% of them carrying motion. That is one reading every
 * ~3.6 s. The same tag measured 1.04 Hz with 100% motion frames in August, so
 * this is the tag's CURRENT behaviour, not a fixed property of the hardware —
 * re-measure with scripts/analyse-capture.py before trusting it, and if a tag is
 * reconfigured to advertise faster, change this line and nothing else.
 */
export const EXPECTED_SAMPLE_INTERVAL_MS = 3600;

/**
 * WHAT THIS RATE COSTS — read before tuning anything below.
 *
 * At one reading every 3.6 s the detector can still see that a rod is BENT, and
 * that is what Path A alerts on. It cannot see HOW a rod became bent. A fish
 * loads a rod in 100–300 ms and a wave loads it over 1–3 s, and both are shorter
 * than a single sample interval here, so the leading edge that separates them
 * falls entirely between two readings. No parameter recovers information that
 * was never sampled.
 *
 * Concretely: MAX_DT_FOR_RATE_MS below discards any slope measured across a gap
 * wider than 150 ms, so at this interval every crossing has a null onset rate,
 * `sharpCrossings` is always 0, and detectionEngine's Path B — which requires
 * `sharpCrossings >= crossingsN - 1` — CANNOT FIRE. Path B is unreachable until
 * the tag advertises at roughly 7 Hz or better. That is a deliberate outcome:
 * see MAX_DT_FOR_RATE_MS for why raising it is not the fix.
 *
 * Swell is also beyond Nyquist. Sampling at 0.28 Hz resolves periods no shorter
 * than ~7.2 s, and sea swell runs 2–8 s, so the arming swell estimate aliases
 * and cannot be trusted at this rate either.
 */

/** Continuous load must survive this many sample gaps to count as a dwell. */
const DWELL_SAMPLE_INTERVALS = 2;

/** Consecutive missed advertisements tolerated before the stream is declared lost. */
const SIGNAL_LOST_INTERVALS = 5;

/**
 * Fraction of the theoretically available samples that arming demands. The
 * stream drops adverts freely — it has no retries and no sequence numbers — so
 * requiring the full theoretical count would fail arming on a healthy tag.
 */
const ARMING_YIELD = 0.65;

export const DEFAULT_DETECTION_PARAMS: DetectionParams = {
  thetaDeg: 9.0,
  // Two whole sample gaps, less a fifth of one for jitter, so a third
  // above-threshold reading that arrives slightly early still completes the
  // dwell. The old 2500 ms was shorter than a single interval at this rate,
  // which made "sustained load" mean nothing more than two adjacent readings.
  dwellMs: Math.round(EXPECTED_SAMPLE_INTERVAL_MS * (DWELL_SAMPLE_INTERVALS - 0.2)),
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
 *
 * IT WAS NOT RAISED when the rest of this file was retuned to the tag's measured
 * 3.6 s interval, and the temptation to raise it is exactly the trap the
 * paragraph above describes. Widening it to 3600 ms would not make the detector
 * see a fish's leading edge — it would make it INVENT one, by dividing a whole
 * wave's worth of bend by the gap it happened to land in and calling the result
 * an onset rate. The cost of leaving it alone is that Path B never fires (see
 * EXPECTED_SAMPLE_INTERVAL_MS); the cost of raising it is false alarms that look
 * exactly like real ones. The first is visible and the second is not.
 */
export const MAX_DT_FOR_RATE_MS = 150;

/**
 * A dropped packet is not evidence of a return to baseline, so a dwell tolerates
 * this much silence before it is broken (ms).
 *
 * Must exceed one sample interval or dwell can never accumulate at all: at 3.6 s
 * spacing the previous fixed 1500 ms broke the dwell between EVERY pair of
 * readings, which zeroed the held time on each sample and made Path A — the only
 * path this tag can reach — silently unreachable too. Two intervals tolerates
 * one dropped advertisement.
 */
export const DWELL_GAP_TOLERANCE_MS = EXPECTED_SAMPLE_INTERVAL_MS * 2;

/**
 * Silence after which the stream is declared lost (ms).
 *
 * Worst gaps actually observed on this tag were 6.2 s and 8.1 s, against a 3.6 s
 * nominal interval, so the previous fixed 5000 ms fired SIGNAL_LOST on a tag
 * that was working normally — the alarm was reporting the threshold, not the
 * tag. Five intervals sits above the observed worst case with room for two more
 * consecutive misses.
 */
export const SIGNAL_LOST_MS = EXPECTED_SAMPLE_INTERVAL_MS * SIGNAL_LOST_INTERVALS;

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

/**
 * Readings arming needs inside ARMING_DURATION_MS.
 *
 * Derived, not chosen. 200 samples in 60 s demanded 3.33 Hz from a tag
 * delivering 0.27 Hz — twelve times more than it has ever sent — so arming could
 * not succeed, and the failure surfaced as "calibrating" forever rather than as
 * anything a user could act on. The floor of 8 keeps a very slow tag from
 * arming off a handful of readings that cannot average to a stable baseline.
 */
export const ARMING_MIN_SAMPLES = Math.max(
  8,
  Math.floor((ARMING_DURATION_MS / EXPECTED_SAMPLE_INTERVAL_MS) * ARMING_YIELD),
);

export function clampParams(p: DetectionParams): DetectionParams {
  const out = { ...p };
  for (const key of Object.keys(DETECTION_PARAM_RANGES) as (keyof DetectionParams)[]) {
    const { min, max } = DETECTION_PARAM_RANGES[key];
    const v = out[key];
    out[key] = v < min ? min : v > max ? max : v;
  }
  return out;
}
