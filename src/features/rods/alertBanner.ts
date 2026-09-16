/**
 * How long an alert banner stays on screen.
 *
 * WHY THEY HAVE TO END. Both live banners used to last the rest of the session:
 * `lastBite` and `lastImpactReason` were set when the detector fired and cleared
 * only on disarm. Two costs, and the second is the expensive one.
 *
 *   - An answered alert kept asking. The bite verdict is stated back where the
 *     buttons had been, so the screen went on reporting a fish landed twenty
 *     minutes ago as though it were news.
 *   - A NEW alert was indistinguishable from the old one. The banner for the
 *     second bite on a rod differs from the first only in a peak angle, and the
 *     impact banner is word-for-word identical every time. An alarm that never
 *     clears is an alarm you stop being able to read; vanishing in between is
 *     what makes the next one legible as an event at all.
 *
 * The impact banner is the worse of the two for exactly that reason. It says the
 * same sentence whatever provoked it, so once it is up, every subsequent knock —
 * a gust, a wave, somebody brushing past the rod — lands on a screen that
 * already claims to be reporting it.
 *
 * FIFTEEN SECONDS, from the event or from the verdict, whichever came last. Long
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

/** Time a banner stays up, from the event or the verdict, whichever is later. */
export const ALERT_BANNER_MS = 15_000;

/**
 * A banner's clock. One per banner — a bite and an impact are separate claims
 * and expire on their own schedules.
 *
 * A timer rather than a timestamp checked on the next sample, because the case
 * that matters most is a rod that has gone quiet: no samples arrive, nothing
 * would re-publish, and a banner waiting for a tick it will never get is exactly
 * the stale alarm this exists to remove.
 */
export class BannerTimer {
  private handle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onExpire: () => void,
    private readonly durationMs: number = ALERT_BANNER_MS,
  ) {}

  /**
   * Start — or restart — the window.
   *
   * Restarting REPLACES the pending expiry rather than adding to it. Without
   * that, a second event ten seconds after the first would be swept away five
   * seconds later by the first one's timer, and the newest alert would be the
   * shortest-lived thing on screen.
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
