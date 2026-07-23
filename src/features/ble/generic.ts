import { base64ToBytes, bytesToBase64 } from './bytes';
import type { AccelReading } from './GattSensorClient';

/**
 * Generic BLE accelerometer decoder.
 *
 * For any peripheral (DIY nRF/ESP32 board, off-the-shelf IMU, etc.) that
 * streams acceleration as the most common wire layout: three little-endian
 * signed 16-bit integers X, Y, Z at the start of the notification, in milli-g.
 * This is the default DIY/Arduino IMU convention. Devices that differ only in
 * scale or endianness can be supported by swapping this decoder in the config.
 */

/** Raw counts per 1 g (milli-g is the common default). */
export const GENERIC_ACC_LSB_PER_G = 1000;
const ACC_BYTES = 6; // int16 X + Y + Z

/** Decode 3×int16-LE (milli-g) into a reading, or null if too short. */
export function decodeGenericAccel(base64: string): AccelReading | null {
  const bytes = base64ToBytes(base64);
  if (bytes.length < ACC_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    x: view.getInt16(0, true) / GENERIC_ACC_LSB_PER_G,
    y: view.getInt16(2, true) / GENERIC_ACC_LSB_PER_G,
    z: view.getInt16(4, true) / GENERIC_ACC_LSB_PER_G,
  };
}

const clampInt16 = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v)));

/** Encode a reading in the same layout (used by the round-trip test). */
export function encodeGenericAccel(reading: AccelReading): string {
  const bytes = new Uint8Array(ACC_BYTES);
  const view = new DataView(bytes.buffer);
  view.setInt16(0, clampInt16(reading.x * GENERIC_ACC_LSB_PER_G), true);
  view.setInt16(2, clampInt16(reading.y * GENERIC_ACC_LSB_PER_G), true);
  view.setInt16(4, clampInt16(reading.z * GENERIC_ACC_LSB_PER_G), true);
  return bytesToBase64(bytes);
}
