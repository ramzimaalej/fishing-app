import type { BiteRecord, EnvironmentSnapshot, TidePoint } from '@/types';

import {
  analyseCatches,
  matchBitesToHours,
  MIN_BUCKET_BITES,
  MIN_SAMPLE,
} from '../catchInsights';

const HOUR_MS = 3_600_000;

/** Local ISO string with no offset, exactly as Open-Meteo returns it. */
function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`;
}

const START = new Date(2026, 0, 1, 0, 0, 0);

interface HourOpts {
  pressureTrend?: number;
  temperature?: number;
  windSpeed?: number;
  tide?: TidePoint | null;
  moonName?: string;
}

/** An hourly snapshot `index` hours after START. */
function hour(index: number, opts: HourOpts = {}): EnvironmentSnapshot {
  const when = new Date(START.getTime() + index * HOUR_MS);
  return {
    time: localIso(when),
    pressure: 1013,
    pressureTrend: opts.pressureTrend ?? 0,
    temperature: opts.temperature ?? 12,
    windSpeed: opts.windSpeed ?? 3,
    windDirection: 180,
    waveHeight: 0,
    tide: opts.tide ?? null,
    moon: {
      illuminationFraction: 0.5,
      phase: 'first-quarter',
      name: opts.moonName ?? 'First Quarter',
    },
    fishActivity: 0.5,
  };
}

/** A bite landing inside hour `index`. */
function biteAt(index: number, id = `b${index}`): BiteRecord {
  const when = new Date(START.getTime() + index * HOUR_MS);
  return {
    id,
    userId: 'u1',
    // Mid-hour, to prove matching truncates rather than rounds.
    timestamp: when.getTime() + 37 * 60_000,
    size: 'small',
    peakMagnitude: 1,
    confidence: 0.5,
  };
}

describe('matchBitesToHours', () => {
  const series = [hour(0), hour(1), hour(2)];

  it('matches a bite to the hour containing it', () => {
    const { matched, excluded } = matchBitesToHours([biteAt(1)], series);
    expect(excluded).toBe(0);
    expect(matched).toHaveLength(1);
    expect(matched[0]!.hour.time).toBe(series[1]!.time);
  });

  it('excludes bites outside the series rather than snapping to an edge', () => {
    const { matched, excluded } = matchBitesToHours([biteAt(99)], series);
    expect(matched).toHaveLength(0);
    expect(excluded).toBe(1);
  });

  it('excludes everything when the series is empty', () => {
    const { matched, excluded } = matchBitesToHours([biteAt(0), biteAt(1)], []);
    expect(matched).toHaveLength(0);
    expect(excluded).toBe(2);
  });

  it('handles an empty bite list', () => {
    expect(matchBitesToHours([], series)).toEqual({ matched: [], excluded: 0 });
  });

  it('matches many bites within the same hour', () => {
    const bites = [biteAt(1, 'a'), biteAt(1, 'b'), biteAt(1, 'c')];
    expect(matchBitesToHours(bites, series).matched).toHaveLength(3);
  });
});

describe('analyseCatches — sample size gate', () => {
  it('reports insufficient below MIN_SAMPLE and emits no dimensions', () => {
    const series = Array.from({ length: 50 }, (_, i) => hour(i));
    const bites = Array.from({ length: MIN_SAMPLE - 1 }, (_, i) => biteAt(i));
    const out = analyseCatches(bites, series);
    expect(out.sufficient).toBe(false);
    expect(out.matched).toBe(MIN_SAMPLE - 1);
    expect(out.dimensions).toEqual([]);
    expect(out.headline).toBeNull();
  });

  it('becomes sufficient at exactly MIN_SAMPLE', () => {
    const series = Array.from({ length: 50 }, (_, i) => hour(i));
    const bites = Array.from({ length: MIN_SAMPLE }, (_, i) => biteAt(i));
    expect(analyseCatches(bites, series).sufficient).toBe(true);
  });

  it('counts unmatched bites as excluded', () => {
    const series = Array.from({ length: 20 }, (_, i) => hour(i));
    const bites = [...Array.from({ length: 12 }, (_, i) => biteAt(i)), biteAt(500, 'far')];
    const out = analyseCatches(bites, series);
    expect(out.matched).toBe(12);
    expect(out.excluded).toBe(1);
  });
});

describe('analyseCatches — lift', () => {
  /**
   * 100 hours: 20 falling-fast, 80 steady. All 20 bites land in falling-fast
   * hours. So biteShare = 1.0, hourShare = 0.2 → lift = 5.0, and steady scores 0.
   */
  function skewedFixture() {
    const series: EnvironmentSnapshot[] = [];
    for (let i = 0; i < 20; i++) series.push(hour(i, { pressureTrend: -0.8 }));
    for (let i = 20; i < 100; i++) series.push(hour(i, { pressureTrend: 0 }));
    const bites = Array.from({ length: 20 }, (_, i) => biteAt(i));
    return { series, bites };
  }

  it('computes lift as biteShare / hourShare', () => {
    const { series, bites } = skewedFixture();
    const out = analyseCatches(bites, series);
    const dim = out.dimensions.find((d) => d.key === 'pressureTrend')!;

    const falling = dim.buckets.find((b) => b.label === 'Falling fast')!;
    expect(falling.bites).toBe(20);
    expect(falling.hours).toBe(20);
    expect(falling.biteShare).toBeCloseTo(1, 5);
    expect(falling.hourShare).toBeCloseTo(0.2, 5);
    expect(falling.lift).toBeCloseTo(5, 5);

    const steady = dim.buckets.find((b) => b.label === 'Steady')!;
    expect(steady.bites).toBe(0);
    expect(steady.lift).toBe(0);
  });

  it('names the highest-lift bucket as best', () => {
    const { series, bites } = skewedFixture();
    const dim = analyseCatches(bites, series).dimensions.find((d) => d.key === 'pressureTrend')!;
    expect(dim.best?.label).toBe('Falling fast');
  });

  it('reports lift ≈ 1 when catches merely track opportunity', () => {
    // 50/50 hours, and bites split 50/50 too → no signal in either bucket.
    const series: EnvironmentSnapshot[] = [];
    for (let i = 0; i < 50; i++) series.push(hour(i, { pressureTrend: -0.8 }));
    for (let i = 50; i < 100; i++) series.push(hour(i, { pressureTrend: 0 }));
    const bites = [
      ...Array.from({ length: 10 }, (_, i) => biteAt(i, `f${i}`)),
      ...Array.from({ length: 10 }, (_, i) => biteAt(50 + i, `s${i}`)),
    ];
    const dim = analyseCatches(bites, series).dimensions.find((d) => d.key === 'pressureTrend')!;
    for (const b of dim.buckets) expect(b.lift).toBeCloseTo(1, 5);
    // Nothing beats chance, so nothing is recommended.
    expect(dim.best).toBeNull();
  });

  it('refuses to call a bucket best below MIN_BUCKET_BITES', () => {
    // One rare hour with a single bite would otherwise show enormous lift.
    const series: EnvironmentSnapshot[] = [hour(0, { pressureTrend: -0.8 })];
    for (let i = 1; i < 100; i++) series.push(hour(i, { pressureTrend: 0 }));
    const bites = [
      biteAt(0, 'lucky'),
      ...Array.from({ length: 14 }, (_, i) => biteAt(i + 1, `s${i}`)),
    ];
    const dim = analyseCatches(bites, series).dimensions.find((d) => d.key === 'pressureTrend')!;
    const rare = dim.buckets.find((b) => b.label === 'Falling fast')!;
    expect(rare.bites).toBeLessThan(MIN_BUCKET_BITES);
    expect(rare.lift).toBeGreaterThan(1);
    expect(dim.best).toBeNull();
  });
});

describe('analyseCatches — dimension hygiene', () => {
  it('omits dimensions with fewer than two occupied buckets', () => {
    // Hold every weather variable constant → those dimensions collapse to a
    // single bucket and are dropped. Time of day is necessarily NOT constant
    // (the series advances an hour at a time), so it legitimately survives.
    const series = Array.from({ length: 60 }, (_, i) => hour(i));
    const bites = Array.from({ length: 20 }, (_, i) => biteAt(i));
    const out = analyseCatches(bites, series);

    expect(out.dimensions.map((d) => d.key)).toEqual(['timeOfDay']);
    for (const key of ['pressureTrend', 'temperature', 'wind', 'moon', 'tide'] as const) {
      expect(out.dimensions.some((d) => d.key === key)).toBe(false);
    }
  });

  it('omits a dimension whose data is entirely absent', () => {
    // tide is null on every hour → no tide dimension at all.
    const series: EnvironmentSnapshot[] = [];
    for (let i = 0; i < 50; i++) series.push(hour(i, { temperature: i % 2 === 0 ? 3 : 22 }));
    const bites = Array.from({ length: 20 }, (_, i) => biteAt(i));
    const out = analyseCatches(bites, series);
    expect(out.dimensions.some((d) => d.key === 'tide')).toBe(false);
    expect(out.dimensions.some((d) => d.key === 'temperature')).toBe(true);
  });

  it('includes tide when the series carries it', () => {
    const rising: TidePoint = { time: '', height: 1, state: 'rising' };
    const low: TidePoint = { time: '', height: 0, state: 'low' };
    const series: EnvironmentSnapshot[] = [];
    for (let i = 0; i < 50; i++) series.push(hour(i, { tide: i % 2 === 0 ? rising : low }));
    const bites = Array.from({ length: 20 }, (_, i) => biteAt(i * 2));
    const dim = analyseCatches(bites, series).dimensions.find((d) => d.key === 'tide');
    expect(dim).toBeDefined();
    expect(dim!.best?.label).toBe('rising');
  });

  it('excludes hours with an unknown pressure trend rather than counting them steady', () => {
    // Half the series has no trend at all; it must not inflate "Steady".
    const series: EnvironmentSnapshot[] = [];
    for (let i = 0; i < 40; i++) {
      const h = hour(i, { pressureTrend: -0.8 });
      if (i >= 20) delete h.pressureTrend;
      series.push(h);
    }
    const bites = Array.from({ length: 20 }, (_, i) => biteAt(i));
    const out = analyseCatches(bites, series);
    const dim = out.dimensions.find((d) => d.key === 'pressureTrend');
    // Only one trend bucket is populated, so the dimension is dropped entirely
    // — and critically, no phantom "Steady" bucket was invented.
    expect(dim?.buckets.some((b) => b.label === 'Steady')).not.toBe(true);
  });

  it('reports background hours', () => {
    const series = Array.from({ length: 37 }, (_, i) => hour(i, { temperature: i % 2 ? 3 : 22 }));
    const bites = Array.from({ length: 20 }, (_, i) => biteAt(i));
    expect(analyseCatches(bites, series).backgroundHours).toBe(37);
  });
});

describe('analyseCatches — headline', () => {
  it('quotes the strongest dimension', () => {
    const series: EnvironmentSnapshot[] = [];
    for (let i = 0; i < 20; i++) series.push(hour(i, { pressureTrend: -0.8, temperature: 12 }));
    for (let i = 20; i < 100; i++) series.push(hour(i, { pressureTrend: 0, temperature: 22 }));
    const bites = Array.from({ length: 20 }, (_, i) => biteAt(i));
    const headline = analyseCatches(bites, series).headline;
    expect(headline).toContain('Falling fast');
    expect(headline).toMatch(/more often than chance/);
  });

  it('recommends nothing in a dimension where catches only track opportunity', () => {
    // Temperature is split 50/50 across hours and bites land 50/50 across it,
    // so temperature carries no signal and must not be recommended. (The
    // headline itself can still come from time of day, which these bites do
    // cluster in — that clustering is real and reporting it is correct.)
    const series: EnvironmentSnapshot[] = [];
    for (let i = 0; i < 50; i++) series.push(hour(i, { temperature: 3 }));
    for (let i = 50; i < 100; i++) series.push(hour(i, { temperature: 22 }));
    const bites = [
      ...Array.from({ length: 10 }, (_, i) => biteAt(i, `a${i}`)),
      ...Array.from({ length: 10 }, (_, i) => biteAt(50 + i, `b${i}`)),
    ];
    const dim = analyseCatches(bites, series).dimensions.find((d) => d.key === 'temperature')!;
    expect(dim.best).toBeNull();
    for (const b of dim.buckets) expect(b.lift).toBeCloseTo(1, 5);
  });

  it('is null when there are no qualifying dimensions at all', () => {
    // Below MIN_SAMPLE nothing is computed, so there is nothing to headline.
    const series = Array.from({ length: 50 }, (_, i) => hour(i));
    const bites = Array.from({ length: MIN_SAMPLE - 1 }, (_, i) => biteAt(i));
    expect(analyseCatches(bites, series).headline).toBeNull();
  });
});
