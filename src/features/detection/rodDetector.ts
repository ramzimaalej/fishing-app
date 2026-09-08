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
  ARMING_FAST_COHERENCE,
  ARMING_FAST_MIN_SAMPLES,
  ARMING_MIN_SAMPLES,
  ARMING_MIN_SPAN_MS,
  type DetectionParams,
  SIGNAL_LOST_MS,
} from './detectionParams';
import {
  type ArmingResult,
  computeArming,
  FeatureExtractor,
  type FeatureFrame,
} from './featureExtractor';

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
  /** Rate bookkeeping — spans the whole session, not just the arming window. */
  private firstSampleMs: number | null = null;
  private sampleCount = 0;
  private armingStartMs: number | null = null;
  private armFailReason: string | null = null;

  private extractor: FeatureExtractor | null = null;
  private engine: DetectionEngine;

  /** Swell period observed during arming; logged, see computeArming. */
  private swellPeriodMs: number | null = null;

  /** Last sample seen in ANY phase, so loss is detectable before arming ends. */
  private lastSampleMs: number | null = null;
  private armingSignalLost = false;

  /**
   * When this rod started being watched, from the tick clock rather than from a
   * sample.
   *
   * Silence has to be measurable before the first packet, not only between
   * packets — a tag that is switched off, out of range, or simply not the tag
   * the rod is bound to never produces one, and every sample-derived clock stays
   * null for ever along with it.
   */
  private watchStartedMs: number | null = null;

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
    this.armingSignalLost = false;
    this.armingSamples = [];
    this.armingStartMs = null;
    this.watchStartedMs = null;
    this.firstSampleMs = null;
    this.sampleCount = 0;
    this.armFailReason = null;
    this.extractor = null;
    this.engine.disarm();
  }

  /**
   * Advance time with no sample, so signal loss surfaces during silence.
   *
   * The engine is IDLE until arming completes, and an IDLE engine reports
   * nothing — which left a 60 s window, and a permanent ARM_FAILED state, in
   * which a dead tag was rendered as "Calibrating" forever. Loss during those
   * phases is detected here instead.
   */
  tick(nowMonotonicMs: number): DetectionEvent[] {
    if (this.phase === 'WATCHING') return this.engine.tick(nowMonotonicMs);

    // The clock starts on the first tick, so silence is measured from when the
    // rod began being watched rather than from a packet that may never come.
    this.watchStartedMs ??= nowMonotonicMs;
    if (this.armingSignalLost) return [];

    // Never heard falls back to the watch clock. Guarding on lastSampleMs alone
    // returned early for ever on a rod whose tag never said anything, which is
    // the one case where "Calibrating" is most misleading: arming cannot finish
    // without samples, so the rod sat calibrating indefinitely and said nothing
    // about why.
    const silentSince = this.lastSampleMs ?? this.watchStartedMs;
    if (nowMonotonicMs - silentSince < SIGNAL_LOST_MS) return [];

    this.armingSignalLost = true;
    const silentFor = ((nowMonotonicMs - silentSince) / 1000).toFixed(1);
    const activity = this.phase === 'ARMING' ? 'arming' : 'stopped';

    return [
      {
        type: 'SIGNAL_LOST',
        atMs: nowMonotonicMs,
        // Two different faults, two different things to go and do. A tag that
        // went quiet has moved or run flat; one never heard at all is switched
        // off, out of range, or not the tag this rod is bound to.
        reason:
          this.lastSampleMs === null
            ? `Nothing heard from this tag in ${silentFor} s while ${activity}. ` +
              `Check it is switched on, in range, and the tag this rod is paired to.`
            : `No packet for ${silentFor} s while ${activity}. The rod is NOT being watched.`,
      },
    ];
  }

  /** True while signal was lost before watching began. */
  isArmingSignalLost(): boolean {
    return this.armingSignalLost;
  }

  /**
   * Readings per second actually arriving, or null before two have.
   *
   * Surfaced because "not being watched" has causes that look identical on
   * screen and are not: a tag that is silent, and a tag that is advertising
   * perfectly well but far too slowly to detect anything. Only the rate tells
   * them apart, and without it that diagnosis needed a packet sniffer.
   */
  observedRateHz(): number | null {
    if (this.firstSampleMs === null || this.lastSampleMs === null) return null;
    if (this.sampleCount < 2) return null;
    const spanS = (this.lastSampleMs - this.firstSampleMs) / 1000;
    return spanS > 0 ? this.sampleCount / spanS : null;
  }

  process(sample: AccSample): RodDetectorTick {
    this.lastSampleMs = sample.tMonotonicMs;
    this.firstSampleMs ??= sample.tMonotonicMs;
    this.sampleCount += 1;
    this.armingSignalLost = false;

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

    // Try to finish early. A rod that has lain still for ARMING_MIN_SPAN_MS has
    // already given up its rest attitude, and waiting out the rest of the
    // deadline only costs the angler fishing time. The stricter coherence gate
    // is what keeps this from arming on a rod that happens to be between
    // movements; anything less than convincing falls through to the deadline
    // below, where the full window and the normal gate apply.
    if (elapsed >= ARMING_MIN_SPAN_MS && this.armingSamples.length >= ARMING_FAST_MIN_SAMPLES) {
      const fast = computeArming(
        this.armingSamples,
        ARMING_FAST_MIN_SAMPLES,
        ARMING_FAST_COHERENCE,
      );
      if (fast.ok && fast.baseline) return this.startWatching(sample, fast);
    }

    if (elapsed < ARMING_DURATION_MS) {
      return {
        phase: 'ARMING',
        frame: null,
        events: [],
        // Against the deadline, which is the only bound that holds — the short
        // path may finish at any point before it, so this is an upper bound on
        // the wait rather than a prediction of it.
        armingProgress: Math.min(1, elapsed / ARMING_DURATION_MS),
      };
    }

    const result = computeArming(this.armingSamples, ARMING_MIN_SAMPLES);

    if (!result.ok || !result.baseline) {
      this.armingSamples = [];
      // Refuse rather than guess. Arming on a bad baseline yields a detector that
      // is confidently wrong for the whole session — worse than saying so.
      this.phase = 'ARM_FAILED';
      this.armFailReason = result.reason ?? 'Could not establish a baseline.';
      return { phase: this.phase, frame: null, events: [], armingProgress: 1 };
    }

    return this.startWatching(sample, result);
  }

  /** Commit an accepted baseline and start watching. */
  private startWatching(sample: AccSample, result: ArmingResult): RodDetectorTick {
    this.armingSamples = [];
    this.swellPeriodMs = result.swellPeriodMs;
    this.extractor = new FeatureExtractor(result.baseline!, this.params);
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
