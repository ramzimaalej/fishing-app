/**
 * Small byte / base64 helpers shared by the BLE codecs and GATT clients.
 *
 * react-native-ble-plx exchanges characteristic + advertisement payloads as
 * base64 strings, so every sensor client converts to/from raw bytes here.
 * Works under both Hermes (global atob/btoa) and Node (Buffer) for tests.
 */

/** Decode a base64 string to raw bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin =
    typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode raw bytes to a base64 string. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
}

/** Encode an ASCII/Latin-1 string (e.g. a device command) to base64. */
export function asciiToBase64(text: string): string {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytesToBase64(bytes);
}

/** Lowercase hex string of the bytes, no separators (handy for logs/tests). */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, '0');
  return hex;
}
