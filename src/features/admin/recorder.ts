/**
 * Ground-truth recorder: writes every accelerometer sample, every algorithmic
 * detection, and every bite the angler marks by hand, so the detector can be
 * tuned offline against what actually happened.
 *
 * Deliberately not a hook, for the same reason as rodRuntime: capture must
 * continue while the user is on another tab, and a hook would tie the recording
 * to a mounted component.
 *
 * WRITE STRATEGY — chunked, not buffered-to-the-end. expo-file-system has no
 * append, so the options were "hold the whole session in memory and write once"
 * or "write numbered chunk files". Chunking wins: a crash, a battery death or a
 * force-quit three hours into a session then costs at most the last chunk
 * instead of the entire recording, and memory stays flat. `meta.json` is small
 * and rewritten on every flush, so the events survive too.
 */
import { create } from 'zustand';

import { SENSOR_SAMPLE_RATE_HZ } from '@/config/constants';
import type { DetectorTick } from '@/features/bite-detection/types';
import type { Rod } from '@/features/rods/rod';
import { useSettingsStore } from '@/features/settings/settingsStore';
import type { BiteEvent } from '@/types';

import {
  CAPTURE_SCHEMA_VERSION,
  type CaptureEvent,
  type CaptureMeta,
} from './captureTypes';
import { eventsCsv, SAMPLE_CSV_HEADER, sampleRow } from './csv';
import { appVersion, captureRoot, fs, recordingDir } from './storage';

/** Rows held in memory before a chunk is written. ~100 s at 10 Hz on one rod. */
const CHUNK_ROWS = 1000;
/** A partial chunk is flushed after this long, so a quiet rod still persists. */
const FLUSH_INTERVAL_MS = 30_000;
/** Counter publish cadence — never once per sample. */
const PUBLISH_MS = 500;

interface ActiveRecording {
  id: string;
  dir: string;
  meta: CaptureMeta;
  /** Pending CSV rows, not yet written to a chunk. */
  rows: string[];
  /** Latest device-clock time seen per rod, for stamping human marks. */
  lastDeviceT: Map<string, number>;
  lastFlush: number;
  /** Guards against two flushes interleaving and writing the same chunk twice. */
  writing: boolean;
}

let active: ActiveRecording | null = null;
let publishTimer: ReturnType<typeof setInterval> | null = null;
let seq = 0;

// ---------------------------------------------------------------------------
// Reactive view — the only thing React reads.
// ---------------------------------------------------------------------------

export interface CaptureView {
  recording: boolean;
  id: string | null;
  label: string;
  startedAt: number | null;
  sampleCount: number;
  detections: number;
  humanMarks: number;
  /** Set when a write failed; capture keeps running so a disk hiccup is survivable. */
  error: string | null;
}

const IDLE: CaptureView = {
  recording: false,
  id: null,
  label: '',
  startedAt: null,
  sampleCount: 0,
  detections: 0,
  humanMarks: 0,
  error: null,
};

export const useCaptureStore = create<CaptureView>(() => IDLE);

function publish(): void {
  if (!active) {
    useCaptureStore.setState(IDLE);
    return;
  }
  const events = active.meta.events;
  useCaptureStore.setState({
    recording: true,
    id: active.id,
    label: active.meta.label,
    startedAt: active.meta.startedAt,
    sampleCount: active.meta.sampleCount,
    detections: events.reduce((n, e) => n + (e.kind === 'detection' ? 1 : 0), 0),
    humanMarks: events.reduce((n, e) => n + (e.kind === 'human' ? 1 : 0), 0),
  });
}

function setError(message: string): void {
  useCaptureStore.setState({ error: message });
}

// ---------------------------------------------------------------------------

function newRecordingId(): string {
  seq += 1;
  return `cap_${Date.now().toString(36)}_${seq.toString(36)}`;
}

async function writeMeta(rec: ActiveRecording): Promise<void> {
  await fs().writeAsStringAsync(
    `${rec.dir}meta.json`,
    JSON.stringify(rec.meta, null, 2),
  );
}

/**
 * Write pending rows as the next chunk, then rewrite metadata.
 *
 * Rows are detached before the first await: another sample arriving mid-write
 * must land in the next chunk, not be silently dropped or written twice.
 */
