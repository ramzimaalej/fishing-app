import {
  KEEPALIVE_AFTER_SILENT_MS,
  KEEPALIVE_MAX_INTERVAL_MS,
  KEEPALIVE_MIN_INTERVAL_MS,
  KEEPALIVE_WOKE_WITHIN_MS,
  TagKeepAlive,
} from '../tagKeepAlive';

const T0 = 100_000;

/** Inputs for a tag that has been silent for `silentMs`. */
const silent = (silentMs: number, over: Partial<Parameters<TagKeepAlive['shouldWake']>[0]> = {}) => ({
  nowMs: T0 + silentMs,
  lastHeardMs: T0,
  watchingSinceMs: T0,
  alerting: false,
  ...over,
});

describe('when a quiet tag is worth waking', () => {
  it('leaves a working stream alone', () => {
    // This tag advertises every ~3.6 s, so a few seconds of quiet is normal.
    // Connecting stops the tag advertising, so acting on ordinary sparseness
    // would break the very stream it is meant to restore.
    const ka = new TagKeepAlive();
    expect(ka.shouldWake(silent(KEEPALIVE_AFTER_SILENT_MS - 1_000))).toBe(false);
  });

  it('acts once the silence passes the signal-lost bar', () => {
    const ka = new TagKeepAlive();
    expect(ka.shouldWake(silent(KEEPALIVE_AFTER_SILENT_MS + 1_000))).toBe(true);
  });

  it('reaches a tag that was already asleep before the rod was armed', () => {
    // lastHeardMs null is the common case on a tag left idle: it was asleep
    // before watching began, so there is no "last heard" to measure from. Timing
    // off watchingSinceMs is what makes the mechanism work at all here, rather
    // than only for tags that had already been talking.
    const ka = new TagKeepAlive();
    expect(
      ka.shouldWake({
        nowMs: T0 + KEEPALIVE_AFTER_SILENT_MS + 1_000,
        lastHeardMs: null,
        watchingSinceMs: T0,
        alerting: false,
      }),
    ).toBe(true);
  });

  it('never interrupts a live alert', () => {
    // A connection silences the advertisement stream. Doing that while a fish is
    // on trades the thing the app exists for against a tag that might be dozing.
    const ka = new TagKeepAlive();
    expect(ka.shouldWake(silent(KEEPALIVE_AFTER_SILENT_MS + 60_000, { alerting: true }))).toBe(
      false,
    );
  });

  it('does not open a second connection while one is in flight', () => {
    const ka = new TagKeepAlive();
    ka.begin(T0);
    expect(ka.shouldWake(silent(KEEPALIVE_AFTER_SILENT_MS + 60_000))).toBe(false);
  });
});

describe('how often it tries', () => {
  it('waits out the interval between attempts', () => {
    const ka = new TagKeepAlive();
    const start = T0 + KEEPALIVE_AFTER_SILENT_MS + 1_000;
    ka.begin(start);
    ka.end(true);

    expect(ka.shouldWake({ ...silent(0), nowMs: start + KEEPALIVE_MIN_INTERVAL_MS - 1_000 })).toBe(
      false,
    );
    expect(ka.shouldWake({ ...silent(0), nowMs: start + KEEPALIVE_MIN_INTERVAL_MS + 1_000 })).toBe(
      true,
    );
  });

  it('backs off on a tag it cannot reach, and stops at a ceiling', () => {
    // A tag left at home is unreachable for ever. Retrying it every minute all
    // day would spend the phone's battery on a certainty.
    const ka = new TagKeepAlive();
    let t = T0 + KEEPALIVE_AFTER_SILENT_MS;

    for (let i = 0; i < 12; i += 1) {
      ka.begin(t);
      ka.end(false);
      t += KEEPALIVE_MAX_INTERVAL_MS;
    }

    expect(ka.stats().intervalMs).toBe(KEEPALIVE_MAX_INTERVAL_MS);
  });

  it('returns to the short interval once a tag answers', () => {
    const ka = new TagKeepAlive();
    ka.begin(T0);
    ka.end(false);
    expect(ka.stats().intervalMs).toBeGreaterThan(KEEPALIVE_MIN_INTERVAL_MS);

    ka.begin(T0 + 600_000);
    ka.end(true);
    ka.noteHeard(T0 + 600_000 + 5_000);

    expect(ka.stats().intervalMs).toBe(KEEPALIVE_MIN_INTERVAL_MS);
  });
});

