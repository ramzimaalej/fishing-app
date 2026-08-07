import type { FeatureFrame } from '@/features/detection/featureExtractor';

import type { CaptureEvent } from '../captureTypes';
import {
  csvField,
  EVENT_CSV_HEADER,
  eventsCsv,
  SAMPLE_CSV_HEADER,
  sampleRow,
} from '../csv';

const tick = (over: Partial<FeatureFrame> = {}): FeatureFrame => ({
  sample: { tMonotonicMs: 1000, xMg: 100, yMg: 200, zMg: 980, rssi: -60 },
  dtMs: 100,
  magnitudeMg: 1005,
  thetaDeg: 0.5,
  isImpact: false,
  baselineFrozen: false,
  crossedUp: false,
  completedCrossing: null,
  crossings: 0,
  sharpCrossings: 0,
  meanDeviationDeg: 0.2,
  crossingIntervalCv: null,
  ...over,
});

describe('sampleRow', () => {
  it('emits columns in header order', () => {
    expect(sampleRow('rod_a', tick()).split(',')).toHaveLength(
      SAMPLE_CSV_HEADER.split(',').length,
    );
  });

  it('writes the monotonic arrival time, rounded', () => {
    const row = sampleRow('rod_a', tick({
      sample: { tMonotonicMs: 1000.6, xMg: 0, yMg: 0, zMg: 0, rssi: -60 },
    }));
    expect(row.split(',')[0]).toBe('1001');
  });

  it('writes milli-g integers', () => {
    const cols = sampleRow('rod_a', tick()).split(',');
    expect(cols.slice(2, 5)).toEqual(['100', '200', '980']);
  });

  it('trims float noise instead of writing a 17-digit value', () => {
    const row = sampleRow('rod_a', tick({ thetaDeg: 0.1 + 0.2 }));
    // 0.1 + 0.2 === 0.30000000000000004
    expect(row.split(',')[6]).toBe('0.3');
  });

  it('records dt, the only evidence a packet was dropped', () => {
    // With no sequence numbers, analysis cannot otherwise tell which pairs were
    // too far apart for their slope to be trusted.
    expect(sampleRow('rod_a', tick({ dtMs: 487 })).split(',')[7]).toBe('487');
    expect(sampleRow('rod_a', tick({ dtMs: null })).split(',')[7]).toBe('');
  });

  it('flags an impact sample', () => {
    expect(sampleRow('rod_a', tick({ isImpact: true })).split(',')[12]).toBe('1');
    expect(sampleRow('rod_a', tick({ isImpact: false })).split(',')[12]).toBe('0');
  });

  it('leaves the CV empty when there were too few crossings to characterise', () => {
    expect(sampleRow('rod_a', tick({ crossingIntervalCv: null })).split(',')[11]).toBe('');
    expect(sampleRow('rod_a', tick({ crossingIntervalCv: 0.42 })).split(',')[11]).toBe('0.42');
  });

  it('writes an empty field for a non-finite value rather than "NaN"', () => {
    const cols = sampleRow('rod_a', tick({ magnitudeMg: NaN, thetaDeg: Infinity })).split(',');
    expect(cols[5]).toBe('');
    expect(cols[6]).toBe('');
  });

  it('keeps negative axis values', () => {
    const row = sampleRow('rod_a', tick({
      sample: { tMonotonicMs: 5, xMg: -500, yMg: 0, zMg: 0, rssi: -60 },
    }));
    expect(row.split(',')[2]).toBe('-500');
  });
});

describe('csvField', () => {
  it('leaves an ordinary value unquoted', () => {
    expect(csvField('Left rod')).toBe('Left rod');
  });

  it('quotes a value containing a comma, so later columns do not shift', () => {
    expect(csvField('Left rod, big')).toBe('"Left rod, big"');
  });

  it('escapes embedded quotes by doubling them', () => {
    expect(csvField('the "good" rod')).toBe('"the ""good"" rod"');
  });

  it('quotes a value containing a newline', () => {
    expect(csvField('two\nlines')).toBe('"two\nlines"');
  });
});

describe('eventsCsv', () => {
  const detection: CaptureEvent = {
    kind: 'detection',
    at: 1_700_000_000_000,
    deviceT: 4242,
    rodId: 'rod_a',
    rodName: 'Left rod',
    size: 'big',
    peakMagnitude: 0.87,
    confidence: 0.91,
    threshold: 0.2,
  };

  const human: CaptureEvent = {
    kind: 'fish',
    at: 1_700_000_001_500,
    deviceT: 5742,
    rodId: 'rod_a',
    rodName: 'Left rod',
  };

  it('starts with the header', () => {
    expect(eventsCsv([]).trim()).toBe(EVENT_CSV_HEADER);
  });

  it('ends with a newline so chunks concatenate cleanly', () => {
    expect(eventsCsv([detection]).endsWith('\n')).toBe(true);
  });

  it('writes detection-only columns as empty for a human mark', () => {
    const lines = eventsCsv([human]).trim().split('\n');
    const cols = lines[1]!.split(',');
    expect(cols[0]).toBe('fish');
    // size, peakMagnitude, confidence, threshold
    expect(cols.slice(5)).toEqual(['', '', '', '']);
  });

  it('writes a full detection row', () => {
    const cols = eventsCsv([detection]).trim().split('\n')[1]!.split(',');
    expect(cols[0]).toBe('detection');
    expect(cols[1]).toBe('1700000000000');
    expect(cols[2]).toBe('4242');
    expect(cols[5]).toBe('big');
  });

  it('writes an empty deviceT when no sample had arrived yet', () => {
    const cols = eventsCsv([{ ...human, deviceT: null }]).trim().split('\n')[1]!.split(',');
    expect(cols[2]).toBe('');
  });

  it('has one column per header field', () => {
    const headerCount = EVENT_CSV_HEADER.split(',').length;
    for (const line of eventsCsv([detection, human]).trim().split('\n')) {
      expect(line.split(',')).toHaveLength(headerCount);
    }
  });
});
