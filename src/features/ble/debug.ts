import { base64ToBytes, bytesToHex } from './bytes';

/**
 * Master switch for verbose BLE tracing. When true, the scan/connect/notify
 * lifecycle and every raw characteristic value is logged to the Metro console
 * (visible in `expo start`). Flip to false to silence. Diagnostic aid only —
 * not shipped-on behaviour.
 */
export const BLE_DEBUG = false;

// eslint-disable-next-line no-console
const sink = console.log;

/** Prefixed logger so BLE lines are greppable ("[ble] …") in the Metro log. */
export function bleLog(...args: unknown[]): void {
  if (!BLE_DEBUG) return;
  sink('[ble]', ...args);
}

/** base64 characteristic/adv value → lowercase hex, for readable packet dumps. */
export function b64ToHex(base64: string): string {
  try {
    return bytesToHex(base64ToBytes(base64));
  } catch {
    return '<unparseable>';
  }
}
