import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State } from 'react-native-ble-plx';

import { DEVICE_NAME_PREFIX, FISHON_SERVICE_UUID } from './protocol';
import type { BleDeviceInfo } from './types';

let manager: BleManager | null = null;

/** Lazily create the shared BleManager (constructing it early can crash tests). */
export function getBleManager(): BleManager {
  if (!manager) manager = new BleManager();
  return manager;
}

export function destroyBleManager(): void {
  manager?.destroy();
  manager = null;
}

/** Request the runtime permissions BLE scanning needs (Android). iOS is Info.plist. */
export async function ensureBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const sdk = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  const P = PermissionsAndroid.PERMISSIONS;
  const perms = (
    sdk >= 31 ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT] : [P.ACCESS_FINE_LOCATION]
  ).filter((p): p is NonNullable<typeof p> => p != null);
  const result = await PermissionsAndroid.requestMultiple(perms);
  return perms.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}

/** Wait until the adapter is powered on (or throw if it cannot be). */
export function waitForPoweredOn(timeoutMs = 8000): Promise<void> {
  const mgr = getBleManager();
  return new Promise((resolve, reject) => {
    let sub: { remove: () => void } | null = null;
    const timer = setTimeout(() => {
      sub?.remove();
      reject(new Error('Bluetooth did not power on in time'));
    }, timeoutMs);
    sub = mgr.onStateChange((state) => {
      if (state === State.PoweredOn) {
        clearTimeout(timer);
        sub?.remove();
        resolve();
      } else if (state === State.Unsupported || state === State.Unauthorized) {
        clearTimeout(timer);
        sub?.remove();
        reject(new Error(`Bluetooth unavailable: ${state}`));
      }
    }, true);
  });
}

/**
 * Scan for the first FishOn sensor and resolve its id/name. Times out cleanly.
 */
export function scanForSensor(timeoutMs = 10000): Promise<BleDeviceInfo> {
  const mgr = getBleManager();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      mgr.stopDeviceScan();
      reject(new Error('No FishOn sensor found. Make sure it is powered on and nearby.'));
    }, timeoutMs);

    mgr.startDeviceScan([FISHON_SERVICE_UUID], { allowDuplicates: false }, (error, device) => {
      if (error) {
        clearTimeout(timer);
        mgr.stopDeviceScan();
        reject(error);
        return;
      }
      if (device && (device.name?.startsWith(DEVICE_NAME_PREFIX) ?? true)) {
        clearTimeout(timer);
        mgr.stopDeviceScan();
        resolve({ id: device.id, name: device.name ?? 'FishOn Sensor' });
      }
    });
  });
}
