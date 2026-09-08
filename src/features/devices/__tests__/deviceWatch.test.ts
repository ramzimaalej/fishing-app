/**
 * The watch that keeps a rod knowable while nothing is armed.
 *
 * Arming refuses a rod whose tag has not been heard, and only this watch listens
 * while nothing is armed — so if it stops listening without noticing, the app
 * enters a loop it cannot leave: every rod reads "its tag is not responding",
 * and the only thing that could clear that is the listening it is no longer
 * doing. Observed on the bench as 45 scans started, 45 stopped, none running,
 * with the app in the foreground and a tag advertising at -40 dBm.
 */
// deviceStore persists through AsyncStorage, which has no native module here.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: () => Promise.resolve(null),
  setItem: () => Promise.resolve(),
  removeItem: () => Promise.resolve(),
}));

const mockSubscribeToScan = jest.fn();
const mockEnsureScanning = jest.fn();
const mockScanBrokerState = jest.fn();

jest.mock('@/features/ble/scanBroker', () => ({
  subscribeToScan: mockSubscribeToScan,
  ensureScanning: mockEnsureScanning,
  scanBrokerState: mockScanBrokerState,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const store = require('../deviceStore') as typeof import('../deviceStore');
const { startDeviceWatch, stopDeviceWatch } = store;

beforeEach(() => {
  jest.clearAllMocks();
  mockSubscribeToScan.mockReturnValue(() => {});
  mockScanBrokerState.mockReturnValue({ scanning: true, listeners: 1 });
  stopDeviceWatch();
  jest.clearAllMocks();
});

// deviceStore keeps a publish timer alive while the watch runs; without this the
// worker never exits and the whole suite hangs rather than fails.
afterAll(() => {
  stopDeviceWatch();
});

it('subscribes once while the subscription is genuinely live', () => {
  startDeviceWatch();
  expect(mockSubscribeToScan).toHaveBeenCalledTimes(1);

  startDeviceWatch();
  expect(mockSubscribeToScan).toHaveBeenCalledTimes(1);
  // Still worth re-arming the radio: a live subscription can sit on a dead scan.
  expect(mockEnsureScanning).toHaveBeenCalled();
});

it('re-subscribes when the handle is stale and no listener remains', () => {
  startDeviceWatch();
  expect(mockSubscribeToScan).toHaveBeenCalledTimes(1);

  // The broker has no listeners any more, however confident this module's
  // unsubscribe handle looks. Trusting the handle here is what strands the app.
  mockScanBrokerState.mockReturnValue({ scanning: false, listeners: 0 });
  startDeviceWatch();

  expect(mockSubscribeToScan).toHaveBeenCalledTimes(2);
});
