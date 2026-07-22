import type { AccelSample, BiteEvent, BiteSize } from '@/types';

import { KalmanFilter } from './filters/KalmanFilter';
import { MovingAverageFilter } from './filters/MovingAverageFilter';
import { type BiteDetectorConfig, DEFAULT_DETECTOR_CONFIG, type DetectorTick } from './types';

/** Sigma multiplier bounds mapped from sensitivity (1 = most sensitive). */
const K_MIN = 2.5;
const K_MAX = 6.0;
/** Fraction of the threshold the signal must drop below to end a bite event. */
const EXIT_HYSTERESIS = 0.6;

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Real-time fish-bite detector.
 *
 * Pipeline per sample:
 *   1. magnitude = √(x²+y²+z²)
 *   2. baseline  = EMA(magnitude)          (gravity + slow line tension)
 *   3. dynamic   = Kalman(|magnitude − baseline|)   (clean strike signal)
 *   4. adaptive threshold T = max(floor, μ_noise + k·σ_noise)
 *   5. rising/falling-edge state machine over T detects a bite, tracks its
 *      peak, classifies small/big, and enforces a refractory period.
 *
 * The noise floor (μ, σ) is only updated while NOT inside a bite event, so a
 * strike does not pollute the very statistics used to detect it.
 */
export class BiteDetector {
  private config: BiteDetectorConfig;
  private readonly kalman: KalmanFilter;
  private noise: MovingAverageFilter;

  private baseline = 0;
  private baselineSeeded = false;
  private baselineAlpha = 0.05;
  private sampleCount = 0;
  private noiseWindow = 1;

  // Event state machine.
  private inEvent = false;
  private eventPeak = 0;
  private lastBiteTime = -Infinity;
  private biteCounter = 0;

  constructor(config: Partial<BiteDetectorConfig> = {}) {
    this.config = { ...DEFAULT_DETECTOR_CONFIG, ...config };
    this.kalman = new KalmanFilter();
    this.noise = new MovingAverageFilter(1);
    this.applyDerived();
  }

  /** Recompute sample-count windows & filter tuning from the current config. */
  private applyDerived(): void {
    const { sampleRateHz, baselineSeconds, noiseSeconds, sensitivity, liveBaitMode } =
      this.config;

    // Live bait mode: bait causes constant motion, so track the baseline faster
    // to subtract that steady wiggle, leaving only sharp strikes above it.
    const baselineSamples = Math.max(
      1,
      Math.round(baselineSeconds * sampleRateHz * (liveBaitMode ? 0.5 : 1)),
    );
    this.baselineAlpha = 1 / baselineSamples;

    const newNoiseWindow = Math.max(2, Math.round(noiseSeconds * sampleRateHz));
    if (newNoiseWindow !== this.noiseWindow) {
      this.noiseWindow = newNoiseWindow;
      this.noise = new MovingAverageFilter(newNoiseWindow);
    }

    // Higher sensitivity → track dynamics more eagerly (larger process noise).
    this.kalman.tune(lerp(0.008, 0.05, clamp(sensitivity, 0, 1)), 0.25);
  }

  /** Update config at runtime (e.g. user moves the sensitivity slider). */
  setConfig(partial: Partial<BiteDetectorConfig>): void {
    this.config = { ...this.config, ...partial };
    this.applyDerived();
  }

  getConfig(): Readonly<BiteDetectorConfig> {
    return this.config;
  }

  /** Sigma multiplier for the adaptive threshold from current settings. */
  private get sigmaK(): number {
    const base = lerp(K_MAX, K_MIN, clamp(this.config.sensitivity, 0, 1));
    // In live bait mode raise the bar so constant jiggle is not read as a bite.
    return this.config.liveBaitMode ? base + 1.0 : base;
  }

  /** Current adaptive threshold in g. */
  get threshold(): number {
    const adaptive = this.noise.mean + this.sigmaK * this.noise.std;
    return Math.max(this.config.minAbsThresholdG, adaptive);
  }

  /** True once enough samples have been seen to detect reliably. */
  get isWarmedUp(): boolean {
    return this.noise.isFull;
  }

  private classify(peak: number, threshold: number): BiteSize {
    const bigCutoff = Math.max(
      this.config.smallBigBoundaryG,
      threshold * this.config.bigRatio,
    );
    return peak >= bigCutoff ? 'big' : 'small';
  }

  private confidence(peak: number, threshold: number): number {
    // 0 at the threshold, asymptotically → 1 as the peak grows past it.
    const excess = peak - threshold;
    if (excess <= 0) return 0;
    return clamp(1 - Math.exp(-excess / (0.5 * threshold + 1e-6)), 0, 1);
  }

  /** Feed one accelerometer sample; returns diagnostics + any finalised bite. */
  process(sample: AccelSample): DetectorTick {
    this.sampleCount += 1;

    const raw = Math.sqrt(
      sample.x * sample.x + sample.y * sample.y + sample.z * sample.z,
    );

    // Seed & update the slow baseline (EMA low-pass).
    if (!this.baselineSeeded) {
      this.baseline = raw;
      this.baselineSeeded = true;
    } else {
      this.baseline += this.baselineAlpha * (raw - this.baseline);
    }

    const dynamicRaw = Math.abs(raw - this.baseline);
    const dynamic = this.kalman.filter(dynamicRaw);

    // Threshold from the noise floor as it stood BEFORE this sample.
    const threshold = this.threshold;

    let bite: BiteEvent | null = null;

    if (!this.inEvent) {
      // Only learn the noise floor when we are outside a bite and quiet.
      if (dynamic <= threshold) {
        this.noise.push(dynamic);
      }

      const refractoryMs = this.config.refractorySeconds * 1000;
      const pastRefractory = sample.t - this.lastBiteTime >= refractoryMs;

      if (this.isWarmedUp && pastRefractory && dynamic > threshold) {
        this.inEvent = true;
        this.eventPeak = dynamic;
      }
    } else {
      // Track the peak of the ongoing strike.
      if (dynamic > this.eventPeak) this.eventPeak = dynamic;

      // Falling edge (with hysteresis) ends the event and emits the bite.
      if (dynamic < threshold * EXIT_HYSTERESIS) {
        const size = this.classify(this.eventPeak, threshold);
        this.biteCounter += 1;
        bite = {
          id: `${sample.t}-${this.biteCounter}`,
          timestamp: sample.t,
          size,
          peakMagnitude: this.eventPeak,
          confidence: this.confidence(this.eventPeak, threshold),
        };
        this.lastBiteTime = sample.t;
        this.inEvent = false;
        this.eventPeak = 0;
      }
    }

    return {
      sample,
      rawMagnitude: raw,
      baseline: this.baseline,
      dynamic,
      threshold,
      bite,
    };
  }

  reset(): void {
    this.kalman.reset();
    this.noise.reset();
    this.baseline = 0;
    this.baselineSeeded = false;
    this.sampleCount = 0;
    this.inEvent = false;
    this.eventPeak = 0;
    this.lastBiteTime = -Infinity;
    this.biteCounter = 0;
  }
}
