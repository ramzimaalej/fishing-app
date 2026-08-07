/**
 * Synthetic advertising streams for testing the detector without hardware.
 *
 * EVERY stream produced here has irregular sample spacing and can drop packets,
 * because that is the medium: non-connectable advertising with no retries, no
 * acknowledgement and up to 10 ms of random BLE delay per event on top of scan
 * scheduling. Uniformly-spaced test data would pass while hiding the failures
 * that actually matter — above all a dropped packet faking a sharp onset.
 *
 * Deterministic: the jitter comes from a seeded PRNG, so a failing test is
 * reproducible rather than flaky.
 */

import type { AccSample } from '../accSample';
import type { Vec3 } from '../vectorMath';

/** The at-rest attitude every generated stream is expressed relative to. */
export const TEST_BASELINE: Vec3 = { x: 0, y: 0, z: 1000 };

/** mulberry32 — small, fast, good enough, and reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEG = Math.PI / 180;

/**
 * A sample tilted by a SIGNED angle from the baseline, about the x-axis.
 *
 * Signed on purpose: a slack-line bite deflects the opposite way to a loading
 * bite, and the detector must treat the two identically. Tests pass negative
 * angles to prove that.
 */
export function sampleAtAngle(
  tMonotonicMs: number,
  signedDeg: number,
  magnitudeMg = 1000,
  rssi = -60,
): AccSample {
  const a = signedDeg * DEG;
  return {
    tMonotonicMs: Math.round(tMonotonicMs),
    xMg: 0,
    yMg: Math.round(magnitudeMg * Math.sin(a)),
    zMg: Math.round(magnitudeMg * Math.cos(a)),
    rssi,
  };
}

export interface StreamOptions {
  durationMs: number;
  /** Signed tilt in degrees at a given time. */
  angleAt: (tMs: number) => number;
  /** Vector magnitude in mg; default one gravity. Used to synthesise impacts. */
  magnitudeAt?: (tMs: number) => number;
  /** Advertising interval floor for this device. */
  nominalIntervalMs?: number;
  /** ± jitter applied to each interval, ms. */
  jitterMs?: number;
  /** Windows in which every packet is lost. */
  dropWindows?: { fromMs: number; toMs: number }[];
  /** Probability each individual packet is lost. */
  dropRate?: number;
  startMs?: number;
  seed?: number;
}

/**
 * Generate a stream.
 *
 * Note what this does NOT do: it never emits a sample for a dropped packet and
 * never marks the gap. That is the whole difficulty of the real medium — a gap
 * is invisible in the data, indistinguishable from a rod that did not move — and
 * a test kit that flagged them would be testing an easier problem.
 */
export function generateStream(opts: StreamOptions): AccSample[] {
  const {
    durationMs,
    angleAt,
    magnitudeAt,
    nominalIntervalMs = 100,
    jitterMs = 10,
    dropWindows = [],
    dropRate = 0,
    startMs = 100_000,
    seed = 1,
  } = opts;

  const rand = prng(seed);
  const out: AccSample[] = [];
  let t = startMs;
  const end = startMs + durationMs;

  while (t <= end) {
    const rel = t - startMs;
    const inDropWindow = dropWindows.some((w) => rel >= w.fromMs && rel <= w.toMs);
    const randomlyDropped = dropRate > 0 && rand() < dropRate;

    if (!inDropWindow && !randomlyDropped) {
      out.push(sampleAtAngle(t, angleAt(rel), magnitudeAt ? magnitudeAt(rel) : 1000));
    }

    // Irregular by construction: BLE adds random delay per advertising event on
    // top of scan-window scheduling, so intervals are never the nominal value.
    t += nominalIntervalMs + (rand() * 2 - 1) * jitterMs;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Angle profiles
// ---------------------------------------------------------------------------

/** Constant tilt. */
export const constantAngle = (deg: number) => () => deg;

/**
 * Triangular oscillation: a wave. Rises over `rampMs`, falls over `rampMs`,
 * optionally alternating direction so the mean vector stays on baseline.
 */
export function triangleWave(opts: {
  amplitudeDeg: number;
  rampMs: number;
  /** Flip direction each half-cycle, as swell rocking a rod both ways does. */
  alternate?: boolean;
  offsetDeg?: number;
}): (tMs: number) => number {
  const { amplitudeDeg, rampMs, alternate = false, offsetDeg = 0 } = opts;
  const period = rampMs * 2;
  return (tMs) => {
    const cycle = Math.floor(tMs / period);
    const phase = (tMs % period) / period; // 0..1
    const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2; // 0→1→0
    const sign = alternate && cycle % 2 === 1 ? -1 : 1;
    return offsetDeg + sign * tri * amplitudeDeg;
  };
}

/** A step to `deg` at `atMs`, held for the rest of the stream. */
export function step(atMs: number, deg: number): (tMs: number) => number {
  return (tMs) => (tMs >= atMs ? deg : 0);
}

/** Linear drift, e.g. a tide slowly changing the rod's rest attitude. */
export function drift(totalDeg: number, overMs: number): (tMs: number) => number {
  return (tMs) => (Math.min(tMs, overMs) / overMs) * totalDeg;
}

export interface PulseSpec {
  atMs: number;
  /** Time from baseline to peak — the leading edge. */
  riseMs: number;
  holdMs: number;
  fallMs: number;
  peakDeg: number;
  /** -1 flips the pulse, as a slack-line bite would. */
  sign?: 1 | -1;
}

/**
 * A train of discrete deflections on an optional sustained offset.
 *
 * The offset is what separates "a fish worrying the bait while holding line
 * tension" (DC offset present) from "swell rocking the rod" (returns to
 * baseline), which is the distinction Path B's backstop condition tests.
 */
export function pulses(specs: readonly PulseSpec[], offsetDeg = 0): (tMs: number) => number {
  return (tMs) => {
    for (const p of specs) {
      const rel = tMs - p.atMs;
      if (rel < 0 || rel > p.riseMs + p.holdMs + p.fallMs) continue;
      const sign = p.sign ?? 1;
      let frac: number;
      if (rel < p.riseMs) frac = rel / p.riseMs;
      else if (rel < p.riseMs + p.holdMs) frac = 1;
      else frac = 1 - (rel - p.riseMs - p.holdMs) / p.fallMs;
      return offsetDeg + sign * frac * (p.peakDeg - offsetDeg);
    }
    return offsetDeg;
  };
}
