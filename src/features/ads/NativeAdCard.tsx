import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useEntitlements } from '@/features/subscription/useEntitlements';
import { colors, radius, spacing, typography } from '@/theme';

import { type NativePlacement, resolveAdUnitId } from './adsConfig';
import { ensureAdsInitialized } from './adsController';
import { useAdsStore } from './adsStore';
import { getAdsSdk } from './sdk';

interface Props {
  /** Which feed this unit is interleaved into (telemetry + policy review). */
  placement: NativePlacement;
}

/**
 * In-feed native ad, styled to match the surrounding list rows.
 *
 * Native units earn materially more than a banner of the same size because they
 * inherit the app's own layout, and they cost no screen real estate that the
 * user was already using — the feed simply scrolls one row further.
 *
 * Two non-negotiables:
 *  - The "Ad" badge is mandatory (AdMob policy requires native ads be clearly
 *    identifiable as advertising). It is not styled to be dismissible or faint.
 *  - The unit is a *row*, never an interstitial-by-stealth: it matches the row
 *    chrome exactly so scrolling past it costs one flick.
 *
 * Collapses to nothing when ad-free, when the SDK/unit is unavailable, or on
 * load failure — a feed must never show a dead gap.
 */
export default function NativeAdCard({ placement }: Props): JSX.Element | null {
  const { t } = useTranslation();
  const { adFree } = useEntitlements();
  const nonPersonalized = useAdsStore((s) => s.nonPersonalized);
  const [ad, setAd] = useState<any>(null);

  useEffect(() => {
    if (adFree) return;
    let active = true;
    let created: any = null;

    void (async () => {
      const ok = await ensureAdsInitialized();
      if (!ok || !active) return;
      const sdk = getAdsSdk();
      const unitId = resolveAdUnitId('native');
      if (!sdk?.NativeAd?.createForAdRequest || !unitId) return;
      try {
        created = await sdk.NativeAd.createForAdRequest(unitId, {
          requestNonPersonalizedAdsOnly: nonPersonalized,
        });
        // Unmounted (or turned ad-free) while the request was in flight.
        if (!active) {
          created?.destroy?.();
          return;
        }
        setAd(created);
      } catch {
        /* no fill / load error — stay collapsed */
      }
    })();

    return () => {
      active = false;
      // Native ads hold a native-side handle; leaking them leaks memory.
      created?.destroy?.();
      setAd(null);
    };
  }, [adFree, nonPersonalized]);

  const sdk = getAdsSdk();
  if (adFree || !ad || !sdk?.NativeAdView || !sdk?.NativeAsset) return null;

  const { NativeAdView, NativeAsset, NativeAssetType } = sdk;
  const iconUrl: string | undefined = ad.icon?.url;

  return (
    <NativeAdView nativeAd={ad} style={styles.row} testID={`native-ad-${placement}`}>
      {iconUrl ? (
        <NativeAsset assetType={NativeAssetType.ICON}>
          <Image source={{ uri: iconUrl }} style={styles.icon} />
        </NativeAsset>
      ) : (
        <View style={[styles.icon, styles.iconPlaceholder]} />
      )}

      <View style={styles.body}>
        <View style={styles.headerRow}>
          <View style={styles.adBadge}>
            <Text style={styles.adBadgeText}>{t('ads.label')}</Text>
          </View>
          {ad.advertiser ? (
            <NativeAsset assetType={NativeAssetType.ADVERTISER}>
              <Text style={styles.advertiser} numberOfLines={1}>
                {ad.advertiser}
              </Text>
            </NativeAsset>
          ) : null}
        </View>

        <NativeAsset assetType={NativeAssetType.HEADLINE}>
          <Text style={styles.headline} numberOfLines={2}>
            {ad.headline}
          </Text>
        </NativeAsset>

        {ad.body ? (
          <NativeAsset assetType={NativeAssetType.BODY}>
            <Text style={styles.bodyText} numberOfLines={2}>
              {ad.body}
            </Text>
          </NativeAsset>
        ) : null}

        {ad.callToAction ? (
          <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
            <Text style={styles.cta}>{ad.callToAction}</Text>
          </NativeAsset>
        ) : null}
      </View>
    </NativeAdView>
  );
}

// Deliberately mirrors BiteHistoryScreen's `row` chrome so the unit reads as
// part of the feed rather than as an injected billboard.
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  icon: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  iconPlaceholder: { borderWidth: 1, borderColor: colors.border },
  body: { flex: 1, gap: spacing.xs },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  adBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  adBadgeText: { fontSize: 10, fontWeight: '800', color: colors.bg },
  advertiser: { ...typography.caption, color: colors.textMuted, flex: 1 },
  headline: { ...typography.body, color: colors.text, fontWeight: '600' },
  bodyText: { ...typography.caption, color: colors.textMuted },
  cta: { ...typography.caption, color: colors.primary, fontWeight: '700', marginTop: 2 },
});
