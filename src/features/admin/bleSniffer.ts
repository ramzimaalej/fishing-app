/**
 * Raw BLE advertisement sniffer, for identifying an unknown broadcast sensor.
 *
 * Rides the shared refcounted scan (scanBroker) rather than starting its own —
 * react-native-ble-plx has exactly one global scan, so sniffing while rods are
 * armed must not steal it. That also means the sniffer can run during a live
 * session, which is useful: you can watch a known-good tag and the new one side
 * by side.
 *
 * It reads BOTH service data and manufacturer data. The Minew client only looks
 * at service data because that is where the E8S puts its frame, but cheap tags
 * very often use manufacturer data (0xFF) instead — sniffing only one of the two
 * is the fastest way to conclude a working sensor is silent.
 */
import { create } from 'zustand';

import type { AccSample } from '@/features/detection/accSample';
import { runParserSelfTest, type SelfTestResult } from '@/features/detection/accSample';
import type { BroadcastAdvertisement } from '@/features/ble/BroadcastSensorClient';
import { base64ToBytes } from '@/features/ble/bytes';
import { CASTMATE_G_SPEC } from '@/features/ble/CastmateGSensorClient';
import { subscribeToScan } from '@/features/ble/scanBroker';

import {
  emptyProfile,
  hexBytes,
  int16Candidates,
  type Int16Candidate,
  looksLikeSensor,
  observe,
  type PayloadProfile,
  varyingOffsets,
} from './snifferAnalysis';
import { captureRoot, fs } from './storage';

/** UI publish cadence. An `allowDuplicates` scan can fire far faster than this. */
const PUBLISH_MS = 500;
/** Bound memory in a crowded RF environment; the stalest entry is evicted. */
const MAX_DEVICES = 80;
/** Hard cap on a raw capture, so a forgotten recording cannot fill the disk. */
const MAX_CAPTURE_FRAMES = 20_000;
/** Decoded samples retained per advertiser for the parser self-test. */
const SELF_TEST_WINDOW = 200;

interface Source {
  key: string;
  profile: PayloadProfile;
}

interface Sniffed {
  id: string;
  name: string;
  rssi: number;
  frames: number;
  lastSeen: number;
  sources: Map<string, Source>;
  /**
   * Samples the SHIPPING parser managed to decode from this advertiser, for the
   * self-test. Bounded — only the recent window matters, and the operator is
   * rotating the tag while it fills.
   */
  decoded: AccSample[];
}

const devices = new Map<string, Sniffed>();
let unsubscribe: (() => void) | null = null;
let publishTimer: ReturnType<typeof setInterval> | null = null;

/** Raw frames held for the current capture, or null when not capturing. */
let captureLines: string[] | null = null;
/** Auto-stop timer for a fixed-length capture. */
let captureTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Only advertisers whose id contains this are tracked (case-insensitive).
 *
 * A filter rather than a hard MAC equality: on iOS `device.id` is an opaque
 * per-install UUID rather than a MAC, so an exact-MAC filter would match nothing
 * there. A substring also lets the operator narrow by the last few hex digits,
 * which is what is printed on the tag.
 */
let idFilter: string | null = null;

// ---------------------------------------------------------------------------

export interface SniffedSourceView {
  key: string;
  hex: string[];
  varying: number[];
  frames: number;
  candidates: Int16Candidate[];
  isSensor: boolean;
}

export interface SniffedDeviceView {
  id: string;
  name: string;
  rssi: number;
  frames: number;
  sources: SniffedSourceView[];
  /** True when any payload on this device carries moving bytes. */
  isSensor: boolean;
  /**
   * Verdict from running the shipping parser over this advertiser, or null when
   * it decoded nothing. A tag at rest must read one gravity in ANY orientation —
   * the only ground truth available for an unknown format.
   */
  selfTest: SelfTestResult | null;
}

interface SnifferState {
  scanning: boolean;
  devices: SniffedDeviceView[];
  capturing: boolean;
  capturedFrames: number;
  /** Seconds left on a fixed-length capture; null for an open-ended one. */
  captureSecondsLeft: number | null;
  idFilter: string | null;
  error: string | null;
}

export const useSnifferStore = create<SnifferState>(() => ({
  scanning: false,
  devices: [],
  capturing: false,
  capturedFrames: 0,
  captureSecondsLeft: null,
  idFilter: null,
  error: null,
}));