async function flush(rec: ActiveRecording, force = false): Promise<void> {
  if (rec.writing) return;
  if (rec.rows.length === 0 && !force) return;

  rec.writing = true;
  const rows = rec.rows;
  rec.rows = [];
  rec.lastFlush = Date.now();

  let chunkWritten = false;
  try {
    if (rows.length > 0) {
      const index = String(rec.meta.chunkCount).padStart(4, '0');
      await fs().writeAsStringAsync(
        `${rec.dir}chunk-${index}.csv`,
        `${SAMPLE_CSV_HEADER}\n${rows.join('\n')}\n`,
      );
      // Counted only after the write lands. Incrementing first and rolling back
      // on error would corrupt the sequence when the chunk succeeded but the
      // metadata write below did not: the next flush would reuse the index and
      // silently overwrite a chunk that was already on disk.
      chunkWritten = true;
      rec.meta.chunkCount += 1;
    }
    await writeMeta(rec);
  } catch (e) {
    // Retry these rows on the next flush rather than lose them — but only if
    // they never reached disk, or a successful chunk would be written twice.
    if (!chunkWritten) rec.rows = rows.concat(rec.rows);
    setError(e instanceof Error ? e.message : 'Failed to write capture chunk.');
  } finally {
    rec.writing = false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isRecording(): boolean {
  return active !== null;
}

export async function startRecording(rods: readonly Rod[], label = ''): Promise<boolean> {
  if (active) return true;

  const settings = useSettingsStore.getState().settings;
  const id = newRecordingId();
  const dir = recordingDir(id);

  const meta: CaptureMeta = {
    schema: CAPTURE_SCHEMA_VERSION,
    id,
    label,
    startedAt: Date.now(),
    endedAt: null,
    appVersion: appVersion(),
    detector: {
      sampleRateHz: SENSOR_SAMPLE_RATE_HZ,
      sensitivity: settings.sensitivity,
      liveBaitMode: settings.liveBaitMode,
    },
    rods: rods.map((r) => ({
      id: r.id,
      name: r.name,
      sensorKind: r.sensorKind,
      deviceId: r.deviceId,
    })),
    sampleCount: 0,
    chunkCount: 0,
    events: [],
  };

  const rec: ActiveRecording = {
    id,
    dir,
    meta,
    rows: [],
    lastDeviceT: new Map(),
    lastFlush: Date.now(),
    writing: false,
  };

  try {
    await fs().makeDirectoryAsync(dir, { intermediates: true });
    await writeMeta(rec);
  } catch (e) {
    setError(e instanceof Error ? e.message : 'Could not create the recording.');
    return false;
  }

  active = rec;
  useCaptureStore.setState({ ...IDLE, recording: true, id, label, startedAt: meta.startedAt });
  publishTimer ??= setInterval(publish, PUBLISH_MS);
  return true;
}

export async function stopRecording(): Promise<string | null> {
  const rec = active;
  if (!rec) return null;
  active = null;

  if (publishTimer) {
    clearInterval(publishTimer);
    publishTimer = null;
  }

  rec.meta.endedAt = Date.now();
  await flush(rec, true);
  try {
    // A flat events file next to the samples, so analysis is two read_csv calls.
    await fs().writeAsStringAsync(`${rec.dir}events.csv`, eventsCsv(rec.meta.events));
  } catch {
    /* meta.json still holds every event — the CSV is a convenience. */
  }

  useCaptureStore.setState(IDLE);
  return rec.id;
}

/**
 * Record one sample. Called from rodRuntime for every rod on every tick, so the
 * inactive path must stay a single null check.
 */
export function captureSample(rodId: string, tick: DetectorTick): void {
  const rec = active;
  if (!rec) return;

  rec.rows.push(sampleRow(rodId, tick));
  rec.meta.sampleCount += 1;
  rec.lastDeviceT.set(rodId, tick.sample.t);

  if (rec.rows.length >= CHUNK_ROWS || Date.now() - rec.lastFlush >= FLUSH_INTERVAL_MS) {
    void flush(rec);
  }
}

/** Record that the algorithm fired. */
export function captureDetection(
  rodId: string,
  rodName: string,
  bite: BiteEvent,
  threshold: number,
): void {
  const rec = active;
  if (!rec) return;
  rec.meta.events.push({
    kind: 'detection',
    at: Date.now(),
    deviceT: bite.timestamp,
    rodId,
    rodName,
    size: bite.size,
    peakMagnitude: bite.peakMagnitude,
    confidence: bite.confidence,
    threshold,
  });
}

/**
 * Record that the angler saw a bite.
 *
 * Stamped with wall-clock time at the press. The device clock is filled in from
 * the rod's most recent sample, which is the closest row in the CSV — it cannot
 * be derived from the press itself, since the two clocks are unrelated.
 */
export function markHumanBite(rodId: string, rodName: string): CaptureEvent | null {
  const rec = active;
  if (!rec) return null;
  const event: CaptureEvent = {
    kind: 'human',
    at: Date.now(),
    deviceT: rec.lastDeviceT.get(rodId) ?? null,
    rodId,
    rodName,
  };
  rec.meta.events.push(event);
  publish();
  return event;
}

/** Drop the most recent human mark — for a mis-tap, which is otherwise poison. */
export function undoLastHumanMark(): boolean {
  const rec = active;
  if (!rec) return false;
  for (let i = rec.meta.events.length - 1; i >= 0; i -= 1) {
    if (rec.meta.events[i]!.kind === 'human') {
      rec.meta.events.splice(i, 1);
      publish();
      return true;
    }
  }
  return false;
}

export function setRecordingLabel(label: string): void {
  if (!active) return;
  active.meta.label = label;
  publish();
}

/** Where recordings live, for the export/pull instructions in the UI. */
export function captureDirectory(): string {
  return captureRoot();
}

/** Test seam. */
export function resetRecorder(): void {
  active = null;
  if (publishTimer) {
    clearInterval(publishTimer);
    publishTimer = null;
  }
  useCaptureStore.setState(IDLE);
}
