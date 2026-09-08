import {
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
  ONSET_RESOLVABLE_MS,
  RateEstimator,
  timingsFor,
} from '../adaptiveTiming';

const WINDOWS = {
  armingDurationMs: 60_000,
  armingMinSpanMs: 10_000,
  rebaselineStillMs: 45_000,
};

const at = (intervalMs: number) => timingsFor(intervalMs, WINDOWS);

/** The two rates actually measured on the bench, 30 s apart on one phone. */
const ACTIVE_MS = 137; // 7.3 Hz — the tag being handled
const IDLE_MS = 2_300; // 0.43 Hz — a tag left alone

describe('timings at the rates really observed', () => {
  it('lets Path B work when the tag is fast enough to show a leading edge', () => {
    // The correction this whole module exists for. Path B was documented as
    // permanently unreachable on this hardware, which was true only of a rate
    // measured through a scanner discarding nine advertisements in ten.
    const fast = at(ACTIVE_MS);
    expect(fast.pathBAvailable).toBe(true);
    expect(fast.maxDtForRateMs).toBeGreaterThanOrEqual(ACTIVE_MS);
  });

  it('refuses Path B when the tag is too slow for an onset to exist', () => {
    // Not a tuning failure. At 2.3 s between readings a fish's 100-300 ms edge
    // falls entirely between two samples, so no threshold recovers it.
    expect(at(IDLE_MS).pathBAvailable).toBe(false);
  });

  it('does not make the alarm hair-trigger on a fast tag', () => {
    // Six intervals at 7 Hz is under a second. Declaring the stream lost that
    // eagerly would fire on a hand passing between the rod and the phone.
    expect(at(ACTIVE_MS).signalLostMs).toBeGreaterThanOrEqual(2_500);
  });

  it('gives a slow tag room for several missed advertisements', () => {
    const slow = at(IDLE_MS);
    expect(slow.signalLostMs).toBeGreaterThan(IDLE_MS * 4);
    expect(slow.dwellGapToleranceMs).toBeGreaterThan(IDLE_MS);
  });

  it('asks a fast tag for far more arming samples than a slow one', () => {
    // The point of adapting. A fixed count is either unreachable for the slow
    // state or a waste of the evidence the fast one is handing over.
    expect(at(ACTIVE_MS).armingMinSamples).toBeGreaterThan(at(IDLE_MS).armingMinSamples);
  });
});

describe('a dwell can always accumulate', () => {
  // The defect that made Path A silently unreachable: a gap tolerance shorter
  // than one sample interval breaks the dwell between EVERY pair of readings,
  // so held time resets on each sample and a sustained load never alerts.
  it.each([50, 137, 500, 1_000, 2_300, 3_600, 8_000])('at %i ms between readings', (interval) => {
    expect(at(interval).dwellGapToleranceMs).toBeGreaterThan(interval);
  });
});

describe('bounds', () => {
  it('clamps a nonsense interval rather than propagating it', () => {
    expect(at(0).intervalMs).toBe(MIN_INTERVAL_MS);
    expect(at(-5).intervalMs).toBe(MIN_INTERVAL_MS);
    expect(at(999_999).intervalMs).toBe(MAX_INTERVAL_MS);
  });

  it('never trusts a slope wider than an onset could survive', () => {
    for (const interval of [20, 137, 500, 3_600, 10_000]) {
      expect(at(interval).maxDtForRateMs).toBeLessThanOrEqual(ONSET_RESOLVABLE_MS);
    }
  });

  it('always asks for enough samples to be able to disagree', () => {
    // Two readings define exactly one arc, so they cannot evidence stillness
    // however far apart they are spread.
    for (const interval of [20, 137, 3_600, 10_000]) {
      expect(at(interval).armingFastMinSamples).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('estimating the rate', () => {
  it('says nothing until it has seen enough', () => {
    const est = new RateEstimator();
    expect(est.estimateMs()).toBeNull();
    est.push(100);
    est.push(100);
    expect(est.estimateMs()).toBeNull();
  });

  it('ignores dropped packets instead of reporting the tag as slow', () => {
    // THE bug this module was written to prevent, in miniature. Occasional gaps
    // are several times the true interval; a mean is dragged upward by exactly
    // those outliers and reports a healthy tag as a slow one.
    const est = new RateEstimator();
    for (let i = 0; i < 9; i += 1) est.push(140);
    est.push(1_400);
    est.push(2_800);

    expect(est.estimateMs()).toBe(140);
  });

  it('follows the tag when it genuinely slows down', () => {
    // A tag going idle is a real change, not an outlier, and the estimate has
    // to move with it once the slow readings are the majority.
    const est = new RateEstimator(11);
    for (let i = 0; i < 11; i += 1) est.push(140);
    expect(est.estimateMs()).toBe(140);

    for (let i = 0; i < 11; i += 1) est.push(2_300);
    expect(est.estimateMs()).toBe(2_300);
  });

  it('discards a clock jump rather than letting it poison the window', () => {
    const est = new RateEstimator();
    for (let i = 0; i < 5; i += 1) est.push(140);
    est.push(-1);
    est.push(0);
    est.push(Number.NaN);
    est.push(MAX_INTERVAL_MS * 10);

    expect(est.estimateMs()).toBe(140);
  });
});
