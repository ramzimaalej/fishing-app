import { getEntitlementsSnapshot } from '@/features/subscription/useEntitlements';

import { AD_POLICY, evaluateSessionEndInterstitial } from './adPolicy';
import { resolveAdUnitId, type FullScreenAdKind } from './adsConfig';
import { useAdsStore } from './adsStore';
import { getAdsSdk, type AdsSdk } from './sdk';

/**
 * Imperative ads runtime: consent gathering, SDK initialization, and managed
 * full-screen ad instances (preload + retry + show).
 *
 * Initialization is LAZY — triggered by the first surface that could actually
 * show an ad. Premium / ad-free users therefore never see a consent prompt and
 * never pay the SDK startup cost. Every path is guarded: when the native
 * module is missing, ads simply never become available.
 */

let initPromise: Promise<boolean> | null = null;

/** Gather UMP consent (GDPR + ATT where configured) and start the Mobile Ads SDK. */
export function ensureAdsInitialized(): Promise<boolean> {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

async function doInit(): Promise<boolean> {
  const sdk = getAdsSdk();
  const mobileAdsFactory = sdk?.default ?? sdk?.mobileAds;
  if (!sdk || typeof mobileAdsFactory !== 'function') return false;

  useAdsStore.getState().stampInstall();
  await gatherConsent(sdk);

  try {
    const instance = mobileAdsFactory();
    try {
      // Fishing audience skews adult, but keep content teen-safe by default.
      await instance.setRequestConfiguration?.({
        maxAdContentRating: sdk.MaxAdContentRating?.T ?? 'T',
      });
    } catch {
      /* request configuration is best-effort */
    }
    await instance.initialize();
    return true;
  } catch {
    return false;
  }
}

/**
 * UMP consent flow. On any failure we fall back to non-personalized requests —
 * legally safe and still monetizable (at a lower eCPM).
 */
async function gatherConsent(sdk: AdsSdk): Promise<void> {
  const store = useAdsStore.getState();
  try {
    const AdsConsent = sdk.AdsConsent;
    if (!AdsConsent) {
      store.setNonPersonalized(true);
      return;
    }
    if (typeof AdsConsent.gatherConsent === 'function') {
      await AdsConsent.gatherConsent();
    } else {
      await AdsConsent.requestInfoUpdate?.();
      await AdsConsent.loadAndShowConsentFormIfRequired?.();
    }
    const info = (await AdsConsent.getConsentInfo?.()) ?? {};
    const personalized = info.status === 'OBTAINED' || info.status === 'NOT_REQUIRED';
    store.setNonPersonalized(!personalized);
  } catch {
    store.setNonPersonalized(true);
  }
}

const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 300_000;
const RETRY_MAX_FAILURES = 4;

/**
 * A preloadable full-screen ad (interstitial or rewarded) with load-state
 * subscription (for useSyncExternalStore), exponential retry on load failure,
 * and reload-after-show. `isLoaded` is always read at call time — never a
 * stale render-time capture.
 */
class ManagedFullScreenAd {
  private ad: any = null;
  private loaded = false;
  private loading = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private onEarned: (() => void) | null = null;

  constructor(private readonly kind: FullScreenAdKind) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get isLoaded(): boolean {
    return this.loaded;
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }

  /** Idempotent: begin loading if not already loaded/loading. */
  preload(): void {
    if (this.loaded || this.loading) return;
    this.failures = 0; // an explicit preload re-arms retries
    void ensureAdsInitialized().then((ok) => {
      if (ok) this.createAndLoad();
    });
  }

  private createAndLoad(): void {
    if (this.loaded || this.loading) return;
    const sdk = getAdsSdk();
    const unitId = resolveAdUnitId(this.kind);
    if (!sdk || !unitId) return;
    try {
      if (!this.ad) {
        const Ctor = this.kind === 'interstitial' ? sdk.InterstitialAd : sdk.RewardedAd;
        if (!Ctor?.createForAdRequest) return;
        this.ad = Ctor.createForAdRequest(unitId, {
          requestNonPersonalizedAdsOnly: useAdsStore.getState().nonPersonalized,
        });

        const { AdEventType, RewardedAdEventType } = sdk;
        const loadedEvent =
          this.kind === 'rewarded' ? RewardedAdEventType?.LOADED : AdEventType?.LOADED;

        this.ad.addAdEventListener(loadedEvent, () => {
          this.loaded = true;
          this.loading = false;
          this.failures = 0;
          this.emit();
        });
        this.ad.addAdEventListener(AdEventType?.CLOSED, () => {
          this.loaded = false;
          this.emit();
          this.scheduleReload(0); // immediately warm the next one
        });
        this.ad.addAdEventListener(AdEventType?.ERROR, () => {
          this.loaded = false;
          this.loading = false;
          this.failures += 1;
          this.emit();
          this.scheduleReload();
        });
        if (this.kind === 'rewarded' && RewardedAdEventType?.EARNED_REWARD) {
          this.ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
            this.onEarned?.();
            this.onEarned = null;
          });
        }
      }
      this.loading = true;
      this.ad.load();
    } catch {
      this.loading = false;
    }
  }

  private scheduleReload(overrideDelayMs?: number): void {
    if (this.failures > RETRY_MAX_FAILURES) return; // give up until next preload()
    const delay =
      overrideDelayMs ?? Math.min(RETRY_BASE_MS * 2 ** this.failures, RETRY_MAX_MS);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.createAndLoad(), delay);
  }

  /** Show if loaded. Returns whether the ad was actually presented. */
  show(onEarned?: () => void): boolean {
    if (!this.loaded || !this.ad) return false;
    this.onEarned = onEarned ?? null;
    try {
      this.ad.show();
      return true;
    } catch {
      return false;
    }
  }
}

/** The one interstitial in the app: shown (at most) when a session ends. */
export const sessionInterstitial = new ManagedFullScreenAd('interstitial');
/** Rewarded ad backing the 24h Premium Preview. */
export const previewRewarded = new ManagedFullScreenAd('rewarded');

/**
 * Called when a fishing session STARTS: warms the interstitial so it is ready
 * at session end. No-op for ad-free users (SDK never even initializes).
 */
export function prepareSessionAds(): void {
  if (getEntitlementsSnapshot().adFree) return;
  sessionInterstitial.preload();
}

/**
 * Called after the user deliberately ends a session. All policy rules are
 * enforced by the pure gate; on approval the impression is recorded so caps
 * and cooldowns stay accurate across restarts.
 */
export function maybeShowSessionEndInterstitial(sessionSeconds: number): boolean {
  const now = Date.now();
  const store = useAdsStore.getState();
  const verdict = evaluateSessionEndInterstitial({
    now,
    installedAt: store.installedAt,
    completedSessions: store.completedSessions,
    sessionSeconds,
    lastInterstitialAt: store.lastInterstitialAt,
    shownToday: store.shownToday(now),
    fishingActive: store.fishingActive,
    adFree: getEntitlementsSnapshot().adFree,
    adLoaded: sessionInterstitial.isLoaded,
  });
  if (!verdict.allowed) {
    if (__DEV__) console.log(`[ads] session-end interstitial denied: ${verdict.reason}`);
    return false;
  }
  const shown = sessionInterstitial.show();
  if (shown) store.recordInterstitialShown(now);
  return shown;
}

/** Grant the rewarded Premium Preview (used by useRewardedPreview). */
export function grantPreviewNow(): void {
  useAdsStore
    .getState()
    .grantPreview(Date.now() + AD_POLICY.preview.durationHours * 3_600_000);
}
