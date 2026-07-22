import type { AccelSample, BiteEvent } from '@/types';

/** Tunable configuration for the bite detection engine. */
export interface BiteDetectorConfig {
  /** Sensor sample rate (Hz) — used to convert time windows to sample counts. */
  sampleRateHz: number;
  /** Seconds of signal used to estimate the slow gravity/tension baseline. */
  baselineSeconds: number;
  /** Seconds of signal used to estimate the rolling noise floor. */
  noiseSeconds: number;
  /**
   * Sensitivity in [0, 1]. Higher = detects smaller bites (lower threshold).
   * Maps to the sigma multiplier used for the adaptive threshold.
   */
  sensitivity: number;
  /** When true, adapt baseline faster and raise the floor for constant bait motion. */
  liveBaitMode: boolean;
  /** Minimum seconds between two distinct bites (refractory period). */
  refractorySeconds: number;
  /** Absolute floor (g) below which nothing is ever a bite (noise guard). */
  minAbsThresholdG: number;
  /**
   * Physical small/big boundary (g). A bite is "big" when its peak exceeds the
   * greater of this boundary and (detection threshold × bigRatio) — so in a
   * noisy environment the bar for "big" rises with the noise floor.
   */
  smallBigBoundaryG: number;
  /** Peak/threshold ratio contributing to the small/big boundary. */
  bigRatio: number;
}

export const DEFAULT_DETECTOR_CONFIG: BiteDetectorConfig = {
  sampleRateHz: 50,
  baselineSeconds: 2,
  noiseSeconds: 1.5,
  sensitivity: 0.5,
  liveBaitMode: false,
  refractorySeconds: 0.6,
  minAbsThresholdG: 0.08,
  smallBigBoundaryG: 0.45,
  bigRatio: 1.9,
};

/** Per-sample diagnostic output, useful for the live graph overlay & tests. */
export interface DetectorTick {
  sample: AccelSample;
  /** Raw magnitude √(x²+y²+z²) in g. */
  rawMagnitude: number;
  /** Baseline (gravity + slow tension) estimate in g. */
  baseline: number;
  /** Kalman-smoothed dynamic magnitude |raw − baseline| in g. */
  dynamic: number;
  /** Current adaptive threshold in g. */
  threshold: number;
  /** A bite finalised on this sample, if any. */
  bite: BiteEvent | null;
}
