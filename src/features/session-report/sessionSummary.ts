/**
 * Session summary model — pure, no imports beyond types, fully unit-tested.
 *
 * A deliberate note on clocks: `BiteEvent.timestamp` is a DEVICE-clock value
 * (wrapping uint32, no calendar meaning — see types/index.ts), so it can never
 * be placed on a wall-clock timeline. The live screen therefore stamps each bite
 * with the real time it was emitted; everything here works off that `at` field.
 */

import type { BiteEvent, EnvironmentSnapshot } from '@/types';

/** A bite as captured during a live session, with real capture time. */
export interface SessionBite {
  event: BiteEvent;
  /** Wall-clock epoch ms when the detector emitted this bite. */
  at: number;
  /** Which rod produced it. Absent for single-rod sessions. */
  rodId?: string;
  /** Rod name at capture time, so a later rename can't rewrite the report. */
  rodName?: string;
}

/** Per-rod tally for the report, so a multi-rod session is legible. */
export interface RodTally {
  rodId: string;
  rodName: string;
  bites: number;
  /** Hardest strike on this rod. */
  peakMagnitude: number;
}

export interface HotWindow {
  startAt: number;
  endAt: number;
  count: number;
}

export interface SessionSummary {
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
  bites: SessionBite[];
  totalBites: number;
  bigBites: number;
  smallBites: number;
  /** Bites per hour over the session. 0 for a zero-length session. */
  biteRate: number;
  /** Hardest strike of the session, or null if there were none. */
  strongest: SessionBite | null;
  /** Mean detector confidence across bites; 0 when there were none. */
  avgConfidence: number;
  /** Busiest HOT_WINDOW_MS stretch, or null with fewer than 2 bites. */
  hottestWindow: HotWindow | null;
  /** Conditions captured when the session started, if the fetch succeeded. */
  conditions: Partial<EnvironmentSnapshot> | null;
  /**
   * Bites per rod, busiest first. Empty for a session whose bites carry no rod
   * attribution (single-rod, or records from before multi-rod).
   */
  perRod: RodTally[];
}

/** Width of the "hottest window" search. 30 min is a meaningful feeding burst. */
export const HOT_WINDOW_MS = 30 * 60 * 1000;

export interface BuildSessionInput {
  startedAt: number;
  endedAt: number;
  bites: SessionBite[];
  conditions?: Partial<EnvironmentSnapshot> | null;
}

/**
 * Busiest fixed-width window over the bite times.
 *
 * Two pointers over the (sorted) bite list: for each bite as the window start,
 * advance the end while it stays inside the window. O(n) rather than O(n²)
 * because neither pointer ever moves backwards.
 */
export function hottestWindow(
  bites: SessionBite[],
  windowMs: number = HOT_WINDOW_MS,
): HotWindow | null {
  if (bites.length < 2) return null;

  let best: HotWindow | null = null;
  let end = 0;
  for (let start = 0; start < bites.length; start++) {
    const from = bites[start]!.at;
    if (end < start) end = start;
    while (end + 1 < bites.length && bites[end + 1]!.at - from <= windowMs) end++;
    const count = end - start + 1;
    if (!best || count > best.count) {
      best = { startAt: from, endAt: from + windowMs, count };
    }
  }
  // A "burst" of one bite is just a bite — not worth reporting as a window.
  return best && best.count >= 2 ? best : null;
}

/**
 * Group bites by rod, busiest first. Bites with no rodId are skipped rather
 * than lumped into an "unknown" bucket — a phantom rod in the report would be
 * more confusing than an absent breakdown.
 */
export function tallyByRod(bites: readonly SessionBite[]): RodTally[] {
  const byRod = new Map<string, RodTally>();
  for (const b of bites) {
    if (!b.rodId) continue;
    const existing = byRod.get(b.rodId);
    if (existing) {
      existing.bites += 1;
      existing.peakMagnitude = Math.max(existing.peakMagnitude, b.event.peakMagnitude);
    } else {
      byRod.set(b.rodId, {
        rodId: b.rodId,
        rodName: b.rodName ?? b.rodId,
        bites: 1,
        peakMagnitude: b.event.peakMagnitude,
      });
    }
  }
  return [...byRod.values()].sort((a, b) => b.bites - a.bites);
}

export function buildSessionSummary(input: BuildSessionInput): SessionSummary {
  const { startedAt, endedAt, conditions = null } = input;
  // Never trust arrival order: sort defensively so the window scan holds.
  const bites = [...input.bites].sort((a, b) => a.at - b.at);

  const durationSeconds = Math.max(0, (endedAt - startedAt) / 1000);
  const bigBites = bites.filter((b) => b.event.size === 'big').length;

  let strongest: SessionBite | null = null;
  let confidenceTotal = 0;
  for (const b of bites) {
    confidenceTotal += b.event.confidence;
    if (!strongest || b.event.peakMagnitude > strongest.event.peakMagnitude) strongest = b;
  }

  return {
    startedAt,
    endedAt,
    durationSeconds,
    bites,
    totalBites: bites.length,
    bigBites,
    smallBites: bites.length - bigBites,
    biteRate: durationSeconds > 0 ? bites.length / (durationSeconds / 3600) : 0,
    strongest,
    avgConfidence: bites.length > 0 ? confidenceTotal / bites.length : 0,
    hottestWindow: hottestWindow(bites),
    conditions,
    perRod: tallyByRod(bites),
  };
}

/**
 * Bite counts bucketed evenly across the session, for the timeline chart.
 * Always returns exactly `buckets` entries so the chart has a stable width.
 */
export function timelineBuckets(summary: SessionSummary, buckets = 12): number[] {
  const out = new Array<number>(buckets).fill(0);
  const span = summary.endedAt - summary.startedAt;
  if (span <= 0) return out;

  for (const b of summary.bites) {
    const ratio = (b.at - summary.startedAt) / span;
    // Clamp so a bite landing exactly at the end lands in the last bucket
    // rather than one past it.
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor(ratio * buckets)));
    out[idx] = (out[idx] ?? 0) + 1;
  }
  return out;
}

/** "1h 24m" / "12m" / "48s" — compact, human duration. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const hours = Math.floor(s / 3600);
  const minutes = Math.round((s % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
