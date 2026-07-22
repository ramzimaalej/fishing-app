/* eslint-disable @typescript-eslint/no-empty-function */
// Global Jest setup. Native modules are mocked here so unit tests for pure
// logic (filters, detector, moon phase, fish activity) run in plain Node.

jest.mock('react-native-ble-plx', () => ({
  BleManager: jest.fn(() => ({
    startDeviceScan: jest.fn(),
    stopDeviceScan: jest.fn(),
    connectToDevice: jest.fn(),
    onStateChange: jest.fn(),
    destroy: jest.fn(),
  })),
  State: { PoweredOn: 'PoweredOn', PoweredOff: 'PoweredOff' },
}));

jest.mock('@react-native-firebase/app', () => ({}), { virtual: true });
jest.mock('@react-native-firebase/auth', () => ({}), { virtual: true });
jest.mock('@react-native-firebase/firestore', () => ({}), { virtual: true });
jest.mock('@react-native-firebase/storage', () => ({}), { virtual: true });
jest.mock('@react-native-firebase/messaging', () => ({}), { virtual: true });
jest.mock('react-native-google-mobile-ads', () => ({}), { virtual: true });
jest.mock('react-native-iap', () => ({}), { virtual: true });
jest.mock('@notifee/react-native', () => ({}), { virtual: true });
