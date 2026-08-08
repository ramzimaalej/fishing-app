import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Android foreground service that keeps the BLE scan alive while rods are armed.
 *
 * OPTIONAL BY CONSTRUCTION. `requireOptionalNativeModule` returns null rather
 * than throwing when the native side is absent — which it will be on iOS, and on
 * any JS-only reload of a build made before this module existed. Every function
 * here therefore reports what actually happened instead of assuming success, and
 * `isAvailable()` lets the UI tell the truth about whether rods will keep being
 * watched in the background.
 *
 * NOT AVAILABLE ON iOS, and that is not an omission. iOS suppresses duplicate
 * advertisements in the background; since every sample from the tag IS a
 * duplicate advertisement, no amount of background execution time helps. A
 * foreground service has no iOS equivalent that would change the outcome, so
 * this module is Android-only and the iOS limitation is stated to the user
 * rather than papered over.
 */

interface NativeScanForegroundService {
  start(title: string, body: string): Promise<boolean>;
  stop(): Promise<boolean>;
  isIgnoringBatteryOptimizations(): boolean;
  openBatterySettings(): Promise<boolean>;
}

const native = requireOptionalNativeModule<NativeScanForegroundService>(
  'ScanForegroundService',
);

/** True when the native service is present and usable on this platform. */
export function isAvailable(): boolean {
  return Platform.OS === 'android' && native !== null;
}

/**
 * Start the service.
 *
 * @returns false when it is unavailable OR Android refused to start it — most
 *   often because the app was already backgrounded, which API 31+ forbids. The
 *   caller must treat false as "rods may stop being watched", not as an error to
 *   swallow.
 */
export async function start(title: string, body: string): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.start(title, body);
  } catch {
    return false;
  }
}

export async function stop(): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.stop();
  } catch {
    return false;
  }
}

/**
 * Whether the app is exempt from battery optimisation.
 *
 * Returns false when unknown. Exemption is not the same as running a foreground
 * service, and on aggressive OEM builds neither alone guarantees survival — but
 * without it a long session is much likelier to be killed.
 */
export function isIgnoringBatteryOptimizations(): boolean {
  if (!native) return false;
  try {
    return native.isIgnoringBatteryOptimizations();
  } catch {
    return false;
  }
}

/** Open the system battery-optimisation screen. */
export async function openBatterySettings(): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.openBatterySettings();
  } catch {
    return false;
  }
}
