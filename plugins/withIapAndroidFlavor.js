const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * react-native-iap ships two Android product flavors (`amazon` and `play`).
 * The app module must declare which store variant to consume, or Gradle fails
 * with a variant-ambiguity error resolving `:react-native-iap`. Expo prebuild
 * doesn't add this, so inject `missingDimensionStrategy 'store', 'play'` into
 * the app's defaultConfig on every prebuild.
 */
module.exports = function withIapAndroidFlavor(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (!gradle.includes("missingDimensionStrategy 'store'")) {
      gradle = gradle.replace(
        /(defaultConfig\s*\{)/,
        `$1\n        missingDimensionStrategy 'store', 'play'`,
      );
      cfg.modResults.contents = gradle;
    }
    return cfg;
  });
};
