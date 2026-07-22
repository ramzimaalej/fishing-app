/**
 * Public API of the ads feature. Screens import ONLY from here — the SDK,
 * store internals, and controller stay encapsulated.
 */
export { default as AdBanner } from './AdBanner';
export { default as PremiumPreviewCard } from './PremiumPreviewCard';
export { useRewardedPreview } from './useRewardedPreview';
export {
  ensureAdsInitialized,
  maybeShowSessionEndInterstitial,
  prepareSessionAds,
} from './adsController';
export { useAdsStore } from './adsStore';
export { AD_POLICY, evaluateSessionEndInterstitial, dayKeyOf } from './adPolicy';
export type { BannerPlacement } from './adsConfig';
export type { GateVerdict, InterstitialGateInput, InterstitialPolicy } from './adPolicy';
