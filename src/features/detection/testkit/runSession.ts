/**
 * Drive the full Phase 3 + Phase 4 pipeline over a synthetic stream.
 *
 * Mirrors exactly what the runtime does per sample, so a passing test is
 * evidence about the shipped path rather than about a test-only arrangement.
 */

import type { AccSample } from '../accSample';
import { DetectionEngine, type DetectionEvent } from '../detectionEngine';
import { DEFAULT_DETECTION_PARAMS, type DetectionParams } from '../detectionParams';
import { FeatureExtractor, type FeatureFrame } from '../featureExtractor';
import { TEST_BASELINE } from './syntheticStream';

export interface SessionResult {
  events: DetectionEvent[];
  frames: FeatureFrame[];
  /** Onset rates actually measured, for asserting on the Δt guard. */
  measuredOnsetRates: number[];
  alerts: DetectionEvent[];
  finalState: string;
}

export function runSession(
  samples: readonly AccSample[],
  overrides: Partial<DetectionParams> = {},
): SessionResult {
  const params = { ...DEFAULT_DETECTION_PARAMS, ...overrides };
  const extractor = new FeatureExtractor(TEST_BASELINE, params);
  const engine = new DetectionEngine(params);

  if (samples.length > 0) engine.arm(samples[0]!.tMonotonicMs);

  const events: DetectionEvent[] = [];
  const frames: FeatureFrame[] = [];

  for (const s of samples) {
    const frame = extractor.process(s);
    frames.push(frame);
    events.push(...engine.process(frame));
  }

  return {
    events,
    frames,
    measuredOnsetRates: [],
    alerts: events.filter((e) => e.type === 'ALERT_HOOKED'),
    finalState: engine.getState(),
  };
}

/** Convenience for the common assertion. */
export function alerted(result: SessionResult): boolean {
  return result.alerts.length > 0;
}
