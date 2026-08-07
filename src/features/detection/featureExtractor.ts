/**
 * Phase 3 — feature extraction.
 *
 * Turns an irregular, lossy stream of orientation samples into the features the
 * detector reasons about: angular deviation from baseline, the LEADING-EDGE rate
 * of each deflection, and windowed statistics describing whether the recent past
 * looks like swell or like a fish.
 *
 * Pure and clock-free: every time quantity comes from sample timestamps, never
 * from a wall clock, so a whole session can be replayed deterministically in a
 * test at any speed.
 */

import type { AccSample } from './accSample';
import { magnitudeMg } from './accSample';
import {
  type DetectionParams,
  IMPACT_DEVIATION_MG,
  MAX_DT_FOR_RATE_MS,
} from './detectionParams';
import {
  angleBetweenDeg,
  coefficientOfVariation,
  magnitude,
  meanVector,
  normalise,
  type Vec3,
} from './vectorMath';

const vecOf = (s: AccSample): Vec3 => ({ x: s.xMg, y: s.yMg, z: s.zMg });

/** One upward crossing of the deflection threshold. */
export interface Crossing {
  /** Monotonic ms of the sample that crossed. */
  atMs: number;
  /**
   * Max Δθ/Δt over the rising edge, degrees per second — or null when the rise
   * contained no pair close enough together to be trusted (see the Δt guard).
   *
   * Null is NOT zero. A crossing whose onset rate is unmeasurable must not be
   * counted as evidence of a slow, wave-like ramp; it is simply unknown.
   */
  onsetRateDegPerS: number | null;
}

export interface FeatureFrame {
  sample: AccSample;
  /** Elapsed since the previous sample; null on the first. */
  dtMs: number | null;
  magnitudeMg: number;
  /** Angular deviation from baseline, degrees. */
  thetaDeg: number;
  /** Reading contains real linear acceleration, not just a change of attitude. */
  isImpact: boolean;
  /** True while the baseline is held still because the rod is deflected. */
  baselineFrozen: boolean;
  /** This sample crossed the threshold upward. */
  crossedUp: boolean;
  /** Crossings inside the sliding window. */
  crossings: number;
  /** Crossings in the window whose onset rate is known to be fish-like. */
  sharpCrossings: number;
  /** Angle between the window's mean vector and baseline — the DC offset. */
  meanDeviationDeg: number;
  /** Regularity of crossing intervals; null when too few to characterise. */
  crossingIntervalCv: number | null;
}

interface WindowEntry {
  tMs: number;
  v: Vec3;
}

export class FeatureExtractor {
  /** Unit vector: the rod's at-rest attitude. */
  private baseline: Vec3;
  private params: DetectionParams;

  private prev: { tMs: number; thetaDeg: number } | null = null;
  private window: WindowEntry[] = [];
  private crossings: Crossing[] = [];

  /**
   * The crossing whose rising edge is still in progress, if any. Its onset rate
   * keeps being raised while θ climbs, so the stored value ends up as the max
   * over the WHOLE rising edge rather than just the slope at the crossing.
   */
  private activeRise: Crossing | null = null;

  constructor(baseline: Vec3, params: DetectionParams) {
    const unit = normalise(baseline);
    if (!unit) throw new Error('Baseline has no direction.');
    this.baseline = unit;
    this.params = params;
  }

  setParams(params: DetectionParams): void {
    this.params = params;
  }

  getBaseline(): Vec3 {
    return this.baseline;
  }

