import type { Device } from 'react-native-ble-plx';

import { getBleManager } from './bleManager';
import { bleLog } from './debug';

/**
 * Refcounted, shared BLE scan.
 *
 * react-native-ble-plx exposes exactly ONE global scan. Before multi-rod that
 * didn't matter — a single broadcast client owned it outright. With several
 * broadcast rods armed at once, each client calling startDeviceScan/
 * stopDeviceScan directly would break in two ways:
 *
 *   1. the second startDeviceScan either errors or silently replaces the first
 *      client's callback, so one rod goes deaf;
 *   2. the first rod to disarm calls stopDeviceScan() and kills scanning for
 *      every other rod still fishing.
 *
 * So nobody touches the scan directly any more. Subscribers register a listener,
 * the broker keeps the single underlying scan alive while at least one listener
 * remains, and every advertisement is fanned out to all of them. Each subscriber
 * filters for its own device.
 */

type ScanListener = (device: Device) => void;

const listeners = new Set<ScanListener>();
let scanning = false;
/** Set when the platform scan fails, so late subscribers learn about it too. */
let lastError: string | null = null;

function startUnderlyingScan(): void {
  if (scanning) return;
  scanning = true;
  lastError = null;
  bleLog(`scanBroker: starting shared scan (${listeners.size} listener(s))`);

  // Scan ALL devices and let subscribers match: the beacons we care about carry
  // their payload in service DATA rather than the advertised service UUID list,
  // which a UUID scan filter would silently miss.
  // startDeviceScan RETURNS A PROMISE, and adapter-off / unauthorised / already-
  // scanning reject it rather than reporting through the callback. Dropping it
  // left `scanning` latched true on a scan that never started, so every later
  // subscribe silently no-opped and BLE was dead for the process lifetime — with
  // the error surfacing only as an unhandled rejection.
  const started = getBleManager().startDeviceScan(
    null,
    { allowDuplicates: true },
    (error, device) => {
      if (error) {
        // Also unlatch here: a mid-session adapter-off arrives this way, and
        // leaving `scanning` true would block every future restart.
        scanning = false;
        lastError = error.message;
        bleLog('scanBroker: scan error:', error.message);
        return;
      }
      if (!device) return;
      // Copy first: a listener unsubscribing mid-dispatch must not perturb this
      // iteration.
      for (const l of [...listeners]) {
        try {
          l(device);
        } catch {
          /* one bad subscriber must never stop the fan-out */
        }
      }
    },
  ) as unknown as Promise<void> | undefined;

  void Promise.resolve(started).catch((e: unknown) => {
    scanning = false;
    lastError = e instanceof Error ? e.message : 'Scan could not be started.';
    bleLog('scanBroker: start rejected:', lastError);
  });
}

function stopUnderlyingScan(): void {
  if (!scanning) return;
  scanning = false;
  bleLog('scanBroker: stopping shared scan (no listeners left)');
  try {
    getBleManager().stopDeviceScan();
  } catch {
    /* manager may already be torn down */
  }
}

/**
 * Subscribe to advertisements. Starts the shared scan on the first subscriber
 * and stops it when the last one unsubscribes. The returned function is
 * idempotent — calling it twice will not decrement the count twice.
 */
export function subscribeToScan(listener: ScanListener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) startUnderlyingScan();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    listeners.delete(listener);
    if (listeners.size === 0) stopUnderlyingScan();
  };
}

/** Last platform scan error, if any. Cleared when a scan (re)starts. */
export function getScanError(): string | null {
  return lastError;
}

/** Diagnostics for tests and the BLE debug overlay. */
export function scanBrokerState(): { scanning: boolean; listeners: number } {
  return { scanning, listeners: listeners.size };
}

/** Test seam: drop all listeners and stop the scan. */
export function resetScanBroker(): void {
  listeners.clear();
  stopUnderlyingScan();
  lastError = null;
}
