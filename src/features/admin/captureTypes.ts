/**
 * Ground-truth capture format for tuning the bite detector.
 *
 * A recording is two artefacts on disk:
 *   - `<id>/chunk-NNNN.csv` — the raw sample stream (see csv.ts)
 *   - `<id>/meta.json`      — this metadata, including every event
 *
 * They are split because the sample stream is append-only and large while the
 * metadata is small and rewritten on every flush. Keeping events in the small
 * file means a crash mid-session still leaves a readable, labelled recording.
 *
 * CLOCK DOMAINS — the thing most likely to be got wrong here. `AccelSample.t` is
 * a DEVICE clock (a wrapping uint32 from a sensor with no real-time clock), so
 * it cannot be compared with a button press. Every event therefore carries BOTH:
 * `at` (wall clock, the domain matching runs in) and `deviceT` (sensor clock,
 * for lining an event up against a row in the CSV).
 */

import type { BiteSize } from '@/types';

export const CAPTURE_SCHEMA_VERSION = 2;

/**
 * `detection` — the algorithm fired.
 * `fish`      — the angler saw a real fish.
 * `wave`      — the angler saw the rod move because of swell.
 * `crossing`  — a threshold crossing with its FINAL onset rate.
 *
 * Comparing detections against `fish` gives true positives, false positives and
 * misses. The `wave` label is what makes the onset-rate threshold settable at
 * all: without negatives to compare against you can only see the distribution of
 * fish onsets, not whether it SEPARATES from the thing it has to be told apart
 * from. Schema 1 files used a single `human` kind; those are read as `fish`.
 */
export type CaptureEventKind = 'detection' | 'fish' | 'wave' | 'crossing';

/** Schema-1 kind, still found in recordings on disk. */
export const LEGACY_HUMAN_KIND = 'human';

export interface CaptureEvent {
  kind: CaptureEventKind;
  /** Wall-clock epoch ms. The only domain in which the two kinds are comparable. */
  at: number;
  /**
   * Sensor-clock ms, for aligning with the CSV. Null when no sample has arrived
   * yet on that rod — a human can press the button before the sensor streams.
   */
  deviceT: number | null;
  rodId: string;
  /** Denormalised: renaming a rod later must not rewrite what was recorded. */
  rodName: string;

  // --- crossing only --------------------------------------------------------
  /**
   * Final max Δθ/Δt over the rising edge, deg/s. Null when the rise contained no
   * sample pair close enough together to be trusted — which is NOT zero, and
   * must not be averaged in as though it were a slow ramp.
   */
  onsetRateDegPerS?: number | null;

  // --- detection only -------------------------------------------------------
  size?: BiteSize;
  peakMagnitude?: number;
  confidence?: number;
  /** Threshold in force when it fired, so a borderline call is explicable. */
  threshold?: number;
}

/** Detector configuration in force, so a recording can be replayed faithfully. */
export interface CaptureDetectorConfig {
  sampleRateHz: number;
  sensitivity: number;
  liveBaitMode: boolean;
}

export interface CaptureRodInfo {
  id: string;
  name: string;
  sensorKind: string;
  deviceId: string | null;
}

export interface CaptureMeta {
  schema: number;
  id: string;
  /** Optional user label, e.g. "evening surf, live bait". */
  label: string;
  startedAt: number;
  /** Null while the recording is still running (or if the app died mid-run). */
  endedAt: number | null;
  appVersion: string;
  detector: CaptureDetectorConfig;
  rods: CaptureRodInfo[];
  sampleCount: number;
  /** Number of chunk-NNNN.csv files written. */
  chunkCount: number;
  events: CaptureEvent[];
}

/** A recording as listed in the admin UI. */
export interface RecordingSummary {
  id: string;
  label: string;
  startedAt: number;
  endedAt: number | null;
  sampleCount: number;
  /** Total bytes on disk, CSV chunks plus metadata. */
  bytes: number;
  /**
   * Carried whole rather than pre-counted so the UI can re-score at a different
   * match tolerance without re-reading every file from disk. Events number in
   * the tens even for a long session, so this stays small.
   */
  events: CaptureEvent[];
}
