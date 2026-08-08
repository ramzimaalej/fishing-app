const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

/**
 * Android permissions for long-running BLE scanning.
 *
 * The FOREGROUND_SERVICE permissions and the service declaration itself now live
 * in the local module that owns them (modules/scan-foreground-service), so that
 * removing the module removes its rights too rather than leaving the app
 * declaring privileges it no longer exercises.
 *
 * What remains here is the battery-optimisation permission, which belongs to the
 * app rather than the module: it governs whether the OS may kill the process at
 * all, foreground service or not.
 *
 * NOTE FOR SUBMISSION: Google Play restricts apps that request
 * REQUEST_IGNORE_BATTERY_OPTIMIZATIONS without a qualifying use case. A bite
 * alarm that must keep watching a rod for hours is one, but expect to justify
 * it. The app only ever opens the settings LIST, never the direct exemption
 * dialog, which is the lower-risk route.
 */
const PERMISSIONS = ['android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'];

module.exports = function withScanningPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    // ensurePermissions MUTATES the manifest and returns a {permission: added}
    // results map — not the manifest. Assigning its return value to modResults
    // replaces the manifest with that map, and every later mod then fails on
    // `androidManifest.manifest` being undefined. Call it for the side effect.
    AndroidConfig.Permissions.ensurePermissions(cfg.modResults, PERMISSIONS);
    return cfg;
  });
};
