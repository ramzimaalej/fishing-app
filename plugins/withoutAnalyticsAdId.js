const { withDangerousMod, withAppBuildGradle } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Strip the advertising identifier from Firebase Analytics.
 *
 * The app served ads until recently, so the AdId-capable Analytics SDK was the
 * right choice — AdMob used the IDFA under ATT consent. With ads removed the
 * identifier buys nothing, yet merely LINKING it still obliges an App Privacy
 * "tracking" declaration on iOS and triggers an ATT prompt. Removing it lets the
 * app honestly declare that it does not track.
 *
 * iOS: react-native-firebase reads a global in the Podfile and swaps
 * `FirebaseAnalytics` for `FirebaseAnalyticsWithoutAdIdSupport`.
 * Android: the ads-identifier artifact arrives transitively via
 * `measurement-api`, so it is excluded at the Gradle level.
 *
 * Both edits are idempotent — prebuild re-runs them on every regeneration.
 */

const IOS_FLAG = "$RNFirebaseAnalyticsWithoutAdIdSupport = true";

/** Prepend the flag to the Podfile, before any target block. */
function withIosPodfileFlag(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      if (!fs.existsSync(podfile)) return cfg;

      const contents = fs.readFileSync(podfile, 'utf8');
      if (contents.includes(IOS_FLAG)) return cfg;

      fs.writeFileSync(
        podfile,
        `# Castmate serves no ads, so Analytics must not link the IDFA.\n${IOS_FLAG}\n\n${contents}`,
        'utf8',
      );
      return cfg;
    },
  ]);
}

/** Exclude the Android ads-identifier artifact pulled in by measurement-api. */
function withAndroidAdIdExclusion(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes('play-services-ads-identifier')) return cfg;

    cfg.modResults.contents += `
// Castmate serves no ads. play-services-ads-identifier arrives transitively via
// Firebase measurement-api; excluding it keeps the advertising ID out of the
// build entirely, so the app can declare that it does not track.
configurations.configureEach {
    exclude group: 'com.google.android.gms', module: 'play-services-ads-identifier'
}
`;
    return cfg;
  });
}

module.exports = function withoutAnalyticsAdId(config) {
  return withAndroidAdIdExclusion(withIosPodfileFlag(config));
};
