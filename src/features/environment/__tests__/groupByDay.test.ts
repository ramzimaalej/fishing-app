import type { EnvironmentSnapshot } from '@/types';

import { groupByDay } from '../grouping';

/** Minimal snapshot — only `time` and `fishActivity` matter to the grouping. */
function snap(time: string, fishActivity: number): EnvironmentSnapshot {
  return {
    time,
    pressure: 1013,
    temperature: 15,
    windSpeed: 3,
    windDirection: 180,
    waveHeight: 0,
    tide: null,
    moon: { illuminationFraction: 0.5, phase: 'first-quarter', name: 'First Quarter' },
    fishActivity,
  };
}

describe('groupByDay', () => {
  it('groups by the local date prefix of the ISO time', () => {
    const days = groupByDay([
      snap('2026-07-27T06:00', 0.4),
      snap('2026-07-27T18:00', 0.8),
      snap('2026-07-28T07:00', 0.6),
    ]);
    expect(days.map((d) => d.date)).toEqual(['2026-07-27', '2026-07-28']);
    expect(days[0]!.hours).toHaveLength(2);
    expect(days[1]!.hours).toHaveLength(1);
  });

  it('picks each day’s peak hour', () => {
    const days = groupByDay([
      snap('2026-07-27T06:00', 0.4),
      snap('2026-07-27T18:00', 0.81),
      snap('2026-07-27T12:00', 0.2),
    ]);
    expect(days[0]!.peak.time).toBe('2026-07-27T18:00');
    expect(days[0]!.peak.fishActivity).toBeCloseTo(0.81, 5);
  });

  it('averages activity across the day', () => {
    const days = groupByDay([snap('2026-07-27T06:00', 0.2), snap('2026-07-27T18:00', 0.6)]);
    expect(days[0]!.avgActivity).toBeCloseTo(0.4, 5);
  });

  it('returns days in chronological order even if input is shuffled', () => {
    const days = groupByDay([
      snap('2026-07-29T06:00', 0.4),
      snap('2026-07-27T06:00', 0.4),
      snap('2026-07-28T06:00', 0.4),
    ]);
    expect(days.map((d) => d.date)).toEqual(['2026-07-27', '2026-07-28', '2026-07-29']);
  });

  it('does not re-derive the day through Date (no UTC shift)', () => {
    // A late-evening local hour must stay on its own local day; parsing through
    // Date in a UTC-behind timezone would roll it forward.
    const days = groupByDay([snap('2026-07-27T23:00', 0.5)]);
    expect(days).toHaveLength(1);
    expect(days[0]!.date).toBe('2026-07-27');
  });

  it('handles an empty series', () => {
    expect(groupByDay([])).toEqual([]);
  });

  it('spans a month boundary correctly', () => {
    const days = groupByDay([snap('2026-07-31T20:00', 0.5), snap('2026-08-01T05:00', 0.7)]);
    expect(days.map((d) => d.date)).toEqual(['2026-07-31', '2026-08-01']);
  });
});
