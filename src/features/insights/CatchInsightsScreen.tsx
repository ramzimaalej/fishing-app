import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/features/auth/useAuth';
import { useBiteHistory } from '@/features/bite-history/useBiteHistory';
import { useEntitlements } from '@/features/subscription/useEntitlements';
import { colors, radius, spacing, typography } from '@/theme';

import {
  type CatchInsights,
  type InsightBucket,
  type InsightDimension,
  MIN_SAMPLE,
} from './catchInsights';
import { INSIGHTS_WINDOW_DAYS } from './historyWindow';
import { useCatchInsights } from './useCatchInsights';

/** Colour by lift: above chance earns emphasis, at/below chance stays quiet. */
function liftColor(lift: number): string {
  if (lift >= 1.5) return colors.success;
  if (lift > 1.05) return colors.primary;
  if (lift >= 0.7) return colors.textMuted;
  return colors.border;
}

function BucketRow({ bucket, maxLift }: { bucket: InsightBucket; maxLift: number }) {
  const color = liftColor(bucket.lift);
  // Bars are scaled to the dimension's own maximum so a weak dimension doesn't
  // render as a row of stubs.
  const width = maxLift > 0 ? Math.max(2, (bucket.lift / maxLift) * 100) : 2;
  return (
    <View style={styles.bucketRow}>
      <Text style={styles.bucketLabel} numberOfLines={1}>
        {bucket.label}
      </Text>
      <View style={styles.bucketTrack}>
        <View style={[styles.bucketFill, { width: `${width}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.bucketLift, { color }]}>{bucket.lift.toFixed(1)}×</Text>
      <Text style={styles.bucketCount}>{bucket.bites}</Text>
    </View>
  );
}

function DimensionCard({ dimension }: { dimension: InsightDimension }) {
  const { t } = useTranslation();
  const maxLift = dimension.buckets.reduce((m, b) => Math.max(m, b.lift), 0);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{dimension.title}</Text>
        {dimension.best && (
          <Text style={styles.cardBest}>
            {t('insights.best', { label: dimension.best.label })}
          </Text>
        )}
      </View>

      <View style={styles.bucketHeader}>
        <Text style={[styles.bucketLabel, styles.headerText]} />
        <Text style={[styles.bucketTrack, styles.headerText]}>{t('insights.vsChance')}</Text>
        <Text style={[styles.bucketLift, styles.headerText]}>{t('insights.lift')}</Text>
        <Text style={[styles.bucketCount, styles.headerText]}>{t('insights.count')}</Text>
      </View>

      {dimension.buckets.map((b) => (
        <BucketRow key={b.label} bucket={b} maxLift={maxLift} />
      ))}
    </View>
  );
}

function Locked() {
  const { t } = useTranslation();
  return (
    <View style={styles.card}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.lockedRow}>
          <View style={[styles.lockedBar, { width: `${72 - i * 12}%` }]} />
        </View>
      ))}
      <Text style={styles.muted}>{t('insights.locked')}</Text>
    </View>
  );
}

function NotEnoughYet({ insights }: { insights: CatchInsights }) {
  const { t } = useTranslation();
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t('insights.notEnoughTitle')}</Text>
      <Text style={styles.muted}>
        {t('insights.notEnoughBody', { matched: insights.matched, needed: MIN_SAMPLE })}
      </Text>
    </View>
  );
}


export default function CatchInsightsScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { records, loading: historyLoading } = useBiteHistory(user?.uid ?? null);
  const { insights, pendingRecent, loading, error, refresh } = useCatchInsights(records);
  const { has } = useEntitlements();
  const unlocked = has('catch-insights');

  const busy = loading || historyLoading;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primary} />
        }
      >
        <Text style={styles.title}>{t('insights.title')}</Text>
        <Text style={styles.subtitle}>
          {t('insights.subtitle', { days: INSIGHTS_WINDOW_DAYS })}
        </Text>

        {busy && insights === null && (
          <View style={styles.centerBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>{t('insights.loading')}</Text>
          </View>
        )}

        {error && (
          <View style={styles.card}>
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.muted}>{t('common.retry')}</Text>
          </View>
        )}

        {insights && !insights.sufficient && <NotEnoughYet insights={insights} />}

        {insights?.sufficient && (
          <>
            {unlocked && insights.headline && (
              <View style={[styles.card, styles.headlineCard]}>
                <Text style={styles.headlineText}>🎣 {insights.headline}</Text>
              </View>
            )}

            {unlocked ? (
              insights.dimensions.map((d) => <DimensionCard key={d.key} dimension={d} />)
            ) : (
              <Locked />
            )}


            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('insights.howToRead')}</Text>
              <Text style={styles.muted}>
                <Text style={styles.bold}>{t('insights.lift')}</Text>{' '}
                {t('insights.liftExplainer')} <Text style={styles.bold}>{t('insights.count')}</Text>{' '}
                {t('insights.countExplainer')}
              </Text>
              <Text style={styles.caveat}>{t('insights.caveat')}</Text>
              <Text style={styles.footnote}>
                {t('insights.footnote', {
                  matched: insights.matched,
                  hours: insights.backgroundHours,
                })}
                {insights.excluded > 0
                  ? t('insights.footnoteExcluded', { count: insights.excluded })
                  : ''}
                {pendingRecent > 0
                  ? t('insights.footnotePending', { count: pendingRecent })
                  : ''}
              </Text>
            </View>
          </>
        )}
      </ScrollView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  headlineCard: { borderColor: colors.accent },
  headlineText: { ...typography.body, color: colors.text, fontWeight: '600' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  cardTitle: { ...typography.h3, color: colors.text },
  cardBest: { ...typography.caption, color: colors.success },
  bucketHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerText: { ...typography.caption, color: colors.textMuted, height: undefined },
  bucketRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bucketLabel: { ...typography.caption, color: colors.text, width: 84 },
  bucketTrack: {
    flex: 1,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  bucketFill: { height: '100%', borderRadius: radius.pill },
  bucketLift: { ...typography.caption, width: 36, textAlign: 'right', fontWeight: '700' },
  bucketCount: { ...typography.caption, color: colors.textMuted, width: 22, textAlign: 'right' },
  lockedRow: { paddingVertical: 4 },
  lockedBar: { height: 10, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
  muted: { ...typography.caption, color: colors.textMuted },
  bold: { fontWeight: '700', color: colors.text },
  caveat: { ...typography.caption, color: colors.accent, marginTop: spacing.xs },
  footnote: { ...typography.caption, color: colors.border, marginTop: spacing.xs },
  centerBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  errorText: { ...typography.body, color: colors.danger },
});
