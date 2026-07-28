import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AdBanner,
  maybeShowSessionEndInterstitial,
  RewardedUnlockCard,
} from '@/features/ads';
import { dateFnsOptions } from '@/i18n/formatting';
import { useEntitlements } from '@/features/subscription/useEntitlements';
import { colors, radius, spacing, typography } from '@/theme';

import { useSessionStore } from './sessionStore';
import { formatDuration, type SessionSummary, timelineBuckets } from './sessionSummary';

const BUCKETS = 12;

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, accent && { color: colors.accent }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** Bite-count-over-time bars. Purely presentational — bucketing is pure code. */
function Timeline({ summary }: { summary: SessionSummary }) {
  const buckets = useMemo(() => timelineBuckets(summary, BUCKETS), [summary]);
  const max = Math.max(1, ...buckets);
  return (
    <View>
      <View style={styles.timelineRow}>
        {buckets.map((count, i) => (
          <View key={i} style={styles.timelineCol}>
            <View style={styles.timelineTrack}>
              <View
                style={[
                  styles.timelineFill,
                  {
                    height: `${(count / max) * 100}%`,
                    backgroundColor: count > 0 ? colors.primary : 'transparent',
                  },
                ]}
              />
            </View>
          </View>
        ))}
      </View>
      <View style={styles.timelineAxis}>
        <Text style={styles.axisLabel}>
          {format(summary.startedAt, 'HH:mm', dateFnsOptions())}
        </Text>
        <Text style={styles.axisLabel}>
          {format(summary.endedAt, 'HH:mm', dateFnsOptions())}
        </Text>
      </View>
    </View>
  );
}

function LockedBlock({ lines }: { lines: number }) {
  const { t } = useTranslation();
  return (
    <View style={styles.lockedBlock}>
      {Array.from({ length: lines }, (_, i) => (
        <View key={i} style={[styles.lockedBar, { width: `${88 - i * 16}%` }]} />
      ))}
      <Text style={styles.lockedHint}>{t('report.lockedHint')}</Text>
    </View>
  );
}