describe('scoring whether this actually works', () => {
  it('counts an attempt as a wake only when the tag then speaks', () => {
    // The whole point of the counters. Nothing captured says connecting makes
    // this tag resume broadcasting, so attempts and wakes are recorded
    // separately and a bench session decides it on evidence.
    const ka = new TagKeepAlive();
    ka.begin(T0);
    ka.end(true);
    ka.noteHeard(T0 + 5_000);

    expect(ka.stats()).toMatchObject({ attempts: 1, wakes: 1 });
  });

  it('does not credit an advertisement that arrives far too late', () => {
    const ka = new TagKeepAlive();
    ka.begin(T0);
    ka.end(true);
    ka.noteHeard(T0 + KEEPALIVE_WOKE_WITHIN_MS + 10_000);

    expect(ka.stats()).toMatchObject({ attempts: 1, wakes: 0 });
  });

  it('credits one attempt at most, however much the tag then says', () => {
    const ka = new TagKeepAlive();
    ka.begin(T0);
    ka.end(true);
    ka.noteHeard(T0 + 4_000);
    ka.noteHeard(T0 + 8_000);
    ka.noteHeard(T0 + 12_000);

    expect(ka.stats()).toMatchObject({ attempts: 1, wakes: 1 });
  });

  it('credits nothing when the connection never landed', () => {
    const ka = new TagKeepAlive();
    ka.begin(T0);
    ka.end(false);
    ka.noteHeard(T0 + 2_000);

    expect(ka.stats()).toMatchObject({ attempts: 1, wakes: 0 });
  });
});

describe('a rod that has just lost its tag', () => {
  it('retries at once instead of waiting out a backoff', () => {
    // The ordinary cadence is built for a tag nobody is waiting on. A rod that
    // is armed and has just gone silent is the opposite case: the angler
    // believes it is being watched, and an unreachable tag may already have
    // backed the schedule off to ten minutes.
    const ka = new TagKeepAlive();
    for (let i = 0; i < 12; i += 1) {
      ka.begin(T0 + i * KEEPALIVE_MAX_INTERVAL_MS);
      ka.end(false);
    }
    expect(ka.stats().intervalMs).toBe(KEEPALIVE_MAX_INTERVAL_MS);

    // A minute after the last attempt — well INSIDE the ten-minute backoff, so
    // the schedule alone would refuse. Picking a time past the backoff would
    // have made this pass without urgeNow existing at all.
    const insideBackoff = T0 + 11 * KEEPALIVE_MAX_INTERVAL_MS + 60_000;
    expect(ka.shouldWake({ ...silent(0), nowMs: insideBackoff })).toBe(false);

    ka.urgeNow();

    expect(ka.stats().intervalMs).toBe(KEEPALIVE_MIN_INTERVAL_MS);
    expect(ka.shouldWake({ ...silent(0), nowMs: insideBackoff })).toBe(true);
  });

  it('still refuses to interrupt a live alert', () => {
    // Urgency does not override the one rule that outranks it: a connection
    // silences the advertisement stream, and a fish on the line beats a tag
    // that might be dozing.
    const ka = new TagKeepAlive();
    ka.urgeNow();
    expect(ka.shouldWake(silent(KEEPALIVE_AFTER_SILENT_MS + 1_000, { alerting: true }))).toBe(
      false,
    );
  });

  it('still refuses while a connection is already open', () => {
    const ka = new TagKeepAlive();
    ka.begin(T0);
    ka.urgeNow();
    expect(ka.shouldWake(silent(KEEPALIVE_AFTER_SILENT_MS + 1_000))).toBe(false);
  });
});

