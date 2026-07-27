import type { BiteEvent } from '@/types';

import {
  buildSessionSummary,
  formatDuration,
  HOT_WINDOW_MS,
  hottestWindow,
  type SessionBite,
  tallyByRod,
  timelineBuckets,
} from '../sessionSummary';

const T0 = new Date(2026, 5, 1, 6, 0, 0).getTime();
const MIN = 60_000;

let seq = 0;
function bite(
  atOffsetMinutes: number,
  overrides: Partial<BiteEvent> = {},
): SessionBite {
  seq += 1;
  return {
    at: T0 + atOffsetMinutes * MIN,
    event: {
      id: `b${seq}`,
      // Device-clock value: deliberately unrelated to `at`, which is what the
      // summary must use for anything time-based.
      timestamp: 999_000 + seq,
      size: 'small',
      peakMagnitude: 1,
      confidence: 0.5,
      ...overrides,
    },
  };
}

describe('hottestWindow', () => {
  it('is null with fewer than two bites', () => {
    expect(hottestWindow([])).toBeNull();
    expect(hottestWindow([bite(0)])).toBeNull();
  });

  it('finds the densest window', () => {
    // 3 bites inside 10 minutes, then a lone straggler two hours later.
    const bites = [bite(0), bite(4), bite(9), bite(120)];
    const w = hottestWindow(bites);
    expect(w).not.toBeNull();
    expect(w!.count).toBe(3);
    expect(w!.startAt).toBe(T0);
  });

  it('includes a bite exactly on the window boundary', () => {
    const bites = [bite(0), bite(HOT_WINDOW_MS / MIN)];
    expect(hottestWindow(bites)!.count).toBe(2);
  });

  it('excludes a bite one millisecond past the boundary', () => {
    const bites: SessionBite[] = [bite(0), bite(0)];
    bites[1]!.at = T0 + HOT_WINDOW_MS + 1;
    expect(hottestWindow(bites)).toBeNull();
  });

  it('reports nothing when every bite is isolated', () => {
    // Spaced an hour apart — no two share a 30-minute window.
    expect(hottestWindow([bite(0), bite(60), bite(120)])).toBeNull();
  });
});

