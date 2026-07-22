import { useNavigation } from '@react-navigation/native';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { format } from 'date-fns';

import { IAP_PRODUCT_IDS } from '@/config/constants';
import { useRewardedPreview } from '@/features/ads/useRewardedPreview';
import { colors, radius, spacing, typography } from '@/theme';

import { useSubscriptionStore } from './subscriptionStore';

const BENEFITS = [
  'Remove all ads',
  'Unlimited bite history',
  'Advanced fish-activity insights',
  'Custom alert sounds',
];

/** Fallback presentation when live product metadata hasn't loaded yet. */
const FALLBACK_PLANS: { id: string; title: string; blurb: string }[] = [
  { id: IAP_PRODUCT_IDS.yearly, title: 'Yearly', blurb: 'Best value' },
  { id: IAP_PRODUCT_IDS.monthly, title: 'Monthly', blurb: 'Flexible' },
];

interface PlanView {
  id: string;
  title: string;
  blurb: string;
  price?: string;
}

export default function PaywallScreen(): JSX.Element {
  const navigation = useNavigation<any>();
  const { isPremium, products, purchasing, error, init, purchase, restore } =
    useSubscriptionStore();
  // Soft-landing for non-buyers: a rewarded ad grants a 24h Premium Preview.
  const preview = useRewardedPreview();

  useEffect(() => {
    void init();
  }, [init]);

  const plans: PlanView[] = FALLBACK_PLANS.map((fallback) => {
    const match = products.find(
      (p: any) => p?.productId === fallback.id || p?.sku === fallback.id,
    );
    return {
      ...fallback,
      title: match?.title ?? fallback.title,
      price:
        match?.localizedPrice ??
        match?.subscriptionOfferDetails?.[0]?.pricingPhases?.pricingPhaseList?.[0]
          ?.formattedPrice,
    };
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable style={styles.close} onPress={() => navigation.goBack()} hitSlop={12}>
        <Text style={styles.closeText}>✕</Text>
      </Pressable>

      <Text style={styles.emoji}>🎣</Text>
      <Text style={styles.headline}>FishOn Premium</Text>
      <Text style={styles.subhead}>Fish smarter. No interruptions.</Text>

      {isPremium ? (
        <View style={styles.premiumBox}>
          <Text style={styles.premiumText}>You're Premium ✓</Text>
          <Text style={styles.subhead}>Thanks for supporting FishOn.</Text>
        </View>
      ) : (
        <>
          <View style={styles.benefits}>
            {BENEFITS.map((b) => (
              <View key={b} style={styles.benefitRow}>
                <Text style={styles.check}>✓</Text>
                <Text style={styles.benefitText}>{b}</Text>
              </View>
            ))}
          </View>

          <View style={styles.plans}>
            {plans.map((plan) => (
              <Pressable
                key={plan.id}
                style={({ pressed }) => [styles.plan, pressed && styles.planPressed]}
                disabled={purchasing}
                onPress={() => void purchase(plan.id)}
              >
                <View>
                  <Text style={styles.planTitle}>{plan.title}</Text>
                  <Text style={styles.planBlurb}>{plan.blurb}</Text>
                </View>
                <Text style={styles.planPrice}>{plan.price ?? '—'}</Text>
              </Pressable>
            ))}
          </View>

          {purchasing && <ActivityIndicator color={colors.primary} style={styles.spinner} />}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable onPress={() => void restore()} hitSlop={8}>
            <Text style={styles.restore}>Restore purchases</Text>
          </Pressable>

          {preview.previewActive && preview.previewUntil ? (
            <Text style={styles.previewNote}>
              ⭐ Premium Preview active until {format(preview.previewUntil, 'EEE HH:mm')}
            </Text>
          ) : preview.available ? (
            <Pressable style={styles.previewBtn} onPress={() => preview.watch()}>
              <Text style={styles.previewBtnText}>
                Not ready? Watch a short ad — Premium free for 24h
              </Text>
            </Pressable>
          ) : null}

          <Text style={styles.legal}>
            Subscriptions renew automatically until cancelled. Manage or cancel anytime in your
            store account settings.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingTop: spacing.xl * 2, alignItems: 'center' },
  close: { position: 'absolute', top: spacing.lg, right: spacing.lg, zIndex: 1 },
  closeText: { color: colors.textMuted, fontSize: 22 },
  emoji: { fontSize: 56, marginBottom: spacing.sm },
  headline: { ...typography.h1, color: colors.text, textAlign: 'center' },
  subhead: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  benefits: { alignSelf: 'stretch', marginVertical: spacing.xl, gap: spacing.sm },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  check: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  benefitText: { ...typography.body, color: colors.text },
  plans: { alignSelf: 'stretch', gap: spacing.md },
  plan: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  planPressed: { borderColor: colors.primary, opacity: 0.9 },
  planTitle: { ...typography.h3, color: colors.text },
  planBlurb: { ...typography.caption, color: colors.primary, marginTop: 2 },
  planPrice: { ...typography.h3, color: colors.text },
  spinner: { marginTop: spacing.md },
  error: { color: colors.danger, marginTop: spacing.md, textAlign: 'center' },
  restore: { color: colors.primary, marginTop: spacing.lg, ...typography.body },
  previewBtn: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  previewBtnText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  previewNote: { ...typography.body, color: colors.accent, marginTop: spacing.lg },
  legal: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  premiumBox: { marginTop: spacing.xl, alignItems: 'center', gap: spacing.xs },
  premiumText: { ...typography.h2, color: colors.success },
});
