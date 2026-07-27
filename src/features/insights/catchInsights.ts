/**
 * Retrospective catch analysis — pure, fully unit-tested.
 *
 * The question this answers: *which conditions actually produced your bites?*
 *
 * Naive bite counts cannot answer that. If a barometer falls on 15% of hours
 * but you caught 40% of your fish then, that's signal. If you caught 40% of
 * your fish in a condition that occurred 40% of the time, that's nothing. So
 * every bucket is scored by **lift**:
 *
 *     lift = (share of bites in bucket) / (share of hours in bucket)
 *
 * lift > 1 means the condition is over-represented among catches relative to
 * how often it actually occurred. The background hour distribution comes from
 * the same ERA5 series the bites are matched against, so the two shares are
 * always measured over identical ground.
 *
 * KNOWN LIMITATION, stated plainly in the UI too: this controls for how common
 * a condition was, but NOT for when the angler chose to fish. Someone who only
 * ever fishes at dawn will see dawn lift regardless of the fish. Fixing that
 * properly needs per-session effort logging (hours fished per bucket), which
 * the bite records don't carry yet.
 */

import type { BiteRecord, EnvironmentSnapshot } from '@/types';

/** Minimum matched bites before any insight is shown at all. */
export const MIN_SAMPLE = 12;
/** Minimum bites in a bucket before it may be called a "best" condition. */
export const MIN_BUCKET_BITES = 3;

export type DimensionKey =
  | 'pressureTrend'
  | 'temperature'
  | 'wind'
  | 'timeOfDay'
  | 'moon'
  | 'tide';

export interface InsightBucket {
  label: string;
  bites: number;
  /** Share of matched bites, 0..1. */
  biteShare: number;
  hours: number;
  /** Share of background hours, 0..1. */
  hourShare: number;
  /**
   * biteShare / hourShare. 1 = exactly as often as chance. 0 when the bucket
   * caught nothing; a bucket with bites but no background hours is impossible
   * (bites are matched to those very hours) and yields 0 rather than Infinity.
   */
  lift: number;
}

export interface InsightDimension {
  key: DimensionKey;
  title: string;
  /** Buckets in natural (not ranked) order, so scales read left to right. */
  buckets: InsightBucket[];
  /** Highest-lift bucket clearing MIN_BUCKET_BITES, else null. */
  best: InsightBucket | null;
}

export interface CatchInsights {
  /** Bites successfully matched to an hour of reanalysis. */
  matched: number;
  /** Bites excluded: outside the window, or the hour had no data. */
  excluded: number;
  /** Hours of background reanalysis the shares are measured against. */
  backgroundHours: number;
  /** True once `matched >= MIN_SAMPLE`. Below that, dimensions are empty. */
  sufficient: boolean;
  dimensions: InsightDimension[];
  /** One-sentence strongest takeaway, or null when there isn't one. */
  headline: string | null;
}

// ---------------------------------------------------------------------------
// Bucketing. Thresholds deliberately mirror fishActivity.ts so the predictive
// model and the retrospective analysis describe the world the same way — a
// user should never see "falling fast" mean two different things.
// ---------------------------------------------------------------------------

interface Dimension {
  key: DimensionKey;
  title: string;
  /** Ordered bucket labels; defines display order. */
  labels: string[];
  /** Bucket label for a snapshot, or null when this dimension has no data. */
  of: (s: Partial<EnvironmentSnapshot>) => string | null;
}

function pressureTrendLabel(s: Partial<EnvironmentSnapshot>): string | null {
  const t = s.pressureTrend;
  // Undefined means unknown (series edge, or a snapshot persisted before the
  // field existed) — excluded rather than silently counted as steady.
  if (t === undefined) return null;
  if (t <= -0.4) return 'Falling fast';
  if (t < -0.1) return 'Falling';
  if (t <= 0.1) return 'Steady';
  if (t <= 0.4) return 'Rising';
  return 'Rising fast';
}

function temperatureLabel(s: Partial<EnvironmentSnapshot>): string | null {
  const t = s.temperature;
  if (t === undefined) return null;
  if (t < 5) return '<5°C';
  if (t < 10) return '5–10°';
  if (t < 15) return '10–15°';
  if (t < 20) return '15–20°';
  if (t < 25) return '20–25°';
  return '25°+';
}

function windLabel(s: Partial<EnvironmentSnapshot>): string | null {
  const w = s.windSpeed;
  if (w === undefined) return null;
  if (w < 1) return 'Calm';
  if (w <= 6) return 'Light';
  if (w <= 9) return 'Moderate';
  if (w <= 12) return 'Fresh';
  return 'Strong';
}

/** Bands chosen around the dawn/dusk peaks the activity model already uses. */
function timeOfDayLabel(s: Partial<EnvironmentSnapshot>): string | null {
  if (!s.time) return null;
  const hour = new Date(s.time).getHours();
  if (Number.isNaN(hour)) return null;
  if (hour >= 4 && hour < 8) return 'Dawn';
  if (hour >= 8 && hour < 11) return 'Morning';
  if (hour >= 11 && hour < 15) return 'Midday';
  if (hour >= 15 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 21) return 'Dusk';
  return 'Night';
}

function moonLabel(s: Partial<EnvironmentSnapshot>): string | null {
  return s.moon?.name ?? null;
}

function tideLabel(s: Partial<EnvironmentSnapshot>): string | null {
  return s.tide?.state ?? null;
}

