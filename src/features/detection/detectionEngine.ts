/**
 * Phase 4 — detection state machine.
 *
 * Consumes feature frames and decides when to raise an alarm. Pure: it is driven
 * entirely by sample timestamps, so a whole session replays deterministically.
 *
 * Two independent paths reach ALERT_HOOKED and either is sufficient, because the
 * two catch different takes. Path A catches a fish that loads the rod and keeps
 * it loaded (including a slack-line bite, where the rod unloads and STAYS
 * unloaded). Path B catches a fish that repeatedly strikes without ever holding
 * a sustained load.
 *
 * SIGNAL_LOST is orthogonal to the rest and is the most important state here.
 * With no sequence numbers, a dropout and a motionless rod are identical in the
 * data — so silence must never be reported as "no fish". It is the worst
 * available failure mode: the user believes a rod is being watched when it is not.
 */

import type { FeatureFrame } from './featureExtractor';
import {
  type DetectionParams,
  DWELL_DEADBAND_DEG,
  DWELL_GAP_TOLERANCE_MS,
  RESET_HOLD_MS,
  RESET_THETA_FACTOR,
  SIGNAL_LOST_MS,
} from './detectionParams';

export type DetectionState = 'IDLE' | 'ARMED' | 'ALERT_HOOKED';

export type DetectionEventType =
  /** A fish is hooked or actively working the bait. */
  | 'ALERT_HOOKED'
  /** Real linear acceleration — a violent run, or the rod being knocked. */
  | 'IMPACT'
  /** No packet for SIGNAL_LOST_MS. Must be surfaced visibly AND audibly. */
  | 'SIGNAL_LOST'
  /** Packets resumed after a loss. */
  | 'SIGNAL_RESTORED'
  /** Returned to watching after an alert. */
  | 'RESET_TO_ARMED';

export interface DetectionEvent {
  type: DetectionEventType;
  atMs: number;
  /** Which path fired, for ALERT_HOOKED. */
  path?: 'A' | 'B';
  /** Human-readable cause, for the session log and the UI. */
  reason: string;
  /** Feature snapshot at the moment of the event, for calibration. */
  features?: {
    thetaDeg: number;
    crossings: number;
    sharpCrossings: number;
    meanDeviationDeg: number;
    crossingIntervalCv: number | null;
  };
}

export class DetectionEngine {
  private state: DetectionState = 'IDLE';
  private params: DetectionParams;

  /** Start of the current above-threshold run, for Path A. */
  private dwellStartMs: number | null = null;
  private lastAboveMs: number | null = null;

  /** Start of the current below-reset-threshold run, for hysteresis. */
  private belowSinceMs: number | null = null;

  private lastSampleMs: number | null = null;
  private signalLost = false;

  constructor(params: DetectionParams) {
    this.params = params;
  }

  setParams(params: DetectionParams): void {
    this.params = params;
  }

  getState(): DetectionState {
    return this.state;
  }

  isSignalLost(): boolean {
    return this.signalLost;
  }

  /** Move to ARMED once a baseline has been established. */
  arm(atMs: number): void {
    this.state = 'ARMED';
    this.dwellStartMs = null;
    this.lastAboveMs = null;
    this.belowSinceMs = null;
    this.lastSampleMs = atMs;
  }

  disarm(): void {
    this.state = 'IDLE';
    this.dwellStartMs = null;
    this.lastAboveMs = null;
    this.belowSinceMs = null;
    this.signalLost = false;
    this.lastSampleMs = null;
  }

  /**
   * Advance time without a sample, so signal loss is detected during silence.
   *
   * Necessary because the only other entry point is a packet arriving, and the
   * whole point of this check is that no packet is arriving. The caller ticks
   * this from a timer.
   */
  tick(nowMs: number): DetectionEvent[] {
    if (this.state === 'IDLE') return [];
    if (this.lastSampleMs === null) return [];
    if (this.signalLost) return [];
    if (nowMs - this.lastSampleMs < SIGNAL_LOST_MS) return [];

    this.signalLost = true;
    return [
      {
        type: 'SIGNAL_LOST',
        atMs: nowMs,
        reason:
          `No packet for ${((nowMs - this.lastSampleMs) / 1000).toFixed(1)} s. ` +
          `The rod is NOT being watched — this is not "no fish".`,
      },
    ];
  }

  process(frame: FeatureFrame): DetectionEvent[] {
    const events: DetectionEvent[] = [];
    const nowMs = frame.sample.tMonotonicMs;

    if (this.signalLost) {
      this.signalLost = false;
      events.push({
        type: 'SIGNAL_RESTORED',
        atMs: nowMs,
        reason: 'Packets resumed.',
      });
      // The gap is not evidence about the rod, so state from before it is no
      // longer trustworthy — in BOTH directions. Clearing only the dwell let
      // silence count toward the 5 s reset hysteresis, so a 40 s dropout plus
      // one slack packet cancelled a live alarm on a fish that was still on.
      this.dwellStartMs = null;
      this.lastAboveMs = null;
      this.belowSinceMs = null;
    }
    this.lastSampleMs = nowMs;

    if (this.state === 'IDLE') return events;

    if (frame.isImpact) {
      events.push({
        type: 'IMPACT',
        atMs: nowMs,
        reason:
          `Magnitude ${frame.magnitudeMg.toFixed(0)} mg — real acceleration, not a tilt. ` +
          `A run, or the rod was knocked.`,
        features: snapshot(frame),
      });
    }

    this.trackDwell(frame);

    if (this.state === 'ARMED') {
      const alert = this.checkPathA(frame) ?? this.checkPathB(frame);
      if (alert) {
        this.state = 'ALERT_HOOKED';
        this.belowSinceMs = null;
        events.push(alert);
      }
      return events;
    }

    // ALERT_HOOKED — look for the hysteretic return to watching.
    const reset = this.checkReset(frame);
    if (reset) {
      this.state = 'ARMED';
      this.dwellStartMs = null;
      this.lastAboveMs = null;
      events.push(reset);
    }
    return events;
  }

