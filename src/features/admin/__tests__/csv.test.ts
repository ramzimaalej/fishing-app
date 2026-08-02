import type { DetectorTick } from '@/features/bite-detection/types';

import type { CaptureEvent } from '../captureTypes';
import {
  csvField,
  EVENT_CSV_HEADER,
  eventsCsv,
  SAMPLE_CSV_HEADER,
  sampleRow,
} from '../csv';

const tick = (over: Partial<DetectorTick> = {}): DetectorTick => ({
  sample: { t: 1000, x: 0.1, y: 0.2, z: 0.98 },
  rawMagnitude: 1.005,
  baseline: 1.0,
  dynamic: 0.005,
  threshold: 0.08,
  bite: null,
  ...over,
});

describe('sampleRow', () => {
  it('emits columns in header order', () => {
    expect(SAMPLE_CSV_HEADER.split(',')).toHaveLength(sampleRow('rod_a', tick()).split(',').length);
    expect(sampleRow('rod_a', tick())).toBe('1000,rod_a,0.1,0.2,0.98,1.005,1,0.005,0.08');
  });

  it('rounds the device timestamp to an integer', () => {
    const row = sampleRow('rod_a', tick({ sample: { t: 1000.6, x: 0, y: 0, z: 0 } }));
    expect(row.split(',')[0]).toBe('1001');
  });

  it('trims float noise instead of writing a 17-digit value', () => {
    const row = sampleRow('rod_a', tick({ dynamic: 0.1 + 0.2 }));
    // 0.1 + 0.2 === 0.30000000000000004
    expect(row.split(',')[7]).toBe('0.3');
  });

  it('writes an empty field for a non-finite value rather than "NaN"', () => {
    const row = sampleRow('rod_a', tick({ baseline: NaN, threshold: Infinity }));
    const cols = row.split(',');
    expect(cols[6]).toBe('');
    expect(cols[8]).toBe('');
  });

  it('keeps negative axis values', () => {
    const row = sampleRow('rod_a', tick({ sample: { t: 5, x: -0.5, y: 0, z: 0 } }));
    expect(row.split(',')[2]).toBe('-0.5');
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
    kind: 'human',
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
    expect(cols[0]).toBe('human');
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
