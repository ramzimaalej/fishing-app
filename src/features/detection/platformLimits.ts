import { Platform } from 'react-native';

/**
 * What continuous scanning can and cannot do on each platform.
 *
 * Stated plainly and shown in the UI because the spec is explicit that the app
 * must not imply coverage it does not have. A bite alarm that silently stops
 * watching is the failure mode this whole product exists to prevent, so a
 * platform limitation that stops it watching has to be told to the user rather
 * than discovered on the bank.
 *
 * iOS: `CBCentralManagerScanOptionAllowDuplicatesKey` does NOT work in the
 * background — duplicates are suppressed and scanning is throttled. Since every
 * sample IS a duplicate advertisement from the same tag, backgrounded scanning
 * does not merely slow down, it stops producing usable data. There is no
 * workaround; the app must stay foreground with the screen awake.
 *
 * Android: a long-running scan needs a foreground service to survive Doze and
 * background execution limits. THE APP DOES NOT CURRENTLY HAVE ONE — that needs
 * a native module, which this build does not include. The manifest permissions
 * are declared (see plugins/withScanningPermissions) and battery-optimisation
 * exemption helps considerably, but scanning may still be throttled or killed
 * when the app is backgrounded. Do not claim otherwise here.
 */

export const PLATFORM_LIMIT_TITLE =
  Platform.OS === 'ios'
    ? 'Keep Castmate open and the screen awake'
    : 'Keep Castmate open, and exempt it from battery optimisation';

export const PLATFORM_LIMIT_BODY =
  Platform.OS === 'ios'
    ? 'iOS suppresses duplicate advertisements and throttles scanning in the background. ' +
      'Every sample from the tag IS a duplicate advertisement, so backgrounding the app does ' +
      'not slow detection down — it stops it. Leave Castmate in the foreground with the screen ' +
      'on, or the rod is not being watched.'
    : 'Android throttles and eventually kills background scanning. This build has no ' +
      'foreground service (that needs a native module), so leave Castmate open while fishing ' +
      'and exempt it from battery optimisation in system settings. Backgrounding it may stop ' +
      'the rod being watched without any warning from the system.';

/** True on the platform where background operation is categorically impossible. */
export const BACKGROUND_SCANNING_IMPOSSIBLE = Platform.OS === 'ios';
