import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { getAdsSdk } from './sdk';

/**
 * Ad placement registry + ad-unit-id resolution.
 *
 * Placements are named so impressions can be attributed per surface (telemetry,
 * A/B pruning of underperforming slots) and so a rogue `<AdBanner>` can't be
 * dropped onto an unapproved screen without saying where it is.
 *
 * The live Fishing screen is intentionally NOT a valid placement — see
 * adPolicy.ts for the doctrine. There is also deliberately no app-open ad:
 * anglers open this app at the moment of action, and gating launch behind an
 * ad risks a missed bite (and an uninstall).
 */
export type BannerPlacement =
  | 'conditions'
  | 'history'
  | 'session-report'
  | 'best-times'
  | 'settings';

/** Where an in-feed native unit may appear. */
export type NativePlacement = 'history-feed';

export type FullScreenAdKind = 'interstitial' | 'rewarded';

export type AdKind = 'banner' | 'native' | FullScreenAdKind;

interface AdmobExtra {
  banner?: { ios?: string; android?: string };
  native?: { ios?: string; android?: string };
  interstitial?: { ios?: string; android?: string };
  rewarded?: { ios?: string; android?: string };
}

function configuredUnitId(kind: AdKind): string | null {
  const admob = (Constants.expoConfig?.extra as { admob?: AdmobExtra } | undefined)?.admob;
  const perPlatform = admob?.[kind];
  const id = Platform.OS === 'ios' ? perPlatform?.ios : perPlatform?.android;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function testUnitId(kind: AdKind): string | null {
  const testIds = getAdsSdk()?.TestIds as Record<string, string> | undefined;
  if (!testIds) return null;
  switch (kind) {
    case 'banner':
      return testIds.ADAPTIVE_BANNER ?? testIds.BANNER ?? null;
    case 'native':
      return testIds.NATIVE ?? null;
    case 'interstitial':
      return testIds.INTERSTITIAL ?? null;
    case 'rewarded':
      return testIds.REWARDED ?? null;
  }
}

/**
 * Resolve the ad unit id for a slot: Google test ids in dev, env-configured
 * real ids in production (falling back to test ids so a missing env var can
 * never crash or silently serve on a mis-typed id).
 */
export function resolveAdUnitId(kind: AdKind): string | null {
  if (__DEV__) return testUnitId(kind);
  return configuredUnitId(kind) ?? testUnitId(kind);
}

/**
 * How often an in-feed native unit is interleaved into a list. First unit sits
 * after `NATIVE_FEED_INTERVAL` real rows so a short list stays ad-free and the
 * feed never *opens* on an ad.
 */
export const NATIVE_FEED_INTERVAL = 8;