  process(sample: AccSample): FeatureFrame {
    const v = vecOf(sample);
    const mag = magnitudeMg(sample);
    const thetaDeg = angleBetweenDeg(v, this.baseline);

    const dtMs = this.prev === null ? null : sample.tMonotonicMs - this.prev.tMs;

    // A reading far from one gravity is linear acceleration, not attitude. It is
    // reported separately and must never move the baseline — otherwise a knock
    // permanently redefines "at rest".
    const isImpact = Math.abs(mag - 1000) > IMPACT_DEVIATION_MG;

    // Freeze while deflected, or a hooked fish is slowly absorbed into the
    // baseline and the alarm cancels itself.
    const baselineFrozen = isImpact || thetaDeg > this.params.thetaDeg;
    if (!baselineFrozen && dtMs !== null && dtMs > 0) {
      this.updateBaseline(v, dtMs);
    }

    const crossedUp = this.trackCrossings(sample.tMonotonicMs, thetaDeg, dtMs);

    this.window.push({ tMs: sample.tMonotonicMs, v });
    this.pruneWindow(sample.tMonotonicMs);

    this.prev = { tMs: sample.tMonotonicMs, thetaDeg };

    const windowCrossings = this.crossings;
    const intervals: number[] = [];
    for (let i = 1; i < windowCrossings.length; i += 1) {
      intervals.push(windowCrossings[i]!.atMs - windowCrossings[i - 1]!.atMs);
    }

    const mean = meanVector(this.window.map((e) => e.v));
    const meanDeviationDeg = mean ? angleBetweenDeg(mean, this.baseline) : 0;

    return {
      sample,
      dtMs,
      magnitudeMg: mag,
      thetaDeg,
      isImpact,
      baselineFrozen,
      crossedUp,
      crossings: windowCrossings.length,
      sharpCrossings: windowCrossings.filter(
        (c) => c.onsetRateDegPerS !== null &&
          c.onsetRateDegPerS >= this.params.onsetRateMinDegPerS,
      ).length,
      meanDeviationDeg,
      crossingIntervalCv: coefficientOfVariation(intervals),
    };
  }

  /**
   * EMA toward the observed attitude, over ELAPSED TIME rather than sample
   * count. The arrival rate is irregular by nature — an advertising stream with
   * no retries — so a per-sample alpha would make the baseline track fast during
   * a burst and slow during a gap, for reasons that have nothing to do with the
   * rod.
   */
  private updateBaseline(v: Vec3, dtMs: number): void {
    const dir = normalise(v);
    if (!dir) return;
    const alpha = 1 - Math.exp(-(dtMs / 1000) / this.params.tauS);
    const blended: Vec3 = {
      x: this.baseline.x + alpha * (dir.x - this.baseline.x),
      y: this.baseline.y + alpha * (dir.y - this.baseline.y),
      z: this.baseline.z + alpha * (dir.z - this.baseline.z),
    };
    const unit = normalise(blended);
    if (unit) this.baseline = unit;
  }

  /**
   * Detect upward threshold crossings and measure their leading edge.
   *
   * ONLY the leading edge. When a wave passes, drag releases and the rod springs
   * back at its own natural frequency; on a fast-action blank that recoil is
   * sharp whatever caused the bend, and a fish releasing tension looks identical.
   * Recovery speed is a property of the rod, not of the cause — so there is
   * deliberately no falling-edge feature anywhere in this class.
   */
  private trackCrossings(tMs: number, thetaDeg: number, dtMs: number | null): boolean {
    const prev = this.prev;
    const threshold = this.params.thetaDeg;

    // Slope is only trusted across a pair close enough together that no packet
    // can have been lost between them. A wider pair is DISCARDED, not
    // interpolated: three packets lost on a gradual wave ramp would otherwise
    // look like one large jump and manufacture a fish-like onset rate on the one
    // feature the whole discriminator rests on.
    let slope: number | null = null;
    if (prev !== null && dtMs !== null && dtMs > 0 && dtMs <= MAX_DT_FOR_RATE_MS) {
      slope = ((thetaDeg - prev.thetaDeg) / dtMs) * 1000;
    }

    const rising = prev !== null && thetaDeg > prev.thetaDeg;

    // A rise that has ended closes off its crossing's measurement.
    if (!rising) this.activeRise = null;

    const crossedUp = prev !== null && prev.thetaDeg <= threshold && thetaDeg > threshold;
    if (crossedUp) {
      const crossing: Crossing = { atMs: tMs, onsetRateDegPerS: null };
      this.crossings.push(crossing);
      this.activeRise = crossing;
    }

    if (this.activeRise && rising && slope !== null && slope > 0) {
      const current = this.activeRise.onsetRateDegPerS;
      if (current === null || slope > current) this.activeRise.onsetRateDegPerS = slope;
    }

    return crossedUp;
  }

