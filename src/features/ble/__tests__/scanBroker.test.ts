import { type Device, ScanMode } from 'react-native-ble-plx';

/**
 * The broker exists to stop concurrent rods fighting over the one global scan,
 * so these tests assert exactly that: one underlying scan no matter how many
 * subscribers, and it survives until the LAST one leaves.
 */

// Must be `mock`-prefixed: jest hoists the factory above these declarations.
const mockStartDeviceScan = jest.fn();
const mockStopDeviceScan = jest.fn();

jest.mock('../bleManager', () => ({
  getBleManager: () => ({
    startDeviceScan: mockStartDeviceScan,
    stopDeviceScan: mockStopDeviceScan,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const broker = require('../scanBroker') as typeof import('../scanBroker');
const { subscribeToScan, scanBrokerState, resetScanBroker, getScanError, ensureScanning } =
  broker;

/** Mirrors the broker's own watchdog constants. */
const SCAN_STALL_MS = 25_000;
const WATCHDOG_TICK_MS = 5_000;
const MIN_RESTART_INTERVAL_MS = 30_000;

/** Fire the callback the broker handed to startDeviceScan. */
function emit(device: Partial<Device> | null, error: { message: string } | null = null): void {
  const cb = mockStartDeviceScan.mock.calls.at(-1)?.[2];
  cb?.(error, device);
}

const fakeDevice = (id: string): Partial<Device> => ({ id, rssi: -50 });

beforeEach(() => {
  jest.useFakeTimers();
  resetScanBroker();
  mockStartDeviceScan.mockClear();
  mockStopDeviceScan.mockClear();
  mockStartDeviceScan.mockReturnValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

/** Make the next startDeviceScan reject, as an adapter-off or ungranted scan does. */
function rejectNextStart(message: string): void {
  mockStartDeviceScan.mockReturnValueOnce(Promise.reject(new Error(message)));
}

/** Let the rejection handler run, then advance past the backoff. */
async function advancePastRetry(ms: number): Promise<void> {
  await Promise.resolve();
  jest.advanceTimersByTime(ms);
  await Promise.resolve();
}

describe('scanBroker refcounting', () => {
  it('starts the underlying scan on the first subscriber', () => {
    subscribeToScan(() => {});
    expect(mockStartDeviceScan).toHaveBeenCalledTimes(1);
    expect(scanBrokerState()).toEqual({ scanning: true, listeners: 1 });
  });

  it('does NOT start a second scan for further subscribers', () => {
    subscribeToScan(() => {});
    subscribeToScan(() => {});
    subscribeToScan(() => {});
    // The whole point: react-native-ble-plx only has one scan to give.
    expect(mockStartDeviceScan).toHaveBeenCalledTimes(1);
    expect(scanBrokerState().listeners).toBe(3);
  });

  it('keeps scanning while any subscriber remains', () => {
    const offA = subscribeToScan(() => {});
    subscribeToScan(() => {});
    offA();
    // Rod A disarming must not deafen rod B — the original bug.
    expect(mockStopDeviceScan).not.toHaveBeenCalled();
    expect(scanBrokerState()).toEqual({ scanning: true, listeners: 1 });
  });

  it('stops only when the last subscriber leaves', () => {
    const offA = subscribeToScan(() => {});
    const offB = subscribeToScan(() => {});
    offA();
    offB();
    expect(mockStopDeviceScan).toHaveBeenCalledTimes(1);
    expect(scanBrokerState()).toEqual({ scanning: false, listeners: 0 });
  });

  it('restarts cleanly after going idle', () => {
    subscribeToScan(() => {})();
    subscribeToScan(() => {});
    expect(mockStartDeviceScan).toHaveBeenCalledTimes(2);
    expect(scanBrokerState().scanning).toBe(true);
  });

  it('treats a repeated unsubscribe as a no-op', () => {
    const off = subscribeToScan(() => {});
    subscribeToScan(() => {});
    off();
    off();
    off();
    // A double-release must not decrement past the real count and kill the scan.
    expect(scanBrokerState().listeners).toBe(1);
    expect(mockStopDeviceScan).not.toHaveBeenCalled();
  });
});

describe('scanBroker fan-out', () => {
  it('delivers every advertisement to every subscriber', () => {
    const a = jest.fn();
    const b = jest.fn();
    subscribeToScan(a);
    subscribeToScan(b);

    emit(fakeDevice('AA'));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0]![0]).toMatchObject({ id: 'AA' });
  });

  it('stops delivering to an unsubscribed listener', () => {
    const a = jest.fn();
    const off = subscribeToScan(a);
    subscribeToScan(() => {});
    off();
    emit(fakeDevice('AA'));
    expect(a).not.toHaveBeenCalled();
  });

  it('keeps fanning out when one subscriber throws', () => {
    const bad = jest.fn(() => {
      throw new Error('boom');
    });
    const good = jest.fn();
    subscribeToScan(bad);
    subscribeToScan(good);

    expect(() => emit(fakeDevice('AA'))).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('survives a subscriber unsubscribing mid-dispatch', () => {
    const later = jest.fn();
    let off: (() => void) | null = null;
    // Removing a listener during iteration must not skip the next one.
    off = subscribeToScan(() => off?.());
    subscribeToScan(later);

    expect(() => emit(fakeDevice('AA'))).not.toThrow();
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('ignores null devices', () => {
    const a = jest.fn();
    subscribeToScan(a);
    emit(null);
    expect(a).not.toHaveBeenCalled();
  });

  it('records a scan error without notifying listeners', () => {
    const a = jest.fn();
    subscribeToScan(a);
    emit(null, { message: 'BluetoothLE is powered off' });
    expect(a).not.toHaveBeenCalled();
    expect(getScanError()).toBe('BluetoothLE is powered off');
  });

  it('clears a stale error when a new scan starts', () => {
    const off = subscribeToScan(() => {});
    emit(null, { message: 'transient' });
    expect(getScanError()).toBe('transient');
    off();
    subscribeToScan(() => {});
    expect(getScanError()).toBeNull();
  });
});

describe('scanBroker recovery from a failed start', () => {
  // The bug: the scan is started once, by the first subscriber. If that attempt
  // rejected, nothing ever tried again — every rod read "tag not responding"
  // for the lifetime of the process while the app reported it was scanning.
  it('does not stay latched as scanning when the start rejects', async () => {
    rejectNextStart('BluetoothLE is powered off');
    subscribeToScan(() => {});
    await Promise.resolve();

    expect(scanBrokerState().scanning).toBe(false);
    expect(getScanError()).toBe('BluetoothLE is powered off');
  });

  it('retries on its own after a failed start', async () => {
    rejectNextStart('permission not granted');
    subscribeToScan(() => {});
    expect(mockStartDeviceScan).toHaveBeenCalledTimes(1);

    await advancePastRetry(2_000);

    // The user granting the permission, or switching Bluetooth on, happens while
    // the app is open and tells us nothing — so the broker has to keep asking.
    expect(mockStartDeviceScan).toHaveBeenCalledTimes(2);
    expect(scanBrokerState().scanning).toBe(true);
  });

  it('keeps retrying, backing off, while a start keeps failing', async () => {
    // Both attempts queued up front: the retry fires from a timer, so a
    // rejection armed after it has run would arrive too late to be used.
    rejectNextStart('off');
    rejectNextStart('still off');
    subscribeToScan(() => {});

    await advancePastRetry(2_000); // 2nd attempt, also rejects
    await advancePastRetry(4_000); // 3rd attempt, at double the delay

    expect(mockStartDeviceScan).toHaveBeenCalledTimes(3);
    // The delay doubles rather than hammering the adapter, and the third
    // attempt succeeded, so the scan is live again.
    expect(scanBrokerState().scanning).toBe(true);
  });

  it('stops retrying once the last subscriber leaves', async () => {
    rejectNextStart('off');
    const off = subscribeToScan(() => {});
    await Promise.resolve();
    off();

    jest.advanceTimersByTime(60_000);
    // Nobody is listening, so reviving the scan would be pure battery cost.
    expect(mockStartDeviceScan).toHaveBeenCalledTimes(1);
  });

  it('revives a dead scan when another subscriber arrives', async () => {
    rejectNextStart('off');
    subscribeToScan(() => {});
    await Promise.resolve();
    expect(scanBrokerState().scanning).toBe(false);

    subscribeToScan(() => {});

    // Previously the second subscriber just joined a scan that was not running:
    // the start only ever fired for the first.
    expect(mockStartDeviceScan).toHaveBeenCalledTimes(2);
    expect(scanBrokerState().scanning).toBe(true);
  });

  it('lets an already-subscribed caller re-arm the scan', async () => {
    rejectNextStart('permission not granted');
    subscribeToScan(() => {});
    await Promise.resolve();

    // This is the tags screen's path: it holds a subscription already, so it
    // cannot subscribe again, and before ensureScanning it had no way back.
    ensureScanning();

    expect(mockStartDeviceScan).toHaveBeenCalledTimes(2);
    expect(scanBrokerState().scanning).toBe(true);
  });

  it('is a no-op to re-arm a scan that is already running', () => {
    subscribeToScan(() => {});
    ensureScanning();
    ensureScanning();
    expect(mockStartDeviceScan).toHaveBeenCalledTimes(1);
  });

  it('does not re-arm when nothing is listening', () => {
    ensureScanning();
    expect(mockStartDeviceScan).not.toHaveBeenCalled();
  });

  it('recovers from an adapter switched off mid-session', async () => {
    subscribeToScan(() => {});
    expect(scanBrokerState().scanning).toBe(true);

    // A mid-session failure arrives through the callback, not the promise.
    emit(null, { message: 'BluetoothLE is powered off' });
    expect(scanBrokerState().scanning).toBe(false);

    await advancePastRetry(2_000);
    expect(mockStartDeviceScan).toHaveBeenCalledTimes(2);
  });
});

describe('scan mode', () => {
  it('scans at the highest duty cycle, because the tag advertises too slowly for less', () => {
    // Android defaults to LowPower: a 512 ms window every 5120 ms, so about one
    // advertisement in ten is heard. The CP27 sends a motion frame every ~3.6 s,
    // which that reduces to ~0.028 Hz against the 0.17 Hz arming needs — the rod
    // could never arm. Worse, it fails INTERMITTENTLY: Android merges concurrent
    // scan clients, so the tag is found while some other app happens to be
    // scanning hard and vanishes when it stops.
    //
    // Asserted because a revert to the default is invisible — no error, no log,
    // just a tag that is sometimes not there.
    subscribeToScan(() => {});

    const options = mockStartDeviceScan.mock.calls.at(-1)?.[1];
    expect(options.scanMode).toBe(ScanMode.LowLatency);
  });
});

describe('a scan that has silently died', () => {
  /**
   * The failure this exists for, reported from the field as: the tag cannot be
   * found by scanning, but testing it from My Tags says it is reachable.
   *
   * `scanning` was set optimistically and cleared only by an explicit error, so
   * a scan Android had stopped without telling us left the broker certain it was
   * running — every subscribe no-opped, every retry was skipped, and only a
   * direct connection still worked. Android stops scans silently in at least two
   * ordinary ways: throttling an app past five starts in thirty seconds, and
   * suspending scans for a backgrounded app in a restricted standby bucket.
   */
  it('restarts once nothing has arrived for long enough', () => {
    subscribeToScan(() => {});
    expect(mockStartDeviceScan).toHaveBeenCalledTimes(1);

    // The platform stops delivering. No error, no callback — just silence.
    jest.advanceTimersByTime(SCAN_STALL_MS + WATCHDOG_TICK_MS);

    expect(mockStopDeviceScan).toHaveBeenCalled();
    expect(mockStartDeviceScan).toHaveBeenCalledTimes(2);
  });

  it('leaves a scan that is delivering alone', () => {
    subscribeToScan(() => {});

    // An advertisement every few seconds, as any populated room produces.
    for (let i = 0; i < 10; i += 1) {
      jest.advanceTimersByTime(5_000);
      emit(fakeDevice('aa:bb'));
    }

    expect(mockStartDeviceScan).toHaveBeenCalledTimes(1);
  });

  it('will not restart often enough to trip the throttle it recovers from', () => {
    // Android blocks an app that starts more than five scans in thirty seconds,
    // and that block is itself silent — so a watchdog restarting eagerly would
    // cause the exact fault it exists to repair.
    subscribeToScan(() => {});
    jest.advanceTimersByTime(SCAN_STALL_MS + WATCHDOG_TICK_MS);
    expect(mockStartDeviceScan).toHaveBeenCalledTimes(2);

    // Still silent, and the watchdog keeps ticking.
    jest.advanceTimersByTime(MIN_RESTART_INTERVAL_MS - WATCHDOG_TICK_MS * 2);
    expect(mockStartDeviceScan).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(MIN_RESTART_INTERVAL_MS);
    expect(mockStartDeviceScan).toHaveBeenCalledTimes(3);
  });

  it('does not restart when nobody is listening', () => {
    const off = subscribeToScan(() => {});
    off();
    mockStartDeviceScan.mockClear();

    jest.advanceTimersByTime(SCAN_STALL_MS * 3);

    expect(mockStartDeviceScan).not.toHaveBeenCalled();
  });

  it('ensureScanning revives a dead scan instead of trusting the flag', () => {
    // Models the case the watchdog alone cannot cover: a BACKGROUNDED app. Its
    // JS timers are frozen, so the interval never ticks, while the wall clock
    // and Android's scan suspension carry on regardless. On return to the
    // foreground the interval has not run and the flag still says "scanning" —
    // answering "already scanning" here is the one response that cannot help.
    subscribeToScan(() => {});
    mockStartDeviceScan.mockClear();

    jest.setSystemTime(Date.now() + SCAN_STALL_MS + 1_000);
    ensureScanning();

    expect(mockStartDeviceScan).toHaveBeenCalledTimes(1);
  });
});