export default function SessionReportScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<{ goBack: () => void; navigate: (r: string) => void }>();
  const summary = useSessionStore((s) => s.last);
  const pendingSeconds = useSessionStore((s) => s.pendingInterstitialSeconds);
  const clearPending = useSessionStore((s) => s.clearPendingInterstitial);
  const { has } = useEntitlements();
  const detailed = has('session-report');

  /**
   * Leaving the report is where the session-end interstitial fires — the report
   * itself is the payoff for hours of fishing, so the ad goes after it rather
   * than in front of it. Exactly one impression either way; the policy gate in
   * adPolicy.ts still decides whether it shows at all.
   */
  const leave = useCallback(() => {
    const seconds = pendingSeconds;
    clearPending();
    if (seconds === null) {
      navigation.goBack();
      return;
    }
    maybeShowSessionEndInterstitial(seconds, () => navigation.goBack());
  }, [pendingSeconds, clearPending, navigation]);

  if (!summary) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>{t('report.noSessionTitle')}</Text>
          <Text style={styles.emptySub}>{t('report.noSessionSub')}</Text>
          <Pressable style={styles.doneBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.doneText}>{t('common.back')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const { conditions } = summary;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('report.title')}</Text>
        <Text style={styles.subtitle}>
          {format(summary.startedAt, 'EEE d MMM · HH:mm', dateFnsOptions())} —{' '}
          {format(summary.endedAt, 'HH:mm', dateFnsOptions())}
        </Text>

        {/* Headline numbers stay free: this is the payoff for the session the
            user just fished, and paywalling it would sour the whole debrief. */}
        <View style={styles.statsRow}>
          <Stat label={t('report.bites')} value={String(summary.totalBites)} accent />
          <Stat label={t('report.duration')} value={formatDuration(summary.durationSeconds)} />
          <Stat
            label={t('report.bestStrike')}
            value={
              summary.strongest ? `${summary.strongest.event.peakMagnitude.toFixed(2)} g` : '—'
            }
          />
        </View>

        {summary.totalBites === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('report.noBitesTitle')}</Text>
            <Text style={styles.muted}>{t('report.noBitesSub')}</Text>
          </View>
        ) : (
          <>
            {/* FREE. The timeline is the payoff for the session just fished,
                and a report that looks locked stops getting opened — which
                loses the banner impression AND the rewarded offer along with
                it. The analytical breakdown below is what Premium gates. */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('report.timeline')}</Text>
              <Timeline summary={summary} />
            </View>

            {/* Per-rod split stays FREE: with several rods armed, "which rod"
                is the primary fact of the session, not a premium detail. */}
            {summary.perRod.length > 1 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('report.byRod')}</Text>
                {summary.perRod.map((r) => (
                  <View key={r.rodId} style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{r.rodName}</Text>
                    <Text style={styles.detailValue}>
                      {t('report.rodTally', {
                        count: r.bites,
                        peak: r.peakMagnitude.toFixed(2),
                      })}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('report.breakdown')}</Text>
              {detailed ? (
                <>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{t('report.bigFish')}</Text>
                    <Text style={styles.detailValue}>{summary.bigBites}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{t('report.nibbles')}</Text>
                    <Text style={styles.detailValue}>{summary.smallBites}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{t('report.biteRate')}</Text>
                    <Text style={styles.detailValue}>
                      {t('report.biteRateValue', { rate: summary.biteRate.toFixed(1) })}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{t('report.meanConfidence')}</Text>
                    <Text style={styles.detailValue}>
                      {Math.round(summary.avgConfidence * 100)}%
                    </Text>
                  </View>
                  {summary.hottestWindow && (
                    <Text style={styles.hotLine}>
                      {t('report.hottest', {
                        time: format(summary.hottestWindow.startAt, 'HH:mm', dateFnsOptions()),
                        count: summary.hottestWindow.count,
                      })}
                    </Text>
                  )}
                </>
              ) : (
                <LockedBlock lines={4} />
              )}
            </View>

            {conditions && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('report.conditionsTitle')}</Text>
                {detailed ? (
                  <View style={styles.condGrid}>
                    {conditions.pressure != null && (
                      <Stat label={t('conditions.pressure')} value={`${conditions.pressure.toFixed(0)} hPa`} />
                    )}
                    {conditions.temperature != null && (
                      <Stat label={t('report.air')} value={`${conditions.temperature.toFixed(1)} °C`} />
                    )}
                    {conditions.windSpeed != null && (
                      <Stat label={t('conditions.wind')} value={`${conditions.windSpeed.toFixed(1)} m/s`} />
                    )}
                    {conditions.moon?.name && (
                      <Stat label={t('conditions.moon')} value={conditions.moon.name} />
                    )}
                  </View>
                ) : (
                  <LockedBlock lines={2} />
                )}
              </View>
            )}
          </>
        )}

        {/* Opt-in rewarded slot — hidden once unlocked, since the content
            appearing is confirmation enough. */}
        {summary.totalBites > 0 && (
          <RewardedUnlockCard kind="session-report" hideWhenUnlocked />
        )}

        <Pressable style={styles.doneBtn} onPress={leave}>
          <Text style={styles.doneText}>{t('common.done')}</Text>
        </Pressable>
      </ScrollView>

      {/* Terminal review surface — a natural place for the anchored banner. */}
      <AdBanner placement="session-report" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textMuted },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    minWidth: 80,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: { ...typography.h2, color: colors.primary },
  statLabel: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  cardTitle: { ...typography.h3, color: colors.text },
  muted: { ...typography.body, color: colors.textMuted },
  timelineRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 96 },
  timelineCol: { flex: 1 },
  timelineTrack: {
    height: 96,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  timelineFill: { width: '100%', borderRadius: radius.sm },
  timelineAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  axisLabel: { ...typography.caption, color: colors.textMuted },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailLabel: { ...typography.body, color: colors.textMuted },
  detailValue: { ...typography.body, color: colors.text, fontWeight: '600' },
  hotLine: { ...typography.caption, color: colors.accent, marginTop: spacing.xs },
  condGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  lockedBlock: { gap: spacing.sm, paddingVertical: spacing.xs },
  lockedBar: { height: 12, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
  lockedHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyTitle: { ...typography.h3, color: colors.text },
  emptySub: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  doneBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  doneText: { ...typography.h3, color: colors.bg },
});
