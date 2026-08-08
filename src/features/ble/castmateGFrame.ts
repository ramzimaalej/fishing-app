import { base64ToBytes } from './bytes';

/**
 * Castmate G CP27 advertising frame — the real, captured layout.
 *
 * Determined empirically from live captures off tag 48:87:2D:9D:C0:0C (see the
 * golden vectors in __tests__/castmateGFrame.test.ts), not from vendor
 * documentation. 20 bytes of BLE service data under UUID 0xFEAB:
 *
 *   bytes  0-3   X acceleration   float32, BIG-endian, in g
 *   bytes  4-7   Y acceleration   float32, big-endian, g
 *   bytes  8-11  Z acceleration   float32, big-endian, g
 *   bytes 12-16  MAC tail         5 bytes — the MAC without its first octet
 *   bytes 17-19  padding          always 00 00 00 in every frame observed
 *
 * VERIFIED AGAINST GRAVITY: with the tag at rest the first captured frames
 * decode to (0.032, 0.000, 1.040) g and (0.032, 0.000, 1.050) g — magnitude
 * 1.040 and 1.050 g. Rotating it through its axes produced values reaching
 * ±1.05 on each in turn, which is what one gravity moving between axes looks
 * like. This is the evidence the old CP27 GATT decoder never had, which is why
 * that one stayed marked PROVISIONAL and this one does not.
 *
 * WHY THE VENDOR APP SHOWS ~1e-38 mg: it reads these floats LITTLE-endian.
 * The same bytes that give 1.04 g big-endian give 4.5e+28 or -1.5e-4
 * little-endian, which is the "1e-38" nonsense the vendor UI displays. The
 * payload was never raw bytes miscast as float — it is genuinely float32, read
 * with the wrong byte order.
 *
 * RESOLUTION: values are always multiples of 0.016 g, i.e. 16 mg per count —
 * an 8-bit accelerometer at ±2 g. Worth remembering when reading a bite
 * waveform: the amplitude quantisation is coarse, and no filtering recovers
 * detail below one count.
 */

/** Advertised service-data UUID carrying the accelerometer frame. */
export const CASTMATE_G_SERVICE_UUID_SHORT = 'feab';

/** Byte offsets, named so a firmware change is a one-line edit. */
const OFFSET_X = 0;
const OFFSET_Y = 4;
const OFFSET_Z = 8;
const OFFSET_MAC = 12;
const MAC_TAIL_BYTES = 5;
/** Minimum length to contain the three axes; observed frames are 20 bytes. */
const MIN_FRAME_BYTES = OFFSET_MAC;

/**
 * Largest plausible reading, g.
 *
 * A sanity bound, not a spec limit. Any 4 bytes can be read as a float, so
 * without this a completely unrelated 0xFEAB payload would decode to something
 * like 4.5e+28 and be accepted as a reading.
 */
const MAX_PLAUSIBLE_G = 16;

export interface CastmateGReading {
  /** g */
  x: number;
  y: number;
  z: number;
  /** "87:2D:9D:C0:0C" — the MAC without its first octet (not carried). */
  macTail: string;
}

function readFloatBE(view: DataView, offset: number): number | null {
  const v = view.getFloat32(offset, false);
  if (!Number.isFinite(v)) return null;
  if (Math.abs(v) > MAX_PLAUSIBLE_G) return null;
  return v;
}

function macTailFrom(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < MAC_TAIL_BYTES; i += 1) {
    parts.push((bytes[OFFSET_MAC + i] ?? 0).toString(16).padStart(2, '0'));
  }
  return parts.join(':').toUpperCase();
}

/**
 * Decode a 0xFEAB service-data value.
 *
 * @returns null when the payload is not a well-formed frame. Never throws:
 *   base64 decoding throws on malformed input, and these bytes come off the air
 *   from whatever is in range.
 */
export function decodeCastmateGFrame(base64: string): CastmateGReading | null {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(base64);
  } catch {
    return null;
  }
  if (bytes.length < MIN_FRAME_BYTES) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const x = readFloatBE(view, OFFSET_X);
  const y = readFloatBE(view, OFFSET_Y);
  const z = readFloatBE(view, OFFSET_Z);
  if (x === null || y === null || z === null) return null;

  return {
    x,
    y,
    z,
    // Present only when the frame is long enough; short frames fall back to an
    // empty tail and the caller uses the advertisement id instead.
    macTail: bytes.length >= OFFSET_MAC + MAC_TAIL_BYTES ? macTailFrom(bytes) : '',
  };
}

/** Encode a reading in the same layout. Used by the round-trip tests. */
export function encodeCastmateGFrame(reading: CastmateGReading): string {
  const bytes = new Uint8Array(20);
  const view = new DataView(bytes.buffer);
  view.setFloat32(OFFSET_X, reading.x, false);
  view.setFloat32(OFFSET_Y, reading.y, false);
  view.setFloat32(OFFSET_Z, reading.z, false);
  const tail = reading.macTail.split(':').map((h) => parseInt(h, 16) & 0xff);
  for (let i = 0; i < MAC_TAIL_BYTES; i += 1) {
    view.setUint8(OFFSET_MAC + i, tail[i] ?? 0);
  }
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return globalThis.btoa ? globalThis.btoa(binary) : '';
}
