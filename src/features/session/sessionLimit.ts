/**
 * Fishing-session time limits — pure, so every boundary is testable without a
 * clock, a store, or an ad network.
 *
 * Free accounts monitor in FREE_SESSION_HOURS blocks: the first block of each
 * local day is free, and continuing beyond that means subscribing.
 * Premium has no limit — `expiresAt: null` means "never".
 *
 * Enforcement is genuinely load-bearing here: when a window lapses the runtime
 * disarms every rod, so a lapse the user didn't notice means rods nobody is
 * watching. Hence the warning threshold, and hence expiry is computed from
 * wall-clock timestamps rather than a JS timer (a 6-hour timeout does not
 * survive the app being suspended).
 */

import {
  FREE_SESSION_HOURS,
  FREE_SESSIONS_PER_DAY,
  SESSION_EXPIRY_WARNING_MINUTES,
  SESSION_EXTENSION_HOURS,
} from '@/config/constants';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export interface SessionWindow {
  startedAt: number;
  /** Epoch ms the session lapses, or null for an unlimited (premium) session. */
  expiresAt: number | null;
  /** How many extensions have been applied to this window. */
  extensions: number;
  /** Local day key the session was started on (see dayKeyOf). */
  dayKey: string;
}

/** Length of one free block. Null for premium — no limit. */
export function sessionDurationMs(isPremium: boolean): number | null {
  return isPremium ? null : FREE_SESSION_HOURS * HOUR_MS;
}

export function createWindow(now: number, isPremium: boolean, dayKey: string): SessionWindow {
  const duration = sessionDurationMs(isPremium);
  return {
    startedAt: now,
    expiresAt: duration === null ? null : now + duration,
    extensions: 0,
    dayKey,
  };
}

/**
 * Add one block to a window.
 *
 * Extends from whichever is later — the current expiry or now — so extending
 * early adds to the end (no time thrown away) while extending after a lapse
 * still buys a full block. An ad always buys SESSION_EXTENSION_HOURS of fishing.
 */
export function extendWindow(window: SessionWindow, now: number): SessionWindow {
  if (window.expiresAt === null) return window; // unlimited: nothing to extend
  const from = Math.max(window.expiresAt, now);
  return {
    ...window,
    expiresAt: from + SESSION_EXTENSION_HOURS * HOUR_MS,
    extensions: window.extensions + 1,
  };
}

export function isExpired(window: SessionWindow | null, now: number): boolean {
  if (!window || window.expiresAt === null) return false;
  return now >= window.expiresAt;
}

/** Milliseconds left, or null when unlimited. Never negative. */
export function msRemaining(window: SessionWindow | null, now: number): number | null {
  if (!window) return 0;
  if (window.expiresAt === null) return null;
  return Math.max(0, window.expiresAt - now);
}

/** True inside the warning window — time to prompt for an extension. */
export function isNearExpiry(window: SessionWindow | null, now: number): boolean {
  const remaining = msRemaining(window, now);
  if (remaining === null) return false;
  return remaining > 0 && remaining <= SESSION_EXPIRY_WARNING_MINUTES * MINUTE_MS;
}

/** Epoch ms at which the warning should fire, or null when unlimited. */
export function warningAt(window: SessionWindow | null): number | null {
  if (!window || window.expiresAt === null) return null;
  return window.expiresAt - SESSION_EXPIRY_WARNING_MINUTES * MINUTE_MS;
}

export type StartRefusal = 'daily-allowance-used';

export interface StartVerdict {
  allowed: boolean;
  /** Set when an ad would unblock it. Premium never sees this. */
  reason?: StartRefusal;
}

/**
 * Whether a free account may start a session without watching an ad.
 *
 * `blocksUsedToday` counts blocks already consumed on the current local day —
 * the initial session plus every extension, since both grant the same amount of
 * fishing and the user should not be able to launder one into the other by
 * ending and restarting.
 */
export function canStartFree(blocksUsedToday: number, isPremium: boolean): StartVerdict {
  if (isPremium) return { allowed: true };
  if (blocksUsedToday >= FREE_SESSIONS_PER_DAY) {
    return { allowed: false, reason: 'daily-allowance-used' };
  }
  return { allowed: true };
}

/** "5h 42m" / "42m" / "under a minute" — for the session countdown. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'expired';
  const totalMinutes = Math.floor(ms / MINUTE_MS);
  if (totalMinutes < 1) return 'under a minute';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
