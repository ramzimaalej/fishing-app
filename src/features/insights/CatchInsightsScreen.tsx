import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdBanner, RewardedUnlockCard } from '@/features/ads';
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
  const maxLift = dimension.buckets.reduce((m, b) => Math.max(m, b.lift), 0);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{dimension.title}</Text>
        {dimension.best && (
          <Text style={styles.cardBest}>best: {dimension.best.label}</Text>
        )}
      </View>

      <View style={styles.bucketHeader}>
        <Text style={[styles.bucketLabel, styles.headerText]} />
        <Text style={[styles.bucketTrack, styles.headerText]}>vs. chance</Text>
        <Text style={[styles.bucketLift, styles.headerText]}>lift</Text>
        <Text style={[styles.bucketCount, styles.headerText]}>n</Text>
      </View>

      {dimension.buckets.map((b) => (
        <BucketRow key={b.label} bucket={b} maxLift={maxLift} />
      ))}
    </View>
  );
}

function Locked() {
  return (
    <View style={styles.card}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.lockedRow}>
          <View style={[styles.lockedBar, { width: `${72 - i * 12}%` }]} />
        </View>
      ))}
      <Text style={styles.muted}>🔒 Unlock to see which conditions produced your bites</Text>
    </View>
  );
}

function NotEnoughYet({ insights }: { insights: CatchInsights }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Not enough data yet</Text>
      <Text style={styles.muted}>
        {insights.matched} of {MIN_SAMPLE} bites matched to historical conditions. Keep fishing —
        the analysis needs a real sample before it can tell you anything honest.
      </Text>
    </View>
  );
}

export default function CatchInsightsScreen() {
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
        <Text style={styles.title}>Catch insights</Text>
        <Text style={styles.subtitle}>
          Your bites matched against ERA5 reanalysis — the corrected historical record, not a
          forecast. Each condition is scored by how often it produced a bite relative to how often
          it actually occurred, over the last {INSIGHTS_WINDOW_DAYS} days.
        </Text>

        {busy && insights === null && (
          <View style={styles.centerBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>Loading historical conditions…</Text>
          </View>
        )}

        {error && (
          <View style={styles.card}>
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.muted}>Pull down to retry.</Text>
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

            <RewardedUnlockCard kind="catch-insights" hideWhenUnlocked />

            <View style={styles.card}>
              <Text style={styles.cardTitle}>How to read this</Text>
              <Text style={styles.muted}>
                <Text style={styles.bold}>Lift</Text> is how much more often a condition produced a
                bite than chance would predict. 1.0× is exactly average; 2.0× means twice as
                productive as its frequency alone would suggest. <Text style={styles.bold}>n</Text>{' '}
                is the number of bites in that band.
              </Text>
              <Text style={styles.caveat}>
                This corrects for how common each condition was, but not for when you chose to fish.
                If you only ever fish at dawn, dawn will lead regardless of the fish.
              </Text>
              <Text style={styles.footnote}>
                {insights.matched} bites analysed against {insights.backgroundHours} hours of
                reanalysis.
                {insights.excluded > 0
                  ? ` ${insights.excluded} outside the window or without data.`
                  : ''}
                {pendingRecent > 0
                  ? ` ${pendingRecent} too recent — reanalysis lags a few days.`
                  : ''}
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      {/* Review surface — same doctrine as History and Conditions. */}
      <AdBanner placement="insights" />
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
