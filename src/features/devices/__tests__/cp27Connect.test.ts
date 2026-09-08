/**
 * The autoConnect deadline, and the orphan it can leave behind.
 *
 * Racing a promise does not cancel the loser. When the deadline wins, the
 * underlying connectToDevice is still outstanding and may land seconds later —
 * and a connection nobody is holding is worse than no connection at all,
 * because a connected peripheral STOPS ADVERTISING. The tag then vanishes from
 * every scan while answering instantly when tested, which is exactly how the
 * fault was reported from the field.
 */

const mockConnectToDevice = jest.fn();
const mockCancelDeviceConnection = jest.fn();

jest.mock('../../ble/bleManager', () => ({
  getBleManager: () => ({
    connectToDevice: mockConnectToDevice,
    cancelDeviceConnection: mockCancelDeviceConnection,
  }),
  ensureBlePermissions: () => Promise.resolve(true),
  waitForPoweredOn: () => Promise.resolve(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const commands = require('../cp27Commands') as typeof import('../cp27Commands');
const { readBattery, AUTO_CONNECT_DEADLINE_MS } = commands;

beforeEach(() => {
  jest.useFakeTimers();
  mockConnectToDevice.mockReset();
  mockCancelDeviceConnection.mockReset();
  mockCancelDeviceConnection.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

it('cancels a connection that lands after the deadline has passed', async () => {
  // The tag stays silent past the deadline, then wakes and the controller
  // completes the standing request. Nothing is waiting for it any more.
  let land: (device: { id: string }) => void = () => {};
  mockConnectToDevice.mockReturnValue(
    new Promise((resolve) => {
      land = resolve as typeof land;
    }),
  );

  const pending = readBattery('48:87:2D:9D:C0:0C', { autoConnect: true });

  // Async form: the deadline timer is not even registered until the permission
  // and power-on awaits have settled, so advancing the clock synchronously would
  // move past a timeout that does not exist yet.
  await jest.advanceTimersByTimeAsync(AUTO_CONNECT_DEADLINE_MS + 1_000);
  const result = await pending;
  expect(result.ok).toBe(false);

  // The deadline cancels the PENDING request, and that call would satisfy any
  // assertion made on arguments alone. Cleared here so what follows can only be
  // the orphan handler — without this the test passes with the handler deleted,
  // which is how it was first written and what mutation testing caught.
  mockCancelDeviceConnection.mockClear();

  // Now the orphan arrives, long after anything is waiting for it.
  land({ id: '48:87:2D:9D:C0:0C' });
  await Promise.resolve();
  await Promise.resolve();

  // It must be hung up on. Left open, the tag stops advertising and no scan can
  // see it again for as long as it lives.
  expect(mockCancelDeviceConnection).toHaveBeenCalledWith('48:87:2D:9D:C0:0C');
});

it('does not cancel a connection that lands in time', async () => {
  // withConnection hangs up through device.cancelConnection() in its finally —
  // a different call from the manager-level cancel used to kill an orphan. The
  // distinction is the whole assertion: an in-time connection must be closed the
  // ordinary way and must NOT also be swept up by the orphan handler.
  const cancelConnection = jest.fn().mockResolvedValue(undefined);
  mockConnectToDevice.mockResolvedValue({
    id: '48:87:2D:9D:C0:0C',
    cancelConnection,
    discoverAllServicesAndCharacteristics: () => Promise.resolve(),
    writeCharacteristicWithResponseForService: () => Promise.resolve(),
    services: () => Promise.resolve([]),
    characteristicsForService: () => Promise.resolve([]),
    readCharacteristicForService: () => Promise.reject(new Error('no such service')),
  });

  await readBattery('48:87:2D:9D:C0:0C', { autoConnect: true });

  expect(cancelConnection).toHaveBeenCalledTimes(1);
  expect(mockCancelDeviceConnection).not.toHaveBeenCalled();
});
