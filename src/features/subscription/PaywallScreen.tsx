import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PLAN_ORDER, type PlanKey } from '@/config/constants';
import { colors, radius, spacing, typography } from '@/theme';

import { useSubscriptionStore } from './subscriptionStore';

/**
 * Every line here maps to a gate that is actually enforced in code — see
 * config/constants.ts (free-tier limits) and features/ads/rewards.ts. Adding a
 * claim without its gate would be both a lie and an App Store 3.1.2 problem.
 *
 * Note what is NOT here: rod count. Every user monitors up to MAX_RODS rods for
 * free, on purpose (features/rods/rod.ts). What Premium gates is the set of
 * things that cost us something per user — weather API calls, cloud storage —
 * plus ad removal.
 */
const BENEFIT_KEYS = [
  'paywall.benefits.outlook',
  'paywall.benefits.insights',
  'paywall.benefits.reports',
  'paywall.benefits.history',
  'paywall.benefits.sounds',
  'paywall.benefits.backup',
] as const;

/**
 * Copy per plan, as translation KEYS. Structure (id, product type) lives in
 * config/constants.ts.
 *
 * `as const` keeps the values literal so the i18next augmentation can verify
 * them; widened to `string` they would silently accept a key that no longer
 * exists.
 */
const PLAN_COPY = {
  lifetime: {
    title: 'paywall.plans.lifetimeTitle',
    blurb: 'paywall.plans.lifetimeBlurb',
    tag: 'paywall.plans.lifetimeTag',
  },
  yearly: {
    title: 'paywall.plans.yearlyTitle',
    blurb: 'paywall.plans.yearlyBlurb',
    // Explicit undefined, not omitted: under `as const` an absent property is
    // absent from the union type, so `copy.tag` would not typecheck at all.
    tag: undefined,
  },
} as const satisfies Record<PlanKey, { title: string; blurb: string; tag?: string }>;

/**
 * Price string the STORE quoted for a plan. Never a hardcoded figure: each
 * storefront must show exactly what it will charge, and App Store review
 * rejects a displayed price that differs from the storefront's.
 *
 * Subscriptions and one-off products expose it under different shapes, and Play
 * nests it under offer/pricing phases — hence the chain.
 */
function priceOf(product: any): string | undefined {
  return (
    product?.localizedPrice ??
    product?.oneTimePurchaseOfferDetails?.formattedPrice ??
    product?.subscriptionOfferDetails?.[0]?.pricingPhases?.pricingPhaseList?.[0]?.formattedPrice
  );
}

/**
 * ⚠️ BEFORE ENABLING SUBSCRIPTIONS: this screen has NO auto-renewal disclosure.
 *
 * The `paywall.legal`, `paywall.planNote` and `paywall.cancelWarning` strings
 * were removed while the paid tier is dormant, rather than carry translations
 * nobody had reviewed. Shipping an auto-renewing subscription without stating
 * its terms is an App Store 3.1.2 rejection — restore them, translated and
 * reviewed, at the same time you flip SUBSCRIPTIONS_ENABLED.
 */
export default function PaywallScreen(): JSX.Element {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const {
    isPremium,
    source,
    products,
    purchasing,
    pendingPlan,
    error,
    init,
    purchase,
    restore,
  } = useSubscriptionStore();

  useEffect(() => {
    void init();
  }, [init]);


  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable style={styles.close} onPress={() => navigation.goBack()} hitSlop={12}>
        <Text style={styles.closeText}>✕</Text>
      </Pressable>

      <Text style={styles.emoji}>🎣</Text>
      <Text style={styles.headline}>{t('paywall.title')}</Text>
      <Text style={styles.subhead}>{t('paywall.subhead')}</Text>

      {isPremium ? (
        <View style={styles.premiumBox}>
          <Text style={styles.premiumText}>
            {source === 'lifetime' ? t('paywall.lifetimeActive') : t('paywall.yourePremium')}
          </Text>
          <Text style={styles.subhead}>
            {source === 'subscription'
              ? t('paywall.renewsYearly')
              : t('paywall.thanks')}
          </Text>

        </View>
      ) : (
        <>
          <View style={styles.benefits}>
            {BENEFIT_KEYS.map((key) => (
              <View key={key} style={styles.benefitRow}>
                <Text style={styles.check}>✓</Text>
                <Text style={styles.benefitText}>{t(key)}</Text>
              </View>
            ))}
          </View>

          <View style={styles.plans}>
            {PLAN_ORDER.map((plan) => {
              const copy = PLAN_COPY[plan];
              const price = priceOf(products[plan]);
              const busy = purchasing && pendingPlan === plan;
              // Nothing to buy until the store has quoted a real price — a card
              // with no price must not be tappable.
              const disabled = purchasing || !price;

              return (
                <Pressable
                  key={plan}
                  style={({ pressed }) => [
                    styles.plan,
                    copy.tag ? styles.planFeatured : null,
                    pressed && !disabled ? styles.planPressed : null,
                    disabled && styles.planDisabled,
                  ]}
                  disabled={disabled}
                  onPress={() => void purchase(plan)}
                >
                  <View style={{ flex: 1 }}>
                    <View style={styles.planTitleRow}>
                      <Text style={styles.planTitle}>{t(copy.title)}</Text>
                      {copy.tag && (
                        <View style={styles.planTag}>
                          <Text style={styles.planTagText}>{t(copy.tag)}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.planBlurb}>{t(copy.blurb)}</Text>
                  </View>
                  {busy ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <Text style={styles.planPrice}>{price ?? '…'}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>


          {error ? <Text style={styles.error}>{error}</Text> : null}

          {/* Required for the lifetime purchase: Apple mandates a restore path
              for non-consumables, and reviewers test it. */}
          <Pressable onPress={() => void restore()} hitSlop={8} disabled={purchasing}>
            <Text style={styles.restore}>{t('paywall.restore')}</Text>
          </Pressable>

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
  planFeatured: { borderColor: colors.primary },
  planPressed: { borderColor: colors.primary, opacity: 0.9 },
  planDisabled: { opacity: 0.5 },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  planTitle: { ...typography.h3, color: colors.text },
  planBlurb: { ...typography.caption, color: colors.primary, marginTop: 2 },
  planPrice: { ...typography.h3, color: colors.text },
  planTag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
  },
  planTagText: { fontSize: 10, fontWeight: '800', color: colors.bg },
  planNote: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  cancelWarning: {
    ...typography.caption,
    color: colors.accent,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
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
