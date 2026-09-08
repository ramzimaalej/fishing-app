/**
 * Periodically reconnect to a tag that has gone quiet, to try to wake it.
 *
 * The CP27 sleeps to save its cell: leave the rod alone and it stops sending
 * accelerometer frames, which the app can only observe as silence. The vendor
 * app shows the same behaviour, so this is the hardware's own idle policy rather
 * than anything the app does wrong.
 *
 * WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT. It connects, unlocks with
 * the password and reads the battery — the exact sequence readBattery already
 * performs and the only sequence any capture has ever confirmed. It sends NO
 * command opcode. See cp27Opcodes: the command channel also configures the
 * advertising interval, the transmit power and the password itself, there is no
 * factory reset outside the vendor app, and a tag bricked by a guessed write
 * looks exactly like a flat battery. A wake opcode was never captured, so none
 * is sent.
 *
 * WHETHER IT WORKS IS UNPROVEN. Connecting demonstrates the tag is alive and
 * reachable; nothing we have captured says it resumes broadcasting afterwards.
 * That is why every attempt is scored — `stats()` reports attempts against wakes
 * — so a bench session can answer the question with evidence instead of hope.
 *
 * TWO COSTS, BOTH REAL. A peripheral generally stops advertising while
 * connected, so each attempt punches a hole in the very stream it is trying to
 * restore; attempts are therefore rate-limited and never made during an alert.
 * And a connection is far more expensive for the tag's cell than advertising is,
 * which is the second reason not to try this often.
 */

import { SIGNAL_LOST_MS } from '@/features/detection/detectionParams';

/**
 * Silence that counts as "gone quiet".
 *
 * The same bar the detector uses to declare the signal lost. Below it the stream
 * is merely sparse — this tag advertises every ~3.6 s — and connecting would
 * interrupt a stream that is working.
 */
export const KEEPALIVE_AFTER_SILENT_MS = SIGNAL_LOST_MS;

/** Shortest gap between attempts, while they are working. */
export const KEEPALIVE_MIN_INTERVAL_MS = 60_000;

/** Longest gap, after repeated failures. A tag that is off stays off. */
export const KEEPALIVE_MAX_INTERVAL_MS = 10 * 60_000;

/**
 * An advertisement this soon after an attempt is credited to it.
 *
 * Generous on purpose: the tag advertises about every 3.6 s but the connection
 * itself takes seconds, and the point of the number is to measure whether this
 * mechanism does anything at all, not to be precise about how fast.
 */
export const KEEPALIVE_WOKE_WITHIN_MS = 30_000;

export interface KeepAliveInputs {
  nowMs: number;
  /** Monotonic ms of the last advertisement from this tag, null if never heard. */
  lastHeardMs: number | null;
  /** When this rod started expecting data — silence is measured from here first. */
  watchingSinceMs: number | null;
  /** An alert is live. Never interrupt one: the connection would stop the stream. */
  alerting: boolean;
}

export interface KeepAliveStats {
  attempts: number;
  /** Attempts followed by an advertisement within KEEPALIVE_WOKE_WITHIN_MS. */
  wakes: number;
  lastAttemptMs: number | null;
  intervalMs: number;
}

/**
 * One tag's wake policy. Decision logic is pure and separate from the radio, so
 * the rules can be tested without a Bluetooth stack.
 */
export class TagKeepAlive {
  private lastAttemptMs: number | null = null;

  private intervalMs = KEEPALIVE_MIN_INTERVAL_MS;

  private inFlight = false;

  private attempts = 0;

  private wakes = 0;

  /** Attempt still waiting to see whether the tag answered it. */
  private awaitingEvidenceSince: number | null = null;

  /** Should an attempt be made right now? */
  shouldWake(input: KeepAliveInputs): boolean {
    // One connection at a time. A second attempt while the first is open would
    // fight it for the radio and prove nothing.
    if (this.inFlight) return false;

    // An alert is the one moment the stream matters most, and connecting would
    // silence it. A fish on the line outranks a tag that might be dozing.
    if (input.alerting) return false;

    // Never heard falls back to when watching began, so a tag that was asleep
    // before the rod was ever armed is still reached. Without this the mechanism
    // would help only tags that had already worked once.
    const since = input.lastHeardMs ?? input.watchingSinceMs;
    if (since === null) return false;
    if (input.nowMs - since < KEEPALIVE_AFTER_SILENT_MS) return false;

    if (this.lastAttemptMs !== null && input.nowMs - this.lastAttemptMs < this.intervalMs) {
      return false;
    }

    return true;
  }

  /** Mark an attempt as started. Call immediately before connecting. */
  begin(nowMs: number): void {
    this.inFlight = true;
    this.lastAttemptMs = nowMs;
    this.awaitingEvidenceSince = nowMs;
    this.attempts += 1;
  }

  /**
   * Mark the attempt finished.
   *
   * `reached` says only that the connection succeeded, which is NOT the same as
   * having woken the tag — that is decided by noteHeard, when an advertisement
   * actually turns up. Backing off on an unreachable tag is what stops a phone
   * retrying a tag left at home every minute all day.
   */
  end(reached: boolean): void {
    this.inFlight = false;
    if (reached) return;
    this.awaitingEvidenceSince = null;
    this.intervalMs = Math.min(this.intervalMs * 2, KEEPALIVE_MAX_INTERVAL_MS);
  }

  /**
   * An advertisement arrived. Credits the pending attempt if it was recent
   * enough, which is the only evidence that connecting does anything.
   */
  noteHeard(nowMs: number): void {
    if (this.awaitingEvidenceSince === null) return;
    if (nowMs - this.awaitingEvidenceSince <= KEEPALIVE_WOKE_WITHIN_MS) {
      this.wakes += 1;
      // It worked, so stop backing off: this tag responds to being woken.
      this.intervalMs = KEEPALIVE_MIN_INTERVAL_MS;
    }
    this.awaitingEvidenceSince = null;
  }

  stats(): KeepAliveStats {
    return {
      attempts: this.attempts,
      wakes: this.wakes,
      lastAttemptMs: this.lastAttemptMs,
      intervalMs: this.intervalMs,
    };
  }
}
