import type { CaptureEvent } from '../captureTypes';
import { DEFAULT_MATCH_OPTIONS, formatRate, matchEvents } from '../matching';

const detection = (at: number, rodId = 'rod_a'): CaptureEvent => ({
  kind: 'detection',
  at,
  deviceT: at,
  rodId,
  rodName: rodId,
  size: 'small',
  peakMagnitude: 0.5,
  confidence: 0.8,
  threshold: 0.2,
});

const mark = (at: number, rodId = 'rod_a'): CaptureEvent => ({
  kind: 'fish',
  at,
  deviceT: at,
  rodId,
  rodName: rodId,
});

describe('matchEvents', () => {
  it('pairs a detection that precedes the human mark by less than preMs', () => {
    // The normal case: algorithm fires, angler reacts 1.2s later.
    const result = matchEvents([detection(10_000), mark(11_200)]);

    expect(result.truePositives).toHaveLength(1);
    expect(result.falsePositives).toHaveLength(0);
    expect(result.falseNegatives).toHaveLength(0);
    expect(result.truePositives[0]!.deltaMs).toBe(-1200);
    expect(result.precision).toBe(1);
    expect(result.recall).toBe(1);
    expect(result.f1).toBe(1);
    expect(result.meanDeltaMs).toBe(-1200);
  });

  it('pairs a detection that follows the mark, within the tighter postMs bound', () => {
    // The angler anticipated the strike and pressed early.
    const result = matchEvents([detection(11_000), mark(10_000)]);
    expect(result.truePositives).toHaveLength(1);
    expect(result.truePositives[0]!.deltaMs).toBe(1000);
  });

  it('does not pair a detection that follows the mark by more than postMs', () => {
    // postMs is deliberately tight; 2s after the press is a different event.
    expect(DEFAULT_MATCH_OPTIONS.postMs).toBeLessThan(2000);
    const result = matchEvents([detection(12_000), mark(10_000)]);

    expect(result.truePositives).toHaveLength(0);
    expect(result.falsePositives).toHaveLength(1);
    expect(result.falseNegatives).toHaveLength(1);
    expect(result.precision).toBe(0);
    expect(result.recall).toBe(0);
    expect(result.f1).toBeNull();
  });

  it('counts an unmatched detection as a false positive', () => {
    const result = matchEvents([detection(1_000)]);
    expect(result.falsePositives).toHaveLength(1);
    expect(result.precision).toBe(0);
    // Nothing to be measured against, which is not the same as zero recall.
    expect(result.recall).toBeNull();
  });

  it('counts an unmatched human mark as a miss', () => {
    const result = matchEvents([mark(1_000)]);
    expect(result.falseNegatives).toHaveLength(1);
    expect(result.recall).toBe(0);
    expect(result.precision).toBeNull();
  });

  it('reports precision as null rather than perfect when nothing fired', () => {
    // A detector that never fires must not score 100% precision.
    expect(matchEvents([]).precision).toBeNull();
  });

  it('gives a contested mark to the nearest detection and fails the other', () => {
    // Both are inside the window; only one can be the bite the angler saw.
    const near = detection(10_800);
    const far = detection(8_500);
    const result = matchEvents([far, near, mark(11_000)]);

    expect(result.truePositives).toHaveLength(1);
    expect(result.truePositives[0]!.detection.at).toBe(10_800);
    expect(result.falsePositives).toHaveLength(1);
    expect(result.falsePositives[0]!.at).toBe(8_500);
  });

  it('is independent of input ordering', () => {
    const events = [detection(8_500), detection(10_800), mark(11_000), mark(20_000)];
    const forward = matchEvents(events);
    const reversed = matchEvents([...events].reverse());

    expect(reversed.truePositives.map((p) => p.detection.at)).toEqual(
      forward.truePositives.map((p) => p.detection.at),
    );
    expect(reversed.falsePositives.map((e) => e.at)).toEqual(
      forward.falsePositives.map((e) => e.at),
    );
  });

  it('does not credit one rod with a bite observed on another', () => {
    const result = matchEvents([detection(10_000, 'rod_a'), mark(10_500, 'rod_b')]);

    expect(result.truePositives).toHaveLength(0);
    expect(result.falsePositives).toHaveLength(1);
    expect(result.falseNegatives).toHaveLength(1);
  });

  it('pairs across rods when sameRodOnly is off', () => {
    const result = matchEvents([detection(10_000, 'rod_a'), mark(10_500, 'rod_b')], {
      sameRodOnly: false,
    });
    expect(result.truePositives).toHaveLength(1);
  });

  it('scores a realistic mixed session', () => {
    // 3 seen by the angler: two caught, one missed. Plus 2 spurious firings.
    const result = matchEvents([
      detection(1_000),
      mark(2_000), // paired with 1_000
      detection(5_000), // spurious
      detection(9_000),
      mark(10_000), // paired with 9_000
      mark(30_000), // missed entirely
      detection(50_000), // spurious
    ]);

    expect(result.truePositives).toHaveLength(2);
    expect(result.falsePositives).toHaveLength(2);
    expect(result.falseNegatives).toHaveLength(1);
    expect(result.precision).toBeCloseTo(2 / 4);
    expect(result.recall).toBeCloseTo(2 / 3);
  });

  it('respects a widened window', () => {
    const events = [detection(10_000), mark(20_000)];
    expect(matchEvents(events).truePositives).toHaveLength(0);
    expect(matchEvents(events, { preMs: 15_000 }).truePositives).toHaveLength(1);
  });
});

describe('formatRate', () => {
  it('renders a rate as a whole percentage', () => {
    expect(formatRate(0.666)).toBe('67%');
    expect(formatRate(1)).toBe('100%');
  });

  it('renders an undefined rate as a dash rather than zero', () => {
    expect(formatRate(null)).toBe('—');
  });
});
