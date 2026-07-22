import type { AccelSample } from '@/types';

/**
 * Minew E8S "Asset Tag" BLE protocol.
 *
 * The E8S (Nordic nRF52 + LIS3DH, CR2032) is a BROADCAST beacon: it does NOT
 * accept a GATT connection to stream data. Instead it advertises its
 * accelerometer reading inside BLE advertising *service data* under the Minew
 * service UUID 0xFFE1, using the "Acc Sensor" frame (type 0xA1). We discover it
 * by scanning and parse each advertisement — one advertisement = one sample.
 *
 * Acc Sensor frame (service data under 0xFFE1), 15 bytes, big-endian:
 *   byte 0        0xA1                 frame type (accelerometer)
 *   byte 1        product model        (0x03 on E8-family)
 *   byte 2        battery %            (0..100)
 *   bytes 3-4     X acceleration       int16, signed 8.8 fixed-point → /256 = g
 *   bytes 5-6     Y acceleration       int16, signed 8.8 fixed-point → /256 = g
 *   bytes 7-8     Z acceleration       int16, signed 8.8 fixed-point → /256 = g
 *   bytes 9-14    MAC address          6 bytes, big-endian
 *
 * Verified against a real capture "a1 03 64 00d7 0087 fffe 5705a03f23ac":
 *   battery 100%, X=+0.840 g, Y=+0.527 g, Z=-0.008 g → |a|≈0.99 g (at rest). ✓
 *
 * The frame carries no timestamp (the tag has no real clock), so the phone
 * stamps arrival time when it builds an AccelSample (see E8sSensorClient).
 */

/** Minew service that carries the accelerometer frame (16-bit + full 128-bit). */
export const MINEW_SERVICE_UUID_SHORT = 'ffe1';
export const MINEW_SERVICE_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';

/** Frame-type byte identifying the accelerometer ("Acc Sensor") frame. */
export const MINEW_ACC_FRAME = 0xa1;
/** Product-model byte written by the mock; decoding is model-tolerant. */
export const MINEW_PRODUCT_MODEL = 0x03;

/** 8.8 fixed-point: raw int16 / 256 = g. */
const FIXED_8_8 = 256;
const ACC_FRAME_BYTES = 15;

export interface MinewAccReading {
  /** grams (g) */
  x: number;
  y: number;
  z: number;
  /** Battery level 0..100. */
  batteryPct: number;
  /** Colon-separated uppercase MAC, e.g. "57:05:A0:3F:23:AC". */
  mac: string;
}

// --- base64 <-> bytes (Hermes & Node both expose atob/btoa) ---

function base64ToBytes(b64: string): Uint8Array {
  const bin =
    typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
}

function macFromBytes(bytes: Uint8Array, offset: number): string {
  const parts: string[] = [];
  for (let i = 0; i < 6; i++) parts.push((bytes[offset + i] ?? 0).toString(16).padStart(2, '0'));
  return parts.join(':').toUpperCase();
}

/**
 * Decode a Minew 0xFFE1 service-data value (base64) into an accelerometer
 * reading, or null if it is not a well-formed Acc Sensor frame.
 */
export function decodeMinewAccFrame(base64: string): MinewAccReading | null {
  const bytes = base64ToBytes(base64);
  if (bytes.length < ACC_FRAME_BYTES) return null;
  if (bytes[0] !== MINEW_ACC_FRAME) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    batteryPct: bytes[2] ?? 0,
    x: view.getInt16(3, false) / FIXED_8_8, // big-endian, signed
    y: view.getInt16(5, false) / FIXED_8_8,
    z: view.getInt16(7, false) / FIXED_8_8,
    mac: macFromBytes(bytes, 9),
  };
}

const clampInt16 = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v)));

/**
 * Encode an Acc Sensor frame to base64. Used by the mock (and round-trip
 * tests) so the software sensor exercises the exact same wire format.
 */
export function encodeMinewAccFrame(reading: MinewAccReading): string {
  const bytes = new Uint8Array(ACC_FRAME_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, MINEW_ACC_FRAME);
  view.setUint8(1, MINEW_PRODUCT_MODEL);
  view.setUint8(2, Math.max(0, Math.min(100, Math.round(reading.batteryPct))));
  view.setInt16(3, clampInt16(reading.x * FIXED_8_8), false);
  view.setInt16(5, clampInt16(reading.y * FIXED_8_8), false);
  view.setInt16(7, clampInt16(reading.z * FIXED_8_8), false);
  const macBytes = reading.mac.split(':').map((h) => parseInt(h, 16) & 0xff);
  for (let i = 0; i < 6; i++) view.setUint8(9 + i, macBytes[i] ?? 0);
  return bytesToBase64(bytes);
}

/** Build an AccelSample from a reading, stamping the phone's arrival time. */
export function readingToSample(r: MinewAccReading, arrivalMs: number): AccelSample {
  return { t: arrivalMs, x: r.x, y: r.y, z: r.z };
}
