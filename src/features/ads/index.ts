/**
 * Public API of the ads feature. Screens import ONLY from here — the SDK,
 * store internals, and controller stay encapsulated.
 */
export { default as AdBanner } from './AdBanner';
export { default as NativeAdCard } from './NativeAdCard';
export { default as RewardedUnlockCard } from './RewardedUnlockCard';
export { useRewardedUnlock } from './useRewardedUnlock';
export { useRewardedAction } from './useRewardedAction';
export { useOfferSlot } from './useOfferSlot';
export { pickOffer } from './offerArbiter';
export {
  MAX_UNTAKEN_OFFERS,
  pruneLedger,
  recordShown,
  recordTaken,
  shouldOffer,
  statsFor,
  SUPPRESSION_MS,
} from './offerFatigue';
export type { OfferLedger, OfferStats } from './offerFatigue';
export type { OfferContext } from './offerArbiter';
export type { RewardedAction } from './useRewardedAction';
export {
  ensureAdsInitialized,
  maybeShowSessionEndInterstitial,
  prepareSessionAds,
} from './adsController';
export { useAdsStore } from './adsStore';
export { AD_POLICY, evaluateSessionEndInterstitial, dayKeyOf } from './adPolicy';
export {
  activeRewards,
  isRewardActive,
  pruneGrants,
  REWARD_KINDS,
  REWARDS,
  rewardExpiry,
} from './rewards';
export { NATIVE_FEED_INTERVAL } from './adsConfig';
export { interleaveNativeAds } from './feed';
export type { FeedEntry, InterleaveOptions } from './feed';
export type { BannerPlacement, NativePlacement } from './adsConfig';
export type { GateVerdict, InterstitialGateInput, InterstitialPolicy } from './adPolicy';
export type { RewardGrants, RewardKind, RewardSpec } from './rewards';
