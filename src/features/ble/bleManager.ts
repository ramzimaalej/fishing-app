import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State } from 'react-native-ble-plx';

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

// NOTE: scanning for the E8S is a continuous, broadcast-based flow implemented
// in E8sSensorClient (it keeps receiving advertisements), not a one-shot
// connect. This module only owns the shared manager, permissions, and power.
