import { type Device, ScanMode } from 'react-native-ble-plx';

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

/**
 * Backoff for re-arming a scan that failed to start.
 *
 * Without this a single failed start was terminal for the process. The scan is
 * begun once, by the first subscriber; if that attempt rejected — permissions
 * not granted yet on a first run, or the adapter simply off — nothing ever tried
 * again. Every rod then read "tag not responding" forever while the app happily
 * reported that it was scanning.
 *
 * Retrying is not busywork: the conditions that make a start fail are exactly
 * the ones a user fixes WHILE the app is open (granting the permission,
 * switching Bluetooth on), and nothing else tells us they did.
 */
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 30_000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = RETRY_BASE_MS;

/**
 * Liveness watchdog for a scan that reports itself alive.
 *
 * `scanning` was set optimistically and only ever cleared by an explicit error,
 * so a scan that died SILENTLY left the broker certain it was still running:
 * every later subscribe hit the `if (scanning) return` guard, every retry was
 * skipped, and the app reported that it was scanning while the radio delivered
 * nothing. Only a direct connection still worked, which is exactly how it was
 * reported — the tag unreachable by scan, yet "reachable" when tested.
 *
 * Android kills scans silently in more than one way, and none of them call the
 * error callback: an app exceeding five scan starts in thirty seconds is simply
 * blocked, and a backgrounded app in a restricted standby bucket has its scans
 * suspended and not resumed. Both are ordinary, and neither is observable except
 * by noticing that nothing is arriving.
 *
 * So liveness is measured, not asserted. An advertisement from ANY device is
 * proof; going quiet for this long while claiming to scan is proof of the
 * opposite.
 */
const SCAN_STALL_MS = 25_000;

/**
 * Floor on how often the watchdog may restart the scan.
 *
 * The cure has to respect the disease: Android throttles an app that starts more
 * than five scans in thirty seconds, so a watchdog restarting eagerly would
 * cause exactly the silent block it exists to recover from.
 */
const MIN_RESTART_INTERVAL_MS = 30_000;

/** How often liveness is checked while a scan is believed to be running. */
const WATCHDOG_TICK_MS = 5_000;

let lastAdvertMs = 0;
let lastRestartMs = 0;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;

function stopWatchdog(): void {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = null;
}

function startWatchdog(): void {
  if (watchdogTimer !== null) return;
  watchdogTimer = setInterval(checkScanAlive, WATCHDOG_TICK_MS);
}

/**
 * Restart a scan the platform has stopped delivering to.
 *
 * Stops first: the old client is still registered as far as the platform is
 * concerned, and starting a second without releasing it is how an app reaches
 * the throttle limit.
 */
function restartScan(reason: string): void {
  lastRestartMs = Date.now();
  bleLog(`scanBroker: restarting a scan that reports itself alive — ${reason}`);
  try {
    getBleManager().stopDeviceScan();
  } catch {
    /* manager may already be torn down; the start below reports the real fault */
  }
  scanning = false;
  startUnderlyingScan();
}

/** Restart the scan if it claims to be running but nothing is arriving. */
export function checkScanAlive(): void {
  if (!scanning || listeners.size === 0) return;

  const now = Date.now();
  const quietMs = now - lastAdvertMs;
  if (quietMs < SCAN_STALL_MS) return;
  if (now - lastRestartMs < MIN_RESTART_INTERVAL_MS) return;

  restartScan(`nothing heard from any device for ${Math.round(quietMs / 1000)} s`);
}

function cancelRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryDelay = RETRY_BASE_MS;
}

/** Try again later, backing off, for as long as anyone is still listening. */
function scheduleRetry(): void {
  if (retryTimer !== null || listeners.size === 0) return;
  const delay = retryDelay;
  // Capped rather than unbounded: an adapter that is off may be switched on at
  // any moment, and a rod that stopped being watched is the failure this app
  // exists to prevent — so it keeps checking, just not busily.
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (listeners.size > 0) startUnderlyingScan();
  }, delay);
}

/** Record a failed start and line up another attempt. */
function failScan(message: string): void {
  scanning = false;
  lastError = message;
  bleLog('scanBroker: scan failed:', message);
  scheduleRetry();
}

