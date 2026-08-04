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

import { base64ToBytes } from '@/features/ble/bytes';
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
}

const devices = new Map<string, Sniffed>();
let unsubscribe: (() => void) | null = null;
let publishTimer: ReturnType<typeof setInterval> | null = null;

/** Raw frames held for the current capture, or null when not capturing. */
let captureLines: string[] | null = null;

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
}

interface SnifferState {
  scanning: boolean;
  devices: SniffedDeviceView[];
  capturing: boolean;
  capturedFrames: number;
  error: string | null;
}

export const useSnifferStore = create<SnifferState>(() => ({
  scanning: false,
  devices: [],
  capturing: false,
  capturedFrames: 0,
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
    };
    devices.set(device.id, entry);
  }

  entry.name = device.name ?? device.localName ?? entry.name;
  entry.rssi = device.rssi ?? entry.rssi;
  entry.frames += 1;
  entry.lastSeen = Date.now();

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

export function startCapture(): void {
  captureLines = [];
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
  const lines = captureLines;
  captureLines = null;
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
    return path;
  } catch (e) {
    useSnifferStore.setState({
      error: e instanceof Error ? e.message : 'Could not write the capture.',
    });
    return null;
  }
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
