import type { AccelSample } from '@/types';

/**
 * FishOn bite-sensor BLE GATT profile (custom).
 *
 * Since no fixed hardware exists yet, this defines a clean custom profile that
 * the mock device implements and that a real firmware can target 1:1.
 *
 *   Service  a5c1_0000  "FishOn Sensor Service"
 *     ├─ Char a5c1_0001  Accelerometer stream   [NOTIFY]  (packets below)
 *     └─ Char a5c1_0002  Control                [WRITE]   (commands below)
 *
 * Accelerometer packet (little-endian):
 *   byte 0        uint8   sampleCount (N, 1..25)
 *   then N × 10 bytes:
 *     uint32  t   device timestamp (ms)
 *     int16   x   milli-g   (value / 1000 = g)
 *     int16   y   milli-g
 *     int16   z   milli-g
 *
 * BLE characteristic values cross the bridge as base64 strings.
 */

const BASE = (short: string): string => `a5c1${short}-0000-1000-8000-00805f9b34fb`;

export const FISHON_SERVICE_UUID = BASE('0000');
export const ACCEL_CHAR_UUID = BASE('0001');
export const CONTROL_CHAR_UUID = BASE('0002');

/** Advertised local name prefix used to discover FishOn sensors while scanning. */
export const DEVICE_NAME_PREFIX = 'FishOn';

/** milli-g → g */
export const MILLI_G = 1000;
export const SAMPLE_BYTES = 10;
export const MAX_SAMPLES_PER_PACKET = 25;

/** Control-characteristic commands (single byte + optional payload byte). */
export const ControlCommand = {
  SET_SAMPLE_RATE: 0x01, // payload: uint8 Hz
  SET_FISHING_MODE: 0x02, // payload: 0 = off, 1 = on (live bait)
} as const;

// --- base64 <-> bytes (Hermes & Node both expose atob/btoa) ---

function base64ToBytes(b64: string): Uint8Array {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
}

/** Parse a base64 accelerometer notification into samples (g units). */
export function parseAccelPacket(base64: string): AccelSample[] {
  const bytes = base64ToBytes(base64);
  if (bytes.length < 1) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint8(0);
  const samples: AccelSample[] = [];
  let offset = 1;
  for (let i = 0; i < count; i++) {
    if (offset + SAMPLE_BYTES > bytes.length) break; // truncated packet guard
    const t = view.getUint32(offset, true);
    const x = view.getInt16(offset + 4, true) / MILLI_G;
    const y = view.getInt16(offset + 6, true) / MILLI_G;
    const z = view.getInt16(offset + 8, true) / MILLI_G;
    samples.push({ t, x, y, z });
    offset += SAMPLE_BYTES;
  }
  return samples;
}

const clampInt16 = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v)));

/** Encode samples (g units) into a base64 notification packet (used by the mock). */
export function encodeAccelPacket(samples: AccelSample[]): string {
  const count = Math.min(samples.length, MAX_SAMPLES_PER_PACKET);
  const bytes = new Uint8Array(1 + count * SAMPLE_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, count);
  let offset = 1;
  for (let i = 0; i < count; i++) {
    const s = samples[i]!;
    view.setUint32(offset, s.t >>> 0, true);
    view.setInt16(offset + 4, clampInt16(s.x * MILLI_G), true);
    view.setInt16(offset + 6, clampInt16(s.y * MILLI_G), true);
    view.setInt16(offset + 8, clampInt16(s.z * MILLI_G), true);
    offset += SAMPLE_BYTES;
  }
  return bytesToBase64(bytes);
}

/** Encode a control command to base64 for writing to the control characteristic. */
export function encodeControlCommand(command: number, payload = 0): string {
  return bytesToBase64(new Uint8Array([command & 0xff, payload & 0xff]));
}
