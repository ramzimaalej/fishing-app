/**
 * How long a reported bite stays on screen.
 *
 * WHY IT HAS TO END. The alert banner used to live for the rest of the session:
 * `lastBite` was set when the detector fired and cleared only on disarm. That
 * had two costs, and the second is the expensive one.
 *
 *   - An answered alert kept asking. The verdict was stated back where the
 *     buttons had been, so the screen went on reporting a fish landed twenty
 *     minutes ago as though it were news.
 *   - A NEW alert was indistinguishable from the old one. The banner for the
 *     second bite on the same rod differs from the first only in a peak angle,
 *     so an alarm that never clears is an alarm you stop being able to read.
 *     Vanishing between bites is what makes the next one legible as an event.
 *
 * FIFTEEN SECONDS, from the bite or from the verdict, whichever came last. Long
 * enough to reach a rod that has just been put down and answer the question;
 * short enough that the screen describes the present. A verdict restarts the
 * window rather than dismissing at once, so the angler sees their answer land
 * instead of the banner disappearing under their thumb.
 *
 * SEPARATE FROM THE DETECTOR'S ALERT STATE, which is a different question with a
 * different answer. The engine stays in ALERT_HOOKED until the rod returns to
 * rest or ALERT_MAX_MS expires, because a fish still bending the rod is still a
 * fish; this is only about how long the notice is worth reading.
 */

/** Time a bite banner stays up, from the bite or the verdict, whichever is later. */
export const BITE_BANNER_MS = 15_000;

/**
 * The banner's clock.
 *
 * A timer rather than a timestamp checked on the next sample, because the case
 * that matters most is a rod that has gone quiet: no samples arrive, nothing
 * would re-publish, and a banner waiting for a tick it will never get is exactly
 * the stale alarm this exists to remove.
 */
export class BiteBannerTimer {
  private handle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onExpire: () => void,
    private readonly durationMs: number = BITE_BANNER_MS,
  ) {}

  /**
   * Start — or restart — the window.
   *
   * Restarting REPLACES the pending expiry rather than adding to it. Without
   * that, a second bite ten seconds after the first would be swept away five
   * seconds later by the first bite's timer, and the newest alert would be the
   * shortest-lived one on screen.
   */
  restart(): void {
    this.cancel();
    this.handle = setTimeout(() => {
      this.handle = null;
      this.onExpire();
    }, this.durationMs);
  }

  /** Stop the clock without expiring. Used when the rod is disarmed. */
  cancel(): void {
    if (this.handle === null) return;
    clearTimeout(this.handle);
    this.handle = null;
  }

  /** True while a banner is scheduled to expire — for tests and diagnostics. */
  isRunning(): boolean {
    return this.handle !== null;
  }
}