function toView(d: Sniffed): SniffedDeviceView {
  const sources = [...d.sources.values()].map((s) => ({
    key: s.key,
    hex: hexBytes(s.profile.last),
    varying: varyingOffsets(s.profile),
    frames: s.profile.frames,
    candidates: int16Candidates(s.profile),
    isSensor: looksLikeSensor(s.profile),
  }));
  return {
    id: d.id,
    name: d.name,
    rssi: d.rssi,
    frames: d.frames,
    sources,
    isSensor: sources.some((s) => s.isSensor),
    selfTest: d.decoded.length > 0 ? runParserSelfTest(d.decoded) : null,
  };
}

function publish(): void {
  const views = [...devices.values()]
    .map(toView)
    // Nearest first: the tag in your hand is the strongest signal in the room,
    // which is the only reliable way to pick it out of a list of strangers.
    .sort((a, b) => b.rssi - a.rssi);
  useSnifferStore.setState({
    devices: views,
    capturing: captureLines !== null,
    capturedFrames: captureLines?.length ?? 0,
  });
}

function evictStalest(): void {
  let oldestId: string | null = null;
  let oldest = Infinity;
  for (const [id, d] of devices) {
    if (d.lastSeen < oldest) {
      oldest = d.lastSeen;
      oldestId = id;
    }
  }
  if (oldestId) devices.delete(oldestId);
}

/** Every payload carried by one advertisement, keyed for display. */
function payloadsOf(device: {
  serviceData?: Record<string, string> | null;
  manufacturerData?: string | null;
}): [key: string, base64: string][] {
  const out: [string, string][] = [];
  const sd = device.serviceData;
  if (sd) {
    for (const [uuid, value] of Object.entries(sd)) {
      if (typeof value !== 'string') continue;
      // 16-bit UUIDs are the informative part of the 128-bit expansion.
      const short = uuid.replace(/^0000/, '').split('-')[0] ?? uuid;
      out.push([`sd:${short.toLowerCase()}`, value]);
    }
  }
  if (device.manufacturerData) out.push(['mfg', device.manufacturerData]);
  return out;
}

function matchesFilter(id: string, name: string): boolean {
  if (!idFilter) return true;
  const needle = idFilter.toLowerCase().replace(/[^0-9a-z]/g, '');
  if (needle.length === 0) return true;
  return (
    id.toLowerCase().replace(/[^0-9a-z]/g, '').includes(needle) ||
    name.toLowerCase().includes(idFilter.toLowerCase())
  );
}

export function setIdFilter(value: string | null): void {
  idFilter = value && value.trim().length > 0 ? value.trim() : null;
  devices.clear();
  useSnifferStore.setState({ idFilter, devices: [] });
}

function onAdvertisement(device: {
  id: string;
  name?: string | null;
  localName?: string | null;
  rssi?: number | null;
  serviceData?: Record<string, string> | null;
  manufacturerData?: string | null;
}): void {
  const payloads = payloadsOf(device);
  // Advertisers with no payload at all tell us nothing and would crowd out the
  // ones that do.
  if (payloads.length === 0) return;
  if (!matchesFilter(device.id, device.name ?? device.localName ?? '')) return;

  let entry = devices.get(device.id);
  if (!entry) {
    if (devices.size >= MAX_DEVICES) evictStalest();
    entry = {
      id: device.id,
      name: device.name ?? device.localName ?? '(unnamed)',
      rssi: device.rssi ?? -127,
      frames: 0,
      lastSeen: 0,
      sources: new Map(),
      decoded: [],
    };
    devices.set(device.id, entry);
  }

  entry.name = device.name ?? device.localName ?? entry.name;
  entry.rssi = device.rssi ?? entry.rssi;
  entry.frames += 1;
  entry.lastSeen = Date.now();

  // Run the shipping parser over every advertisement. This is what makes the
  // self-test meaningful: it exercises the decoder the app will actually use,
  // not a reimplementation of it.
  try {
    const reading = CASTMATE_G_SPEC.extract(device as BroadcastAdvertisement);
    if (reading) {
      entry.decoded.push({
        tMonotonicMs: entry.lastSeen,
        xMg: reading.xMg,
        yMg: reading.yMg,
        zMg: reading.zMg,
        rssi: entry.rssi,
      });
      if (entry.decoded.length > SELF_TEST_WINDOW) entry.decoded.shift();
    }
  } catch {
    /* a decoder that throws is a decoder that did not match */
  }

  const captureSources: Record<string, string> = {};
  for (const [key, base64] of payloads) {
    let source = entry.sources.get(key);
    if (!source) {
      source = { key, profile: emptyProfile() };
      entry.sources.set(key, source);
    }
    try {
      const bytes = base64ToBytes(base64);
      observe(source.profile, bytes);
      captureSources[key] = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      /* a malformed payload must not stop the sniff */
    }
  }

  if (captureLines !== null && captureLines.length < MAX_CAPTURE_FRAMES) {
    captureLines.push(
      JSON.stringify({
        at: entry.lastSeen,
        id: entry.id,
        name: entry.name,
        rssi: entry.rssi,
        sources: captureSources,
      }),
    );
  }
}

