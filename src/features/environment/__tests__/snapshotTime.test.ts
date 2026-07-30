import type { EnvironmentSnapshot } from '@/types';

import { instantOf, nearestHourIndex } from '../snapshotTime';

/** Minimal snapshot — only `time` and `utcOffsetSeconds` matter here. */
function hour(time: string, utcOffsetSeconds?: number): EnvironmentSnapshot {
  return {
    time,
    utcOffsetSeconds,
    pressure: 1013,
    temperature: 15,
    windSpeed: 3,
    windDirection: 180,
    waveHeight: 0,
    tide: null,
    moon: { illuminationFraction: 0.5, phase: 'first-quarter', name: 'First Quarter' },
    fishActivity: 0.5,
  };
}

const HOUR = 3_600_000;

describe('instantOf', () => {
  it('treats a zero offset as UTC', () => {
    expect(instantOf(hour('2026-07-30T14:00', 0))).toBe(Date.parse('2026-07-30T14:00Z'));
  });

  it('subtracts a positive offset — local 14:00 at UTC+1 is 13:00 UTC', () => {
    expect(instantOf(hour('2026-07-30T14:00', 3600))).toBe(Date.parse('2026-07-30T13:00Z'));
  });

  it('adds back a negative offset — local 14:00 at UTC-7 is 21:00 UTC', () => {
    expect(instantOf(hour('2026-07-30T14:00', -7 * 3600))).toBe(
      Date.parse('2026-07-30T21:00Z'),
    );
  });

  it('handles a half-hour zone', () => {
    // India is UTC+5:30 — offsets are not always whole hours.
    expect(instantOf(hour('2026-07-30T14:00', 5.5 * 3600))).toBe(
      Date.parse('2026-07-30T08:30Z'),
    );
  });

  it('falls back to device-local parsing when the offset is absent', () => {
    // Snapshots persisted before the field existed. Matches the old behaviour,
    // which is correct whenever the zones happen to agree.
    const t = '2026-07-30T14:00';
    expect(instantOf(hour(t))).toBe(new Date(t).getTime());
  });

  it('returns NaN for an unparseable time rather than a wrong instant', () => {
    expect(Number.isNaN(instantOf(hour('not-a-time', 0)))).toBe(true);
  });
});

describe('nearestHourIndex', () => {
  it('is -1 for an empty series', () => {
    expect(nearestHourIndex([])).toBe(-1);
  });

  it('picks the closest hour', () => {
    const series = [
      hour('2026-07-30T12:00', 0),
      hour('2026-07-30T13:00', 0),
      hour('2026-07-30T14:00', 0),
    ];
    expect(nearestHourIndex(series, Date.parse('2026-07-30T13:20Z'))).toBe(1);
    expect(nearestHourIndex(series, Date.parse('2026-07-30T13:40Z'))).toBe(2);
  });

  it('is correct for a location in a DIFFERENT timezone than the device', () => {
    // The bug this exists to prevent: pinning Bizerte (UTC+1) from a phone in
    // California. Naive parsing would have matched "now" hours off, so the
    // Conditions card showed the wrong part of the day.
    const tunis = [
      hour('2026-07-30T20:00', 3600),
      hour('2026-07-30T21:00', 3600),
      hour('2026-07-30T22:00', 3600),
    ];
    // 21:00 in Tunis is 20:00 UTC.
    expect(nearestHourIndex(tunis, Date.parse('2026-07-30T20:00Z'))).toBe(1);
  });

  it('agrees across zones for the same real instant', () => {
    const instant = Date.parse('2026-07-30T12:00Z');
    // The same moment, expressed in three different local clocks.
    const utc = [hour('2026-07-30T12:00', 0)];
    const plusOne = [hour('2026-07-30T13:00', 3600)];
    const minusSeven = [hour('2026-07-30T05:00', -7 * 3600)];
    for (const series of [utc, plusOne, minusSeven]) {
      expect(instantOf(series[0]!)).toBe(instant);
      expect(nearestHourIndex(series, instant)).toBe(0);
    }
  });

  it('skips unparseable entries instead of selecting them', () => {
    const series = [hour('bad', 0), hour('2026-07-30T12:00', 0)];
    expect(nearestHourIndex(series, Date.parse('2026-07-30T12:00Z'))).toBe(1);
  });

  it('picks an end when now is outside the series', () => {
    const series = [hour('2026-07-30T12:00', 0), hour('2026-07-30T13:00', 0)];
    expect(nearestHourIndex(series, Date.parse('2026-07-30T12:00Z') - 100 * HOUR)).toBe(0);
    expect(nearestHourIndex(series, Date.parse('2026-07-30T13:00Z') + 100 * HOUR)).toBe(1);
  });
});
