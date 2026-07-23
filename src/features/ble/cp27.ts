import { base64ToBytes, bytesToBase64 } from './bytes';
import type { AccelReading } from './GattSensorClient';

/**
 * DX-CP27MINI (DX-SMART beacon, Dialog DA14531) BLE protocol.
 *
 * Unlike the Minew E8S, the CP27 does NOT broadcast usable live accelerometer
 * data over the air — its advertisement carries only static identity frames
 * (Eddystone UID/URL, iBeacon, device-info). Its accelerometer is reachable
 * only over a GATT connection, through a proprietary "NO"+cmd polling protocol
 * on a vendor 0xFFE0 service:
 *
 *   0xFFE1  handle 0x001d  NOTIFY  — responses / streamed frames (accel here)
 *   0xFFE2  handle 0x0021  WRITE   — commands, prefixed with ASCII "NO"
 *   0xFFE3  handle 0x0024  WRITE   — password unlock (default "dx1234")
 *
 * The command framing (password, "NO" prefix, notify characteristic) was
 * reverse-engineered from HCI captures. The exact ACC *payload layout* was not
 * confirmed on-air, so the decode below is PROVISIONAL: it reads a little-endian
 * int16 X/Y/Z triplet at a fixed offset. If a real capture shows a different
 * header/offset/scale, adjust the three constants — nothing else needs to move.
 */

const uuid16 = (short: string): string => `0000${short}-0000-1000-8000-00805f9b34fb`;

export const CP27_SERVICE_UUID = uuid16('ffe0');
export const CP27_NOTIFY_CHAR_UUID = uuid16('ffe1');
export const CP27_CMD_CHAR_UUID = uuid16('ffe2');
export const CP27_PASSWORD_CHAR_UUID = uuid16('ffe3');

/** Advertised service-data UUID that identifies a CP27 (device-info frame). */
export const CP27_DEVICE_INFO_SD = 'feab';
/** Advertised name prefix. */
export const CP27_NAME_PREFIX = 'CP27';

/** Default beacon password (writable to 0xFFE3 to unlock config/streaming). */
export const CP27_DEFAULT_PASSWORD = 'dx1234';
/** ASCII prefix every command on 0xFFE2 carries. */
export const CP27_CMD_PREFIX = 'NO';

// --- ACC frame layout (PROVISIONAL — see file header) ---------------------

/** Byte offset of the X int16 within the 0xFFE1 notification payload. */
export const CP27_ACC_OFFSET = 0;
/** Raw counts per 1 g. DA14531 firmwares commonly report milli-g. */
export const CP27_ACC_LSB_PER_G = 1000;
const ACC_BYTES = 6; // int16 X + Y + Z

/**
 * Decode a CP27 0xFFE1 notification (base64) into an accel reading, or null if
 * the payload is too short to contain the X/Y/Z triplet.
 */
export function decodeCp27AccFrame(base64: string): AccelReading | null {
  const bytes = base64ToBytes(base64);
  if (bytes.length < CP27_ACC_OFFSET + ACC_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const o = CP27_ACC_OFFSET;
  return {
    x: view.getInt16(o, true) / CP27_ACC_LSB_PER_G, // little-endian (Cortex-M0)
    y: view.getInt16(o + 2, true) / CP27_ACC_LSB_PER_G,
    z: view.getInt16(o + 4, true) / CP27_ACC_LSB_PER_G,
  };
}

const clampInt16 = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v)));

/**
 * Encode an ACC frame to base64 in the same provisional layout. Used only by
 * the round-trip test so the decoder is exercised against a known frame.
 */
export function encodeCp27AccFrame(reading: AccelReading): string {
  const bytes = new Uint8Array(CP27_ACC_OFFSET + ACC_BYTES);
  const view = new DataView(bytes.buffer);
  const o = CP27_ACC_OFFSET;
  view.setInt16(o, clampInt16(reading.x * CP27_ACC_LSB_PER_G), true);
  view.setInt16(o + 2, clampInt16(reading.y * CP27_ACC_LSB_PER_G), true);
  view.setInt16(o + 4, clampInt16(reading.z * CP27_ACC_LSB_PER_G), true);
  return bytesToBase64(bytes);
}
