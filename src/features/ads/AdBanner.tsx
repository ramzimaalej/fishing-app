import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useEntitlements } from '@/features/subscription/useEntitlements';

import { type BannerPlacement, resolveAdUnitId } from './adsConfig';
import { ensureAdsInitialized } from './adsController';
import { useAdsStore } from './adsStore';
import { getAdsSdk } from './sdk';

interface AdBannerProps {
  /**
   * Where this banner lives. Only passive planning/review surfaces are valid
   * placements — the live Fishing screen is deliberately not one of them.
   */
  placement: BannerPlacement;
}

/**
 * Anchored adaptive banner for non-ad-free users.
 *
 * - Entitlement-gated via useEntitlements (premium OR an active Premium
 *   Preview suppresses it reactively — no props, one source of truth).
 * - Initializes the ads SDK lazily on first mount, so ad-free users never
 *   trigger consent or SDK startup.
 * - Collapses to nothing on load failure (no blank strip).
 */
export default function AdBanner({ placement }: AdBannerProps): JSX.Element | null {
  const { adFree } = useEntitlements();
  const nonPersonalized = useAdsStore((s) => s.nonPersonalized);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (adFree) return;
    let active = true;
    void ensureAdsInitialized().then((ok) => {
      if (active) setReady(ok);
    });
    return () => {
      active = false;
    };
  }, [adFree]);

  const sdk = getAdsSdk();
  const unitId = ready ? resolveAdUnitId('banner') : null;
  if (adFree || failed || !sdk?.BannerAd || !unitId) return null;

  const { BannerAd, BannerAdSize } = sdk;
  return (
    <View style={styles.container} testID={`ad-banner-${placement}`}>
      <BannerAd
        unitId={unitId}
        size={BannerAdSize?.ANCHORED_ADAPTIVE_BANNER ?? 'ANCHORED_ADAPTIVE_BANNER'}
        requestOptions={{ requestNonPersonalizedAdsOnly: nonPersonalized }}
        onAdFailedToLoad={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', width: '100%' },
});