  private pruneWindow(nowMs: number): void {
    const cutoff = nowMs - this.params.windowMs;
    while (this.window.length > 0 && this.window[0]!.tMs < cutoff) this.window.shift();
    while (this.crossings.length > 0 && this.crossings[0]!.atMs < cutoff) {
      const dropped = this.crossings.shift();
      if (dropped === this.activeRise) this.activeRise = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Arming
// ---------------------------------------------------------------------------

export interface ArmingResult {
  ok: boolean;
  /** Normalised at-rest attitude; null when arming failed. */
  baseline: Vec3 | null;
  sampleCount: number;
  /**
   * Dominant swell period estimated during arming, ms — null when the rod was
   * too still to show one.
   *
   * NOTE: the spec requires this to be estimated and stored but never says what
   * consumes it, so nothing downstream reads it yet. It is surfaced in the
   * session log, where it is genuinely useful when reading back a session in
   * which swell was the problem.
   */
  swellPeriodMs: number | null;
  reason?: string;
}

/**
 * Establish the at-rest baseline from an arming window.
 *
 * Refuses rather than guesses. Arming on a bad baseline produces a detector that
 * is confidently wrong for the whole session, which is worse than telling the
 * user to try again.
 */
export function computeArming(
  samples: readonly AccSample[],
  minSamples: number,
): ArmingResult {
  if (samples.length < minSamples) {
    return {
      ok: false,
      baseline: null,
      sampleCount: samples.length,
      swellPeriodMs: null,
      reason:
        `Only ${samples.length} samples in the arming window (need ${minSamples}). ` +
        `Check the tag is advertising and in range.`,
    };
  }

  // Direction only: averaging raw vectors then normalising weights each sample
  // by its magnitude, so one impact during arming would drag the baseline.
  const dirs = samples
    .map((s) => normalise(vecOf(s)))
    .filter((d): d is Vec3 => d !== null);
  const mean = meanVector(dirs);
  const baseline = mean ? normalise(mean) : null;

  // The mean of unit vectors is short when they point in scattered directions,
  // so its length is a coherence measure: near 1 means the rod held one attitude,
  // near 0 means it was waving about and no baseline is meaningful.
  if (!mean || !baseline || magnitude(mean) < 0.5) {
    return {
      ok: false,
      baseline: null,
      sampleCount: samples.length,
      swellPeriodMs: null,
      reason: 'Orientation varied too much to establish a baseline. Keep the rod still.',
    };
  }

  return {
    ok: true,
    baseline,
    sampleCount: samples.length,
    swellPeriodMs: estimateSwellPeriodMs(samples, baseline),
  };
}

/**
 * Median interval between upward crossings of a low angular threshold during
 * arming — the rod's dominant oscillation while "at rest", i.e. the swell.
 *
 * A low fixed threshold rather than thetaDeg: at rest the rod should never reach
 * the detection threshold, so using it would find no crossings at all and report
 * no swell in precisely the conditions where knowing the swell period matters.
 *
 * Median rather than mean because a single long gap (the operator walking away
 * mid-arming) would otherwise dominate.
 */
const SWELL_PROBE_DEG = 1.5;

function estimateSwellPeriodMs(
  samples: readonly AccSample[],
  baseline: Vec3,
): number | null {
  const times: number[] = [];
  let prevAbove = false;
  for (const s of samples) {
    const above = angleBetweenDeg(vecOf(s), baseline) > SWELL_PROBE_DEG;
    if (above && !prevAbove) times.push(s.tMonotonicMs);
    prevAbove = above;
  }
  if (times.length < 3) return null;

  const intervals: number[] = [];
  for (let i = 1; i < times.length; i += 1) intervals.push(times[i]! - times[i - 1]!);
  intervals.sort((a, b) => a - b);
  const mid = Math.floor(intervals.length / 2);
  return intervals.length % 2 === 0
    ? (intervals[mid - 1]! + intervals[mid]!) / 2
    : intervals[mid]!;
}