  /**
   * Track how long θ has stayed above threshold.
   *
   * "Continuously" means no sample fell below it — but a MISSING sample is not a
   * sample below it. A gap of up to DWELL_GAP_TOLERANCE_MS is tolerated, because
   * treating a dropped packet as a return to baseline would break the dwell on
   * exactly the fish that is pulling hardest.
   */
  private trackDwell(frame: FeatureFrame): void {
    const nowMs = frame.sample.tMonotonicMs;
    // A deadband on the way IN: without it a load sitting at the threshold never
    // accumulates dwell, because any single sample below zeroes it and the theta
    // grid steps ~0.9° near 9° at 16 mg quantisation. Deliberately asymmetric
    // with the reset hysteresis — entering an alarm should be easier than
    // leaving one.
    const floor =
      this.dwellStartMs === null
        ? this.params.thetaDeg
        : this.params.thetaDeg - DWELL_DEADBAND_DEG;
    const above = frame.thetaDeg > floor;

    if (!above) {
      this.dwellStartMs = null;
      this.lastAboveMs = null;
      return;
    }

    const gap = this.lastAboveMs === null ? 0 : nowMs - this.lastAboveMs;
    if (this.dwellStartMs === null || gap > DWELL_GAP_TOLERANCE_MS) {
      this.dwellStartMs = nowMs;
    }
    this.lastAboveMs = nowMs;
  }

  /**
   * Path A — sustained load.
   *
   * The dwell requirement is what rejects swell here: waves oscillate back
   * through baseline every few seconds, and a loaded rod does not.
   */
  private checkPathA(frame: FeatureFrame): DetectionEvent | null {
    if (this.dwellStartMs === null) return null;
    const heldMs = frame.sample.tMonotonicMs - this.dwellStartMs;
    if (heldMs < this.params.dwellMs) return null;

    return {
      type: 'ALERT_HOOKED',
      atMs: frame.sample.tMonotonicMs,
      path: 'A',
      reason:
        `Rod held ${frame.thetaDeg.toFixed(1)}° off baseline for ` +
        `${(heldMs / 1000).toFixed(1)} s — sustained load.`,
      features: snapshot(frame),
    };
  }

  /**
   * Path B — repeated sharp deflection.
   *
   * The onset-rate condition is what separates this from swell; the
   * mean-deviation / CV condition is the backstop for when it does not.
   */
  private checkPathB(frame: FeatureFrame): DetectionEvent | null {
    const { crossingsN, meanDevDeg, cvMin } = this.params;

    if (frame.crossings < crossingsN) return null;
    if (frame.sharpCrossings < crossingsN - 1) return null;

    const dcOffset = frame.meanDeviationDeg >= meanDevDeg;
    const irregular = frame.crossingIntervalCv !== null && frame.crossingIntervalCv >= cvMin;
    if (!dcOffset && !irregular) return null;

    return {
      type: 'ALERT_HOOKED',
      atMs: frame.sample.tMonotonicMs,
      path: 'B',
      reason:
        `${frame.crossings} deflections (${frame.sharpCrossings} sharp) with ` +
        (dcOffset
          ? `${frame.meanDeviationDeg.toFixed(1)}° sustained offset.`
          : `irregular timing (CV ${frame.crossingIntervalCv?.toFixed(2)}).`),
      features: snapshot(frame),
    };
  }

  /** Hysteresis, so an alert does not flicker off on one quiet sample. */
  private checkReset(frame: FeatureFrame): DetectionEvent | null {
    const nowMs = frame.sample.tMonotonicMs;
    const quiet = frame.thetaDeg < this.params.thetaDeg * RESET_THETA_FACTOR;

    if (!quiet) {
      this.belowSinceMs = null;
      return null;
    }
    if (this.belowSinceMs === null) this.belowSinceMs = nowMs;

    if (nowMs - this.belowSinceMs < RESET_HOLD_MS) return null;
    if (frame.crossings >= this.params.crossingsN) return null;

    this.belowSinceMs = null;
    return {
      type: 'RESET_TO_ARMED',
      atMs: nowMs,
      reason: 'Rod back at rest — watching again.',
    };
  }
}

function snapshot(frame: FeatureFrame): NonNullable<DetectionEvent['features']> {
  return {
    thetaDeg: frame.thetaDeg,
    crossings: frame.crossings,
    sharpCrossings: frame.sharpCrossings,
    meanDeviationDeg: frame.meanDeviationDeg,
    crossingIntervalCv: frame.crossingIntervalCv,
  };
}
