/**
 * Pair algorithmic detections against human observations to score the detector.
 *
 * Pure and side-effect free: this is the module whose answers decide whether a
 * tuning change was an improvement, so it must be testable without a sensor, a
 * filesystem or a clock.
 *
 * WHY THE WINDOW IS ASYMMETRIC
 * Neither timestamp marks the true instant of the bite, and they miss it in the
 * same direction but by different amounts:
 *
 *   - BiteDetector emits a bite on the FALLING edge of the strike, so a
 *     detection lands at the END of the event, already after its onset.
 *   - A human presses the button after noticing, reacting, and finding the
 *     button — comfortably a second or two, and longer when they are also
 *     holding a rod.
 *
 * The human is normally the slower of the two, so a correct detection usually
 * sits BEFORE its human mark. `preMs` (how far before the press a detection may
 * be) is therefore the generous bound. `postMs` stays small but non-zero, to
 * absorb an angler who anticipates the strike and presses early.
 *
 * A symmetric window would either lose true positives at the slow end or start
 * absorbing genuinely unrelated detections, and both distort the score.
 */

import type { CaptureEvent } from './captureTypes';

export interface MatchOptions {
  /** Max ms a detection may PRECEDE the human mark and still be the same bite. */
  preMs: number;
  /** Max ms a detection may FOLLOW the human mark and still be the same bite. */
  postMs: number;
  /**
   * Only pair events from the same rod. On by default: with several rods armed,
   * crediting rod A's detection to a bite the angler saw on rod B would report a
   * detector that is working when it is not.
   */
  sameRodOnly: boolean;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  preMs: 3000,
  postMs: 1500,
  sameRodOnly: true,
};

export interface MatchedPair {
  detection: CaptureEvent;
  mark: CaptureEvent;
  /** detection.at − mark.at. Negative = the algorithm fired first (the norm). */
  deltaMs: number;
}

export interface MatchResult {
  /** Algorithm fired and the angler saw a bite. */
  truePositives: MatchedPair[];
  /** Algorithm fired at nothing the angler noticed. */
  falsePositives: CaptureEvent[];
  /** The angler saw a bite the algorithm never reported. */
  falseNegatives: CaptureEvent[];
  /**
   * TP / (TP + FP) — null when the algorithm fired zero times, because
   * "precision" over no predictions is undefined, not perfect. Reporting 1.0
   * there would make a detector that never fires look flawless.
   */
  precision: number | null;
  /** TP / (TP + FN) — null when the angler marked nothing to be measured against. */
  recall: number | null;
  /** Harmonic mean; null whenever either input is null or both are zero. */
  f1: number | null;
  /** Mean detection lead over the human mark, in ms. Null with no pairs. */
  meanDeltaMs: number | null;
}

const isDetection = (e: CaptureEvent): boolean => e.kind === 'detection';
const isHuman = (e: CaptureEvent): boolean => e.kind === 'human';

/** Whether a detection may be paired with a mark under the window. */
function withinWindow(
  detection: CaptureEvent,
  mark: CaptureEvent,
  opts: MatchOptions,
): boolean {
  if (opts.sameRodOnly && detection.rodId !== mark.rodId) return false;
  const delta = detection.at - mark.at;
  return delta >= -opts.preMs && delta <= opts.postMs;
}

/**
 * Greedy nearest-pair matching, closest pair first.
 *
 * Greedy-by-distance rather than first-come: when two detections both fall
 * inside one mark's window, the nearer should claim it and the other should be
 * counted as the false positive it is. Ties break on detection time so the
 * result never depends on input ordering.
 */
export function matchEvents(
  events: readonly CaptureEvent[],
  options: Partial<MatchOptions> = {},
): MatchResult {
  const opts = { ...DEFAULT_MATCH_OPTIONS, ...options };

  const detections = events.filter(isDetection);
  const marks = events.filter(isHuman);

  const candidates: { d: number; m: number; dist: number; at: number }[] = [];
  detections.forEach((d, di) => {
    marks.forEach((m, mi) => {
      if (!withinWindow(d, m, opts)) return;
      candidates.push({ d: di, m: mi, dist: Math.abs(d.at - m.at), at: d.at });
    });
  });

  candidates.sort((a, b) => a.dist - b.dist || a.at - b.at || a.d - b.d);

  const usedD = new Set<number>();
  const usedM = new Set<number>();
  const truePositives: MatchedPair[] = [];

  for (const c of candidates) {
    if (usedD.has(c.d) || usedM.has(c.m)) continue;
    usedD.add(c.d);
    usedM.add(c.m);
    const detection = detections[c.d]!;
    const mark = marks[c.m]!;
    truePositives.push({ detection, mark, deltaMs: detection.at - mark.at });
  }

  // Chronological output — a reviewer reads these against a timeline.
  truePositives.sort((a, b) => a.detection.at - b.detection.at);

  const falsePositives = detections.filter((_, i) => !usedD.has(i));
  const falseNegatives = marks.filter((_, i) => !usedM.has(i));

  const tp = truePositives.length;
  const precision = detections.length === 0 ? null : tp / detections.length;
  const recall = marks.length === 0 ? null : tp / marks.length;

  let f1: number | null = null;
  if (precision !== null && recall !== null && precision + recall > 0) {
    f1 = (2 * precision * recall) / (precision + recall);
  }

  const meanDeltaMs =
    tp === 0 ? null : truePositives.reduce((s, p) => s + p.deltaMs, 0) / tp;

  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1,
    meanDeltaMs,
  };
}

/** "83%" / "—" for a possibly-undefined rate. */
export function formatRate(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}
