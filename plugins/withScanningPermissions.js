const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

/**
 * Android permissions for long-running BLE scanning.
 *
 * MANIFEST ONLY. These declare intent; they do not create a foreground service,
 * which needs native code this build does not include. Without one, Android may
 * still throttle or kill scanning when the app is backgrounded — that limitation
 * is stated to the user in features/detection/platformLimits.ts rather than
 * papered over here.
 *
 * FOREGROUND_SERVICE_CONNECTED_DEVICE is declared because it is the type a BLE
 * scanning service must request on API 34+; declaring it now means adding the
 * service later is a code change rather than a permissions surprise.
 *
 * REQUEST_IGNORE_BATTERY_OPTIMIZATIONS lets the app send the user to the system
 * exemption dialog. Google Play restricts apps that request this without a
 * qualifying use case; a bite alarm that must keep watching a rod for hours is
 * one, but it is worth knowing before submission.
 */
const PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
];

module.exports = function withScanningPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults = AndroidConfig.Permissions.ensurePermissions(
      cfg.modResults,
      PERMISSIONS,
    );
    return cfg;
  });
};
