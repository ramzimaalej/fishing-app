/**
 * Detector timings derived from the rate the tag is ACTUALLY advertising at.
 *
 * WHY THIS EXISTS. Every timing here was once a constant derived from a single
 * hand-set interval, and that interval was measured wrong: the captures behind
 * it were taken while the app scanned in LowPower mode, which was discarding
 * something like nine advertisements in ten. The tag was recorded at 0.28 Hz and
 * the whole detector was tuned for it. Measured again through a full-duty scan,
 * the same tag advertises at 7.3 Hz — twenty-six times faster. A scanner bug had
 * been written down as a property of the hardware.
 *
 * A second measurement is why no fixed number replaces it. Two tags in the same
 * room differed seventeen-fold — 7.3 Hz for one being handled, 0.43 Hz for one
 * left alone — because the CP27 advertises fast when it moves and slowly when it
 * does not. So the rate is not a property of the tag at all: it is a property of
 * what the rod is doing, and it changes during a session. Arming happens with
 * the rod at rest, where the tag is slow; a bite happens with the rod moving,
 * where it is fast. No single constant is right for both.
 *
 * WHAT IS AND IS NOT DERIVED. Only quantities counted in SAMPLES belong here.
 * How long a fish holds a rod, how far it bends it, how fast a wave loads it —
 * those are facts about fish and water, identical at 0.4 Hz and 7 Hz, and
 * scaling them by the advertising rate is what produced a 6.5 s dwell that no
 * real bite would ever satisfy. They stay in detectionParams as constants.
 */

/** Below this the estimate is noise; above it nothing works whatever we set. */
export const MIN_INTERVAL_MS = 20;
export const MAX_INTERVAL_MS = 10_000;

/**
 * Widest gap across which a leading edge still means something, regardless of
 * packet loss.
 *
 * Separate from the dropped-packet question. A fish loads a rod in 100-300 ms
 * and a wave over 1-3 s, so sampling slower than this cannot separate them even
 * with a perfect, gapless stream — the edge falls between two readings and was
 * never observed. This is the point past which the onset-rate feature is not
 * merely noisy but meaningless.
 */
export const ONSET_RESOLVABLE_MS = 300;

/** Fraction of theoretically available samples that arming demands. */
const ARMING_YIELD = 0.65;

export interface RateDerivedTimings {
  /** The smoothed inter-sample interval these were derived from. */
  intervalMs: number;
  /** Silence after which the stream is declared lost. */
  signalLostMs: number;
  /** Silence a dwell tolerates before it is considered broken. */
  dwellGapToleranceMs: number;
  /** Widest pair whose slope is trusted. */
  maxDtForRateMs: number;
  /**
   * Whether the onset-rate feature — and therefore Path B — can work at all.
   *
   * False is not a failure to report to the user as an error; it is a statement
   * that at this rate the rod can be seen to be bent but not how it got bent.
   */
  pathBAvailable: boolean;
  armingMinSamples: number;
  armingFastMinSamples: number;
  rebaselineMinSamples: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Derive every sample-counted timing from one observed interval.
 *
 * Pure, so the rules can be checked at any rate without a radio or a clock.
 */
export function timingsFor(
  rawIntervalMs: number,
  windows: { armingDurationMs: number; armingMinSpanMs: number; rebaselineStillMs: number },
): RateDerivedTimings {
  const intervalMs = clamp(rawIntervalMs, MIN_INTERVAL_MS, MAX_INTERVAL_MS);

  // Floors matter more than the multipliers. At 7 Hz, six intervals is under a
  // second, and declaring the stream lost that eagerly would fire on a hand
  // passing between rod and phone. The floor is what keeps a fast tag from
  // making the alarm hair-trigger.
  const signalLostMs = clamp(intervalMs * 6, 2_500, 25_000);

  // Ceilinged by signalLostMs, not by a number of its own. A fixed ceiling can
  // clamp the tolerance down to the interval itself on a slow tag, and a dwell
  // gap tolerance that does not EXCEED one interval breaks the dwell between
  // every pair of readings — which zeroes held time on each sample and makes
  // Path A silently unreachable. Tying it to the point at which the stream is
  // declared dead makes that impossible by construction: a dwell can never
  // usefully outlive the stream carrying it.
  const dwellGapToleranceMs = clamp(intervalMs * 2.5, 400, signalLostMs);

  // Two independent limits, and the tighter wins. 1.5 intervals is "these two
  // packets were consecutive, allowing for jitter", which is what rejects a
  // slope inferred across packets that were lost. ONSET_RESOLVABLE_MS is the
  // separate physical limit past which the feature means nothing anyway.
  const maxDtForRateMs = Math.min(ONSET_RESOLVABLE_MS, Math.round(intervalMs * 1.5));
  const pathBAvailable = intervalMs * 1.5 <= ONSET_RESOLVABLE_MS;

  const fromWindow = (windowMs: number, floor: number, ceiling: number): number =>
    clamp(Math.floor((windowMs / intervalMs) * ARMING_YIELD), floor, ceiling);

  return {
    intervalMs,
    signalLostMs,
    dwellGapToleranceMs,
    maxDtForRateMs,
    pathBAvailable,
    armingMinSamples: fromWindow(windows.armingDurationMs, 8, 600),
    // Three is the floor everywhere: two readings cannot disagree, so they
    // cannot evidence stillness however long they are spread over.
    armingFastMinSamples: fromWindow(windows.armingMinSpanMs, 3, 200),
    rebaselineMinSamples: fromWindow(windows.rebaselineStillMs, 5, 600),
  };
}

/**
 * Rolling estimate of the inter-sample interval.
 *
 * MEDIAN, not a mean or an EMA. The stream drops advertisements freely and
 * carries no sequence numbers, so a handful of gaps are several times the true
 * interval; a mean is dragged upward by exactly those outliers and would report
 * a tag as slower than it is, which is the error that started all of this. A
 * median ignores them until they are the majority — at which point the tag
 * really has slowed down, and the estimate should follow.
 */
export class RateEstimator {
  private readonly window: number[] = [];

  private readonly capacity: number;

  constructor(capacity = 21) {
    this.capacity = capacity;
  }

  push(dtMs: number): void {
    // A non-positive or absurd gap says the clock jumped, not that the tag did
    // something; feeding it in would corrupt the estimate for the next 21
    // samples.
    if (!Number.isFinite(dtMs) || dtMs <= 0 || dtMs > MAX_INTERVAL_MS) return;
    this.window.push(dtMs);
    if (this.window.length > this.capacity) this.window.shift();
  }

  /** Null until there is enough to be worth trusting. */
  estimateMs(): number | null {
    if (this.window.length < 3) return null;
    const sorted = [...this.window].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  }

  reset(): void {
    this.window.length = 0;
  }
}
