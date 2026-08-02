/**
 * CSV serialisation for captured samples and events.
 *
 * Pure string building, kept apart from the writer so the format can be tested
 * without touching a filesystem.
 *
 * CSV rather than JSON for the sample stream: it is roughly a third of the size
 * at 10 Hz over a multi-hour session, it concatenates trivially across chunk
 * files, and it loads into pandas or a spreadsheet with no parsing code — which
 * is the whole point of capturing this data.
 */

import type { DetectorTick } from '@/features/bite-detection/types';

import type { CaptureEvent } from './captureTypes';

/**
 * Decimals kept for acceleration values.
 *
 * Five is well past sensor resolution (these tags report ~milli-g at best) and
 * it stops float noise turning 1.2 into "1.2000000000000002", which would both
 * inflate the file and make diffs unreadable.
 */
const PRECISION = 5;

const num = (v: number): string =>
  Number.isFinite(v) ? String(Number(v.toFixed(PRECISION))) : '';

/**
 * Quote a field only when it needs it.
 *
 * Rod names are user-supplied free text, so a name containing a comma would
 * otherwise silently shift every later column — the kind of corruption that is
 * only noticed after a day of fishing has been recorded.
 */
export function csvField(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export const SAMPLE_CSV_HEADER =
  't,rodId,x,y,z,raw,baseline,dynamic,threshold';

/**
 * One sample row. `t` is the DEVICE clock — see the clock-domain note in
 * captureTypes.ts before comparing it with anything from events.csv.
 */
export function sampleRow(rodId: string, tick: DetectorTick): string {
  const { sample } = tick;
  return [
    String(Math.round(sample.t)),
    csvField(rodId),
    num(sample.x),
    num(sample.y),
    num(sample.z),
    num(tick.rawMagnitude),
    num(tick.baseline),
    num(tick.dynamic),
    num(tick.threshold),
  ].join(',');
}

export const EVENT_CSV_HEADER =
  'kind,at,deviceT,rodId,rodName,size,peakMagnitude,confidence,threshold';

export function eventRow(e: CaptureEvent): string {
  return [
    e.kind,
    String(e.at),
    e.deviceT === null ? '' : String(Math.round(e.deviceT)),
    csvField(e.rodId),
    csvField(e.rodName),
    e.size ?? '',
    e.peakMagnitude === undefined ? '' : num(e.peakMagnitude),
    e.confidence === undefined ? '' : num(e.confidence),
    e.threshold === undefined ? '' : num(e.threshold),
  ].join(',');
}

/** Full events file, header included. Always ends with a newline. */
export function eventsCsv(events: readonly CaptureEvent[]): string {
  return [EVENT_CSV_HEADER, ...events.map(eventRow)].join('\n') + '\n';
}
