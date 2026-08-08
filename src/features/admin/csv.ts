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

import type { FeatureFrame } from '@/features/detection/featureExtractor';

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
  't,rodId,xMg,yMg,zMg,magMg,thetaDeg,dtMs,crossings,sharpCrossings,meanDevDeg,cv,impact';

/**
 * One sample row.
 *
 * `t` is the MONOTONIC arrival clock, not wall time and not a device clock — see
 * detection/monotonicClock. It is comparable with events.csv, which uses the
 * same source, and with nothing else.
 *
 * `dtMs` is included deliberately: with no sequence numbers it is the only
 * evidence of a dropped packet, and any analysis of onset rates has to know
 * which pairs were too far apart to trust.
 */
export function sampleRow(rodId: string, frame: FeatureFrame): string {
  const { sample } = frame;
  return [
    String(Math.round(sample.tMonotonicMs)),
    csvField(rodId),
    String(Math.round(sample.xMg)),
    String(Math.round(sample.yMg)),
    String(Math.round(sample.zMg)),
    num(frame.magnitudeMg),
    num(frame.thetaDeg),
    frame.dtMs === null ? '' : String(Math.round(frame.dtMs)),
    String(frame.crossings),
    String(frame.sharpCrossings),
    num(frame.meanDeviationDeg),
    frame.crossingIntervalCv === null ? '' : num(frame.crossingIntervalCv),
    frame.isImpact ? '1' : '0',
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