describe('buildSessionSummary', () => {
  const base = { startedAt: T0, endedAt: T0 + 60 * MIN };

  it('summarises an empty session without dividing by zero', () => {
    const s = buildSessionSummary({ ...base, bites: [] });
    expect(s.totalBites).toBe(0);
    expect(s.avgConfidence).toBe(0);
    expect(s.biteRate).toBe(0);
    expect(s.strongest).toBeNull();
    expect(s.hottestWindow).toBeNull();
  });

  it('counts sizes and computes the hourly rate', () => {
    const s = buildSessionSummary({
      ...base,
      bites: [bite(1, { size: 'big' }), bite(2), bite(3)],
    });
    expect(s.totalBites).toBe(3);
    expect(s.bigBites).toBe(1);
    expect(s.smallBites).toBe(2);
    // 3 bites in exactly one hour.
    expect(s.biteRate).toBeCloseTo(3, 5);
    expect(s.durationSeconds).toBe(3600);
  });

  it('picks the strongest bite by peak magnitude', () => {
    const s = buildSessionSummary({
      ...base,
      bites: [bite(1, { peakMagnitude: 0.8 }), bite(2, { peakMagnitude: 3.1 }), bite(3, { peakMagnitude: 1.4 })],
    });
    expect(s.strongest!.event.peakMagnitude).toBe(3.1);
  });

  it('averages confidence', () => {
    const s = buildSessionSummary({
      ...base,
      bites: [bite(1, { confidence: 0.2 }), bite(2, { confidence: 0.8 })],
    });
    expect(s.avgConfidence).toBeCloseTo(0.5, 5);
  });

  it('sorts bites by capture time regardless of arrival order', () => {
    const s = buildSessionSummary({ ...base, bites: [bite(30), bite(5), bite(20)] });
    const times = s.bites.map((b) => b.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('never reports a negative duration for an inverted session', () => {
    const s = buildSessionSummary({ startedAt: T0, endedAt: T0 - 1000, bites: [] });
    expect(s.durationSeconds).toBe(0);
  });

  it('carries conditions through, defaulting to null', () => {
    expect(buildSessionSummary({ ...base, bites: [] }).conditions).toBeNull();
    const withCond = buildSessionSummary({ ...base, bites: [], conditions: { pressure: 1011 } });
    expect(withCond.conditions).toEqual({ pressure: 1011 });
  });
});

describe('timelineBuckets', () => {
  const base = { startedAt: T0, endedAt: T0 + 60 * MIN };

  it('returns exactly the requested number of buckets', () => {
    const s = buildSessionSummary({ ...base, bites: [bite(5)] });
    expect(timelineBuckets(s, 12)).toHaveLength(12);
  });

  it('distributes bites into the right buckets', () => {
    // 60-minute session, 6 buckets → 10 minutes each.
    const s = buildSessionSummary({ ...base, bites: [bite(0), bite(5), bite(25), bite(55)] });
    expect(timelineBuckets(s, 6)).toEqual([2, 0, 1, 0, 0, 1]);
  });

  it('clamps a bite at the exact end into the last bucket', () => {
    const s = buildSessionSummary({ ...base, bites: [bite(60)] });
    const buckets = timelineBuckets(s, 6);
    expect(buckets[5]).toBe(1);
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('returns all zeros for a zero-length session', () => {
    const s = buildSessionSummary({ startedAt: T0, endedAt: T0, bites: [bite(0)] });
    expect(timelineBuckets(s, 4)).toEqual([0, 0, 0, 0]);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [45, '45s'],
    [59, '59s'],
    [60, '1m'],
    [125, '2m'],
    [3600, '1h'],
    [5040, '1h 24m'],
    [7200, '2h'],
  ])('formats %is as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it('never renders a negative duration', () => {
    expect(formatDuration(-10)).toBe('0s');
  });
});

describe('tallyByRod', () => {
  const withRod = (offset: number, rodId: string, rodName: string, peak = 1): SessionBite => ({
    ...bite(offset, { peakMagnitude: peak }),
    rodId,
    rodName,
  });

  it('groups bites per rod, busiest first', () => {
    const tallies = tallyByRod([
      withRod(1, 'a', 'Left rod'),
      withRod(2, 'b', 'Right rod'),
      withRod(3, 'a', 'Left rod'),
      withRod(4, 'a', 'Left rod'),
    ]);
    expect(tallies.map((t) => [t.rodId, t.bites])).toEqual([
      ['a', 3],
      ['b', 1],
    ]);
  });

  it('keeps each rod’s hardest strike', () => {
    const tallies = tallyByRod([
      withRod(1, 'a', 'Left rod', 0.4),
      withRod(2, 'a', 'Left rod', 2.7),
      withRod(3, 'a', 'Left rod', 1.1),
    ]);
    expect(tallies[0]!.peakMagnitude).toBeCloseTo(2.7, 5);
  });

  it('skips bites with no rod attribution rather than inventing a rod', () => {
    // Single-rod sessions and pre-multi-rod records carry no rodId; an
    // "unknown rod" row in the report would be worse than no breakdown.
    expect(tallyByRod([bite(1), bite(2)])).toEqual([]);
  });

  it('uses the name captured at bite time, not a current lookup', () => {
    const tallies = tallyByRod([withRod(1, 'a', 'Old name')]);
    expect(tallies[0]!.rodName).toBe('Old name');
  });

  it('falls back to the id when a name is missing', () => {
    const b: SessionBite = { ...bite(1), rodId: 'a' };
    expect(tallyByRod([b])[0]!.rodName).toBe('a');
  });

  it('is empty for no bites', () => {
    expect(tallyByRod([])).toEqual([]);
  });
});

describe('buildSessionSummary — rod breakdown', () => {
  it('exposes perRod for a multi-rod session', () => {
    const s = buildSessionSummary({
      startedAt: T0,
      endedAt: T0 + 60 * MIN,
      bites: [
        { ...bite(1), rodId: 'a', rodName: 'Left' },
        { ...bite(2), rodId: 'b', rodName: 'Right' },
        { ...bite(3), rodId: 'a', rodName: 'Left' },
      ],
    });
    expect(s.perRod).toHaveLength(2);
    expect(s.perRod[0]).toMatchObject({ rodId: 'a', bites: 2 });
    expect(s.totalBites).toBe(3);
  });

  it('leaves perRod empty for an unattributed session', () => {
    const s = buildSessionSummary({
      startedAt: T0,
      endedAt: T0 + 60 * MIN,
      bites: [bite(1), bite(2)],
    });
    expect(s.perRod).toEqual([]);
  });
});
