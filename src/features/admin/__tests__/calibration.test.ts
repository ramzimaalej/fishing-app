import { calibrate, labelCrossings } from '../calibration';
import type { CaptureEvent } from '../captureTypes';
import { matchEvents } from '../matching';
import { migrateEvents } from '../recordingsRepo';

const crossing = (
  at: number,
  onsetRateDegPerS: number | null,
  rodId = 'rod_a',
): CaptureEvent => ({ kind: 'crossing', at, deviceT: at, rodId, rodName: rodId, onsetRateDegPerS });

const mark = (at: number, kind: 'fish' | 'wave', rodId = 'rod_a'): CaptureEvent => ({
  kind,
  at,
  deviceT: at,
  rodId,
  rodName: rodId,
});

/** n crossings just before their label, as the operator's reaction lag implies. */
function labelled(kind: 'fish' | 'wave', rates: number[], base = 100_000): CaptureEvent[] {
  return rates.flatMap((rate, i) => {
    const at = base + i * 20_000;
    return [crossing(at, rate), mark(at + 1200, kind)];
  });
}

describe('labelCrossings', () => {
  it('attaches the label the operator pressed just after the crossing', () => {
    const result = labelCrossings([crossing(10_000, 40), mark(11_200, 'fish')]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ label: 'fish', onsetRateDegPerS: 40 });
  });

  it('drops a crossing whose onset rate could not be measured', () => {
    // Unmeasurable is UNKNOWN, not slow. Counting it as 0 would drag the fish
    // distribution down and manufacture overlap that is not in the data.
    const result = labelCrossings([crossing(10_000, null), mark(11_200, 'fish')]);
    expect(result).toHaveLength(0);
  });

  it('drops an unlabelled crossing rather than assuming it was a wave', () => {
    // "The operator was not watching" is not evidence about the cause.
    expect(labelCrossings([crossing(10_000, 40)])).toHaveLength(0);
  });

  it('gives a crossing to the nearer of two labels', () => {
    const result = labelCrossings([
      crossing(10_000, 40),
      mark(10_300, 'fish'),
      mark(11_400, 'wave'),
    ]);
    expect(result[0]!.label).toBe('fish');
  });

  it('does not label across rods', () => {
    expect(
      labelCrossings([crossing(10_000, 40, 'rod_a'), mark(10_500, 'fish', 'rod_b')]),
    ).toHaveLength(0);
  });

  it('ignores a label too far from the crossing to be about it', () => {
    expect(labelCrossings([crossing(10_000, 40), mark(60_000, 'fish')])).toHaveLength(0);
  });
});

describe('calibrate', () => {
  it('suggests a threshold that separates well-separated classes', () => {
    const events = [
      ...labelled('fish', [40, 45, 50, 55, 60], 100_000),
      ...labelled('wave', [5, 6, 7, 8, 9], 500_000),
    ];
    const result = calibrate(events);

    expect(result.fish!.count).toBe(5);
    expect(result.wave!.count).toBe(5);
    expect(result.overlapping).toBe(false);
    expect(result.separation).toBe(1);
    // Any value in the gap separates them; it must sit above the waves.
    expect(result.suggestedThreshold).toBeGreaterThan(9);
    expect(result.suggestedThreshold).toBeLessThanOrEqual(40);
    expect(result.verdict).toContain('Suggested');
  });

  it('reports overlap honestly instead of picking a least-bad threshold', () => {
    // The failure the spec insists on surfacing: at ~10 Hz the sensor, not the
    // setting, is the limit. Tuning into a precise-looking number here is how
    // someone ends up trusting an alarm that is guessing.
    const events = [
      ...labelled('fish', [20, 22, 25, 28, 30], 100_000),
      ...labelled('wave', [19, 23, 26, 27, 31], 500_000),
    ];
    const result = calibrate(events);

    expect(result.overlapping).toBe(true);
    expect(result.separation).toBeLessThan(0.6);
    expect(result.verdict).toMatch(/OVERLAP/);
    expect(result.verdict).toMatch(/sensor is the limit/);
  });

  it('refuses to conclude anything from too few labelled events', () => {
    const events = [...labelled('fish', [40, 45], 100_000), ...labelled('wave', [5], 500_000)];
    const result = calibrate(events);
    expect(result.verdict).toMatch(/Not enough labelled events/);
  });

  it('says so when nothing has been labelled at all', () => {
    expect(calibrate([]).verdict).toMatch(/No labelled events/);
    expect(calibrate([]).suggestedThreshold).toBeNull();
  });

  it('counts unmeasurable crossings separately rather than hiding them', () => {
    // Worth surfacing: many unmeasurable onsets means packets are being dropped
    // on the rising edges, which is a signal-quality problem, not a tuning one.
    const events = [
      ...labelled('fish', [40, 45, 50, 55, 60], 100_000),
      ...labelled('wave', [5, 6, 7, 8, 9], 500_000),
      crossing(900_000, null),
      crossing(920_000, null),
    ];
    expect(calibrate(events).unmeasurable).toBe(2);
  });

  it('reports no threshold when only one class was labelled', () => {
    const result = calibrate(labelled('fish', [40, 45, 50, 55, 60]));
    expect(result.suggestedThreshold).toBeNull();
    expect(result.wave).toBeNull();
  });

  it('describes each distribution with robust percentiles', () => {
    const result = calibrate([
      ...labelled('fish', [10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 100_000),
      ...labelled('wave', [1, 2, 3, 4, 5], 900_000),
    ]);
    expect(result.fish!.min).toBe(10);
    expect(result.fish!.max).toBe(100);
    expect(result.fish!.median).toBe(60);
  });
});

describe('legacy recordings', () => {
  it('reads a schema-1 "human" mark as a fish', () => {
    // Without this, an old recording's marks match neither kind and vanish from
    // scoring — the session lists, shows samples, and reports zero hits and zero
    // misses, which reads as "the detector found nothing" rather than "old file".
    const migrated = migrateEvents([
      { kind: 'human' as never, at: 1000, deviceT: 1000, rodId: 'r', rodName: 'r' },
      { kind: 'detection', at: 900, deviceT: 900, rodId: 'r', rodName: 'r' },
    ]);

    expect(migrated[0]!.kind).toBe('fish');
    expect(migrated[1]!.kind).toBe('detection');
    expect(matchEvents(migrated).truePositives).toHaveLength(1);
  });

  it('leaves current kinds untouched', () => {
    const events: CaptureEvent[] = [
      { kind: 'wave', at: 1, deviceT: 1, rodId: 'r', rodName: 'r' },
      { kind: 'crossing', at: 2, deviceT: 2, rodId: 'r', rodName: 'r', onsetRateDegPerS: 30 },
    ];
    expect(migrateEvents(events).map((e) => e.kind)).toEqual(['wave', 'crossing']);
  });
});