const DIMENSIONS: Dimension[] = [
  {
    key: 'pressureTrend',
    title: 'Barometric trend',
    labels: ['Falling fast', 'Falling', 'Steady', 'Rising', 'Rising fast'],
    of: pressureTrendLabel,
  },
  {
    key: 'temperature',
    title: 'Air temperature',
    labels: ['<5°C', '5–10°', '10–15°', '15–20°', '20–25°', '25°+'],
    of: temperatureLabel,
  },
  {
    key: 'wind',
    title: 'Wind',
    labels: ['Calm', 'Light', 'Moderate', 'Fresh', 'Strong'],
    of: windLabel,
  },
  {
    key: 'timeOfDay',
    title: 'Time of day',
    labels: ['Dawn', 'Morning', 'Midday', 'Afternoon', 'Dusk', 'Night'],
    of: timeOfDayLabel,
  },
  {
    key: 'moon',
    title: 'Moon',
    labels: [
      'New Moon',
      'Waxing Crescent',
      'First Quarter',
      'Waxing Gibbous',
      'Full Moon',
      'Waning Gibbous',
      'Last Quarter',
      'Waning Crescent',
    ],
    of: moonLabel,
  },
  {
    key: 'tide',
    title: 'Tide',
    labels: ['rising', 'high', 'falling', 'low'],
    of: tideLabel,
  },
];

// ---------------------------------------------------------------------------

export interface MatchedBite {
  record: BiteRecord;
  /** The reanalysis hour this bite was matched to. */
  hour: EnvironmentSnapshot;
}

/**
 * Match bites to the hour of reanalysis they occurred in.
 *
 * Bites outside the series are excluded rather than snapped to the nearest
 * edge — attributing a July catch to a June hour would corrupt the statistics
 * far more than a smaller sample does.
 */
export function matchBitesToHours(
  records: BiteRecord[],
  series: EnvironmentSnapshot[],
): { matched: MatchedBite[]; excluded: number } {
  if (series.length === 0) return { matched: [], excluded: records.length };

  // Index by truncated hour. Series times are local ISO strings without an
  // offset, so `new Date(time)` parses them in the device zone — the same
  // basis on which BiteRecord.timestamp was stamped.
  const byHour = new Map<number, EnvironmentSnapshot>();
  for (const s of series) {
    const t = new Date(s.time).getTime();
    if (!Number.isNaN(t)) byHour.set(t, s);
  }

  const HOUR_MS = 3_600_000;
  const matched: MatchedBite[] = [];
  let excluded = 0;

  for (const record of records) {
    const hourStart = Math.floor(record.timestamp / HOUR_MS) * HOUR_MS;
    const hour = byHour.get(hourStart);
    if (hour) matched.push({ record, hour });
    else excluded += 1;
  }

  return { matched, excluded };
}

function buildDimension(
  dim: Dimension,
  matched: MatchedBite[],
  series: EnvironmentSnapshot[],
): InsightDimension {
  const biteCounts = new Map<string, number>();
  const hourCounts = new Map<string, number>();

  let totalBites = 0;
  for (const m of matched) {
    const label = dim.of(m.hour);
    if (label === null) continue; // dimension has no data for this hour
    biteCounts.set(label, (biteCounts.get(label) ?? 0) + 1);
    totalBites += 1;
  }

  let totalHours = 0;
  for (const s of series) {
    const label = dim.of(s);
    if (label === null) continue;
    hourCounts.set(label, (hourCounts.get(label) ?? 0) + 1);
    totalHours += 1;
  }

  const buckets: InsightBucket[] = dim.labels
    // Drop labels that never occurred — an empty "25°+" band in Norway is noise.
    .filter((label) => (hourCounts.get(label) ?? 0) > 0)
    .map((label) => {
      const bites = biteCounts.get(label) ?? 0;
      const hours = hourCounts.get(label) ?? 0;
      const biteShare = totalBites > 0 ? bites / totalBites : 0;
      const hourShare = totalHours > 0 ? hours / totalHours : 0;
      return {
        label,
        bites,
        biteShare,
        hours,
        hourShare,
        lift: hourShare > 0 ? biteShare / hourShare : 0,
      };
    });

  let best: InsightBucket | null = null;
  for (const b of buckets) {
    // A bucket needs both a real sample and better-than-chance lift to be
    // called out; otherwise we'd confidently recommend a single lucky cast.
    if (b.bites < MIN_BUCKET_BITES || b.lift <= 1) continue;
    if (!best || b.lift > best.lift) best = b;
  }

  return { key: dim.key, title: dim.title, buckets, best };
}

/** "2.4× more often than chance" → a plain-language phrase for the headline. */
function liftPhrase(lift: number): string {
  return `${lift.toFixed(1)}× more often than chance`;
}

export function analyseCatches(
  records: BiteRecord[],
  series: EnvironmentSnapshot[],
): CatchInsights {
  const { matched, excluded } = matchBitesToHours(records, series);
  const sufficient = matched.length >= MIN_SAMPLE;

  if (!sufficient) {
    return {
      matched: matched.length,
      excluded,
      backgroundHours: series.length,
      sufficient: false,
      dimensions: [],
      headline: null,
    };
  }

  // Only dimensions with at least two occupied buckets are worth showing — a
  // single-bucket "scale" conveys nothing.
  const dimensions = DIMENSIONS.map((d) => buildDimension(d, matched, series)).filter(
    (d) => d.buckets.length >= 2,
  );

  let strongest: InsightDimension | null = null;
  for (const d of dimensions) {
    if (!d.best) continue;
    if (!strongest || d.best.lift > strongest.best!.lift) strongest = d;
  }

  const headline =
    strongest && strongest.best
      ? `${strongest.best.label} — ${strongest.title.toLowerCase()} — produced bites ${liftPhrase(
          strongest.best.lift,
        )}.`
      : null;

  return {
    matched: matched.length,
    excluded,
    backgroundHours: series.length,
    sufficient: true,
    dimensions,
    headline,
  };
}
