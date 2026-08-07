/**
 * Per-rod detection lifecycle: arming, then feature extraction plus the state
 * machine, bridged to the app's existing BiteEvent.
 *
 * Sits between rodRuntime (which owns connections) and the pure detection core
 * (which knows nothing about rods), so the runtime does not have to carry the
 * arming state machine inline and the core stays testable in isolation.
 */

import type { BiteEvent, BiteSize } from '@/types';

import type { AccSample } from './accSample';
import { DetectionEngine, type DetectionEvent } from './detectionEngine';
import {
  ARMING_DURATION_MS,
  ARMING_MIN_SAMPLES,
  type DetectionParams,
} from './detectionParams';
import { computeArming, FeatureExtractor, type FeatureFrame } from './featureExtractor';

export type RodDetectorPhase =
  /** Collecting the arming window; not yet watching. */
  | 'ARMING'
  /** Baseline established, watching. */
  | 'WATCHING'
  /** Arming failed; the rod is not being watched and the user must retry. */
  | 'ARM_FAILED';

export interface RodDetectorTick {
  phase: RodDetectorPhase;
  /** Null while still arming. */
  frame: FeatureFrame | null;
  events: DetectionEvent[];
  /** Fraction of the arming window elapsed, 0..1. */
  armingProgress: number;
}

/**
 * Per-rod detector.
 *
 * ARMING IS NOT OPTIONAL and cannot be skipped. Every feature is relative to a
 * baseline attitude; without one there is nothing to be deviated from, so the
 * rod is explicitly reported as not-yet-watching rather than quietly producing
 * meaningless angles.
 */
export class RodDetector {
  private phase: RodDetectorPhase = 'ARMING';
  private params: DetectionParams;

  private armingSamples: AccSample[] = [];
  private armingStartMs: number | null = null;
  private armFailReason: string | null = null;

  private extractor: FeatureExtractor | null = null;
  private engine: DetectionEngine;

  /** Swell period observed during arming; logged, see computeArming. */
  private swellPeriodMs: number | null = null;

  constructor(params: DetectionParams) {
    this.params = params;
    this.engine = new DetectionEngine(params);
  }

  setParams(params: DetectionParams): void {
    this.params = params;
    this.extractor?.setParams(params);
    this.engine.setParams(params);
  }

  getPhase(): RodDetectorPhase {
    return this.phase;
  }

  getArmFailReason(): string | null {
    return this.armFailReason;
  }

  getSwellPeriodMs(): number | null {
    return this.swellPeriodMs;
  }

  isSignalLost(): boolean {
    return this.engine.isSignalLost();
  }

  /** Threshold in degrees, for the chart overlay. */
  get thresholdDeg(): number {
    return this.params.thetaDeg;
  }

  /** Restart arming — after a failure, or when the rod is repositioned. */
  rearm(): void {
    this.phase = 'ARMING';
    this.armingSamples = [];
    this.armingStartMs = null;
    this.armFailReason = null;
    this.extractor = null;
    this.engine.disarm();
  }

  /** Advance time with no sample, so signal loss surfaces during silence. */
  tick(nowMonotonicMs: number): DetectionEvent[] {
    return this.engine.tick(nowMonotonicMs);
  }

  process(sample: AccSample): RodDetectorTick {
    if (this.phase === 'ARM_FAILED') {
      return { phase: this.phase, frame: null, events: [], armingProgress: 1 };
    }

    if (this.phase === 'ARMING') {
      return this.processArming(sample);
    }

    const frame = this.extractor!.process(sample);
    return {
      phase: 'WATCHING',
      frame,
      events: this.engine.process(frame),
      armingProgress: 1,
    };
  }

  private processArming(sample: AccSample): RodDetectorTick {
    this.armingStartMs ??= sample.tMonotonicMs;
    this.armingSamples.push(sample);

    const elapsed = sample.tMonotonicMs - this.armingStartMs;
    if (elapsed < ARMING_DURATION_MS) {
      return {
        phase: 'ARMING',
        frame: null,
        events: [],
        armingProgress: Math.min(1, elapsed / ARMING_DURATION_MS),
      };
    }

    const result = computeArming(this.armingSamples, ARMING_MIN_SAMPLES);
    this.armingSamples = [];

    if (!result.ok || !result.baseline) {
      // Refuse rather than guess. Arming on a bad baseline yields a detector that
      // is confidently wrong for the whole session — worse than saying so.
      this.phase = 'ARM_FAILED';
      this.armFailReason = result.reason ?? 'Could not establish a baseline.';
      return { phase: this.phase, frame: null, events: [], armingProgress: 1 };
    }

    this.swellPeriodMs = result.swellPeriodMs;
    this.extractor = new FeatureExtractor(result.baseline, this.params);
    this.engine.arm(sample.tMonotonicMs);
    this.phase = 'WATCHING';

    return { phase: 'WATCHING', frame: null, events: [], armingProgress: 1 };
  }
}

// ---------------------------------------------------------------------------
// Bridge to the app's existing BiteEvent
// ---------------------------------------------------------------------------

let biteSeq = 0;

/**
 * Map an alert onto the BiteEvent the rest of the app already consumes
 * (history, session reports, insights, notifications).
 *
 * NOTE ON UNITS: `peakMagnitude` now carries DEGREES of angular deviation, not
 * g. The detector no longer measures acceleration magnitude at all — deviation
 * is an angle between attitudes — so there is no g value to report. Records
 * written before this change hold g and are not comparable; the field name is
 * kept because renaming it would break persisted history for no user benefit.
 */
export function alertToBiteEvent(
  event: DetectionEvent,
  params: DetectionParams,
): BiteEvent {
  const thetaDeg = event.features?.thetaDeg ?? params.thetaDeg;
  biteSeq += 1;

  return {
    id: `${Math.round(event.atMs)}-${biteSeq}`,
    timestamp: event.atMs,
    size: classify(thetaDeg, params),
    peakMagnitude: thetaDeg,
    confidence: confidenceOf(event, params),
  };
}

function classify(thetaDeg: number, params: DetectionParams): BiteSize {
  return thetaDeg >= params.thetaDeg * 2 ? 'big' : 'small';
}

/**
 * Confidence in [0, 1].
 *
 * Path A is weighted higher than Path B: a rod that has held a load for seconds
 * is the strongest signal this hardware can produce, whereas Path B infers from
 * repeated deflections whose separation from swell rests on a threshold that has
 * not yet been calibrated against labelled data.
 */
function confidenceOf(event: DetectionEvent, params: DetectionParams): number {
  const thetaDeg = event.features?.thetaDeg ?? params.thetaDeg;
  const excess = Math.max(0, thetaDeg - params.thetaDeg) / Math.max(1, params.thetaDeg);
  const base = event.path === 'A' ? 0.7 : 0.5;
  return Math.min(1, base + 0.3 * Math.min(1, excess));
}