function startUnderlyingScan(): void {
  if (scanning) return;
  scanning = true;
  lastError = null;
  // Quiet is measured from the start, so a scan that never delivers anything is
  // judged on the same clock as one that stops mid-session.
  lastAdvertMs = Date.now();
  startWatchdog();
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
    // scanMode is ANDROID-ONLY and defaults to LowPower, which cannot work with
    // a tag this slow. LowPower scans a 512 ms window every 5120 ms — a 10% duty
    // cycle — and the CP27 advertises a motion frame about every 3.6 s, so
    // roughly nine adverts in ten land while the radio is not listening. That
    // yields ~0.028 Hz against the 0.17 Hz arming needs: the rod could never arm
    // and signal-lost would fire continuously. Balanced (25%) does not clear the
    // bar either. Only LowLatency, which listens continuously, does.
    //
    // It also explains why the tag appeared only INTERMITTENTLY while the
    // vendor app always saw it. Android merges concurrent scan clients onto one
    // radio schedule, so while some other app scans aggressively our LowPower
    // client is carried along and everything works; the moment that app stops,
    // the merged duty cycle collapses back to 10% and the same tag, still
    // advertising, goes unseen.
    //
    // The cost is real: this is the highest-drain scan mode and Android asks
    // that it be used in the foreground. That is the trade this app exists to
    // make — a bite alarm that misses advertisements is not a bite alarm.
    //
    // allowDuplicates is iOS-only. Android reports every advertisement through
    // the default CALLBACK_TYPE_ALL_MATCHES, which is what the detector needs.
    { allowDuplicates: true, scanMode: ScanMode.LowLatency },
    (error, device) => {
      if (error) {
        // Also unlatch here: a mid-session adapter-off arrives this way, and
        // leaving `scanning` true would block every future restart.
        failScan(error.message);
        return;
      }
      if (!device) return;
      // An advertisement is the only proof the scan actually works, so the
      // backoff resets here rather than on a start that merely did not reject.
      // The watchdog reads the same signal for the same reason.
      retryDelay = RETRY_BASE_MS;
      lastAdvertMs = Date.now();
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
    failScan(e instanceof Error ? e.message : 'Scan could not be started.');
  });
}

function stopUnderlyingScan(): void {
  // Cancel unconditionally: a retry may be pending for a scan that never
  // started, and letting it fire after the last listener left would resurrect a
  // scan nobody is watching.
  cancelRetry();
  stopWatchdog();
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
  // Attempted on EVERY subscribe, not only the first. startUnderlyingScan
  // no-ops when a scan is already running, so this costs nothing in the normal
  // case — and it means a subscriber arriving after a failed start revives the
  // scan instead of joining a dead one.
  startUnderlyingScan();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    listeners.delete(listener);
    if (listeners.size === 0) stopUnderlyingScan();
  };
}

/**
 * Re-arm the shared scan if it is not currently running.
 *
 * For callers that are already subscribed and have reason to believe conditions
 * changed — permissions just granted, or the app returned to the foreground.
 * Without this they had no way to recover: they hold a live subscription, so
 * subscribing again was not an option, and nothing else restarts the scan.
 */
export function ensureScanning(): void {
  if (listeners.size === 0) return;
  // Verify rather than assume. This is the hook a caller reaches for when
  // something looks wrong, and the failure it most often needs to fix is a scan
  // that believes it is running — so a plain no-op when `scanning` is true is
  // precisely the wrong answer.
  checkScanAlive();
  startUnderlyingScan();
}

/** Last platform scan error, if any. Cleared when a scan (re)starts. */
export function getScanError(): string | null {
  return lastError;
}

/** Diagnostics for tests and the BLE debug overlay. */
export function scanBrokerState(): {
  scanning: boolean;
  listeners: number;
  /** ms since the last advertisement from any device, null if none yet. */
  quietMs: number | null;
  lastError: string | null;
} {
  return {
    scanning,
    listeners: listeners.size,
    quietMs: lastAdvertMs === 0 ? null : Date.now() - lastAdvertMs,
    lastError,
  };
}

/** Test seam: drop all listeners and stop the scan. */
export function resetScanBroker(): void {
  listeners.clear();
  stopUnderlyingScan();
  cancelRetry();
  stopWatchdog();
  lastError = null;
  lastAdvertMs = 0;
  lastRestartMs = 0;
}
