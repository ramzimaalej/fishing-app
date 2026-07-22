/**
 * Single guarded access point to the react-native-google-mobile-ads native
 * module. Every ads file resolves the SDK through here — nowhere else may
 * `require` it — so "module not linked" (Expo Go, tests, stripped builds)
 * degrades to "no ads" in exactly one place.
 *
 * Consumers must still check the specific export they need (`sdk?.BannerAd`,
 * `sdk?.InterstitialAd`, …): in Jest the module is mocked as `{}`.
 */

// Deliberately loose: the SDK surface is accessed defensively throughout.
export type AdsSdk = Record<string, any>;

let cached: AdsSdk | null | undefined;

export function getAdsSdk(): AdsSdk | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cached = require('react-native-google-mobile-ads') as AdsSdk;
  } catch {
    cached = null;
  }
  return cached;
}
