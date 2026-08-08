import { Platform } from 'react-native';

import * as scanService from '@scan-foreground-service';

/**
 * What continuous scanning can and cannot do on each platform.
 *
 * Stated plainly and shown in the UI because the app must not imply coverage it
 * does not have. A bite alarm that silently stops watching is the failure this
 * product exists to prevent, so a platform limitation that stops it watching has
 * to be told to the user rather than discovered on the bank.
 *
 * iOS: `CBCentralManagerScanOptionAllowDuplicatesKey` does NOT work in the
 * background — duplicates are suppressed and scanning is throttled. Since every
 * sample IS a duplicate advertisement from the same tag, backgrounded scanning
 * does not merely slow down, it stops producing usable data. There is no
 * workaround and no iOS equivalent of a foreground service that would change
 * this; the app must stay foreground with the screen awake.
 *
 * Android: a foreground service now keeps the process alive while rods are
 * armed (modules/scan-foreground-service). That removes the background-execution
 * limit, but NOT battery optimisation: aggressive OEM builds still kill exempt-
 * less apps on long sessions, so the exemption is still worth asking for.
 */

export const BACKGROUND_WATCH_SUPPORTED = scanService.isAvailable();

export const PLATFORM_LIMIT_TITLE =
  Platform.OS === 'ios'
    ? 'Keep Castmate open and the screen awake'
    : BACKGROUND_WATCH_SUPPORTED
      ? 'Exempt Castmate from battery optimisation'
      : 'Keep Castmate open — background watching is unavailable in this build';

export const PLATFORM_LIMIT_BODY =
  Platform.OS === 'ios'
    ? 'iOS suppresses duplicate advertisements and throttles scanning in the background. ' +
      'Every sample from the tag IS a duplicate advertisement, so backgrounding the app does ' +
      'not slow detection down — it stops it. Leave Castmate in the foreground with the screen ' +
      'on, or the rod is not being watched.'
    : BACKGROUND_WATCH_SUPPORTED
      ? 'While rods are armed, Castmate runs a foreground service and shows an ongoing ' +
        'notification, so Android will not kill the scan for being in the background. That ' +
        'notification is your evidence the alarm is live — if it disappears, no rod is being ' +
        'watched. Battery optimisation can still kill long sessions on some phones, so exempt ' +
        'Castmate below.'
      : 'This build has no foreground service, so Android may throttle or kill scanning when ' +
        'the app is backgrounded — without any warning from the system. Leave Castmate open ' +
        'while fishing. (Rebuild the app to enable background watching.)';

/** True on the platform where background operation is categorically impossible. */
export const BACKGROUND_SCANNING_IMPOSSIBLE = Platform.OS === 'ios';

/**
 * Whether the app is currently exempt from battery optimisation.
 *
 * Read at call time rather than cached: the user can change it in system
 * settings while the app is running, and a stale "not exempt" would keep nagging
 * someone who has already fixed it.
 */
export function isBatteryExempt(): boolean {
  return scanService.isIgnoringBatteryOptimizations();
}

export async function openBatteryOptimisationSettings(): Promise<boolean> {
  return scanService.openBatterySettings();
}