// ---------------------------------------------------------------------------

export function startSniffing(): void {
  if (unsubscribe) return;
  devices.clear();
  useSnifferStore.setState({ scanning: true, devices: [], error: null });
  unsubscribe = subscribeToScan(onAdvertisement);
  publishTimer ??= setInterval(publish, PUBLISH_MS);
}

export function stopSniffing(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (publishTimer) {
    clearInterval(publishTimer);
    publishTimer = null;
  }
  useSnifferStore.setState({ scanning: false });
}

/**
 * Begin a raw capture.
 *
 * @param seconds fixed length, or null for open-ended. A timed capture exists
 *   because the operator's hands are on the tag, not the phone: rotating it
 *   through six orientations is a two-handed job, and having to reach back for
 *   a stop button is how captures end up truncated.
 */
export function startCapture(seconds: number | null = null): void {
  captureLines = [];
  if (captureTimer) clearTimeout(captureTimer);
  captureTimer = null;

  if (seconds !== null) {
    captureTimer = setTimeout(() => {
      captureTimer = null;
      void stopCapture('timed');
    }, seconds * 1000);
  }
  useSnifferStore.setState({ captureSecondsLeft: seconds });
  publish();
}

/**
 * Stop capturing and write the frames out.
 *
 * NDJSON rather than CSV: each advertisement carries a variable set of payload
 * sources, which a fixed column layout cannot represent without either padding
 * or losing one.
 */
export async function stopCapture(label: string): Promise<string | null> {
  if (captureTimer) {
    clearTimeout(captureTimer);
    captureTimer = null;
  }
  const lines = captureLines;
  captureLines = null;
  useSnifferStore.setState({ captureSecondsLeft: null });
  publish();
  if (!lines || lines.length === 0) return null;

  const safe = label.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40);
  const name = `sniff-${Date.now().toString(36)}${safe ? `-${safe}` : ''}.ndjson`;
  const path = `${captureRoot()}${name}`;

  try {
    // The recordings browser skips anything without meta.json, so a sniff file
    // sitting in the same root cannot be mistaken for a detector recording.
    await fs().makeDirectoryAsync(captureRoot(), { intermediates: true });
    await fs().writeAsStringAsync(path, lines.join('\n') + '\n');
    // CSV alongside, because a spreadsheet is where byte layouts actually get
    // worked out: one row per payload, columns per byte offset.
    await fs().writeAsStringAsync(path.replace(/\.ndjson$/, '.csv'), sniffCsv(lines));
    return path;
  } catch (e) {
    useSnifferStore.setState({
      error: e instanceof Error ? e.message : 'Could not write the capture.',
    });
    return null;
  }
}

/**
 * NDJSON capture → CSV with one column per byte offset.
 *
 * Fixed-width columns rather than a hex blob: the whole task is spotting WHICH
 * offsets move when the tag is rotated, and that is a column-wise comparison.
 */
export function sniffCsv(lines: readonly string[]): string {
  const rows: string[][] = [];
  let widest = 0;

  for (const line of lines) {
    let parsed: { at: number; id: string; rssi: number; sources: Record<string, string> };
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    for (const [source, hex] of Object.entries(parsed.sources ?? {})) {
      const bytes = hex.match(/../g) ?? [];
      widest = Math.max(widest, bytes.length);
      rows.push([String(parsed.at), parsed.id, String(parsed.rssi), source, ...bytes]);
    }
  }

  const header = ['at', 'id', 'rssi', 'source', ...Array.from({ length: widest }, (_, i) => `b${i}`)];
  const body = rows.map((r) => {
    const padded = [...r];
    while (padded.length < header.length) padded.push('');
    return padded.join(',');
  });
  return [header.join(','), ...body].join('\n') + '\n';
}

export function isCapturing(): boolean {
  return captureLines !== null;
}

/** Test seam. */
export function resetSniffer(): void {
  stopSniffing();
  devices.clear();
  captureLines = null;
  useSnifferStore.setState({
    scanning: false,
    devices: [],
    capturing: false,
    capturedFrames: 0,
    error: null,
  });
}

/** Exposed for tests: feed a synthetic advertisement. */
export const __testOnly = { onAdvertisement, payloadsOf };
