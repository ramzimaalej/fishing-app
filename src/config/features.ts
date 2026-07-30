import Constants from 'expo-constants';

/**
 * Monetization feature toggles.
 *
 * The revenue model is HARDWARE-ONLY: sell the sensor, give the software away.
 *
 * Ads were REMOVED outright rather than toggled — the SDK, the placements and
 * the rewarded-unlock machinery are all gone, so there is no ad flag to set and
 * no dormant code to re-enable by accident.
 *
 * Subscriptions remain, dormant behind this flag, so a paid tier can be switched
 * on later as a build-config change rather than a rewrite. BUILD-TIME on
 * purpose: with it off the IAP store connection is never opened, so the products
 * need not even exist in App Store Connect / Play Console.
 *
 * Defaults to OFF. A missing or malformed config yields the hardware-only model
 * rather than silently switching monetization on.
 *
 * ⚠️ TURNING THIS ON IS NOT JUST A FLAG FLIP. The paywall currently carries no
 * auto-renewal disclosure — those strings were removed while the tier is dormant
 * rather than shipped unreviewed. A subscription without stated terms is an App
 * Store 3.1.2 rejection. See the header of PaywallScreen.tsx.
 */

interface FeatureExtra {
  subscriptions?: unknown;
}

/** Only an explicit boolean `true` (or the string "true") enables a flag. */
function enabled(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * Resolve flags from a raw `extra.features` object. Exported for tests — the
 * constants below are the frozen result for the running app.
 */
export function resolveFeatureFlags(extra: FeatureExtra | undefined | null): {
  subscriptions: boolean;
} {
  return { subscriptions: enabled(extra?.subscriptions) };
}

const resolved = resolveFeatureFlags(
  (Constants.expoConfig?.extra as { features?: FeatureExtra } | undefined)?.features,
);

/**
 * True when the paid tier exists at all.
 *
 * When false, EVERY gated feature is unlocked for everyone (see
 * useEntitlements): the full forecast, unlimited history, all alert sounds,
 * unlimited session length, cloud photo backup, full session reports and catch
 * insights. The paywall is unreachable and no IAP connection is made.
 */
export const SUBSCRIPTIONS_ENABLED = resolved.subscriptions;

