import type { Device } from 'react-native-ble-plx';

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
const { subscribeToScan, scanBrokerState, resetScanBroker, getScanError } = broker;

/** Fire the callback the broker handed to startDeviceScan. */
function emit(device: Partial<Device> | null, error: { message: string } | null = null): void {
  const cb = mockStartDeviceScan.mock.calls.at(-1)?.[2];
  cb?.(error, device);
}

const fakeDevice = (id: string): Partial<Device> => ({ id, rssi: -50 });

beforeEach(() => {
  resetScanBroker();
  mockStartDeviceScan.mockClear();
  mockStopDeviceScan.mockClear();
});

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
