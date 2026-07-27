import { useNavigation } from '@react-navigation/native';
import { format } from 'date-fns';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdBanner, RewardedUnlockCard } from '@/features/ads';
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
        <Text style={styles.axisLabel}>{format(summary.startedAt, 'HH:mm')}</Text>
        <Text style={styles.axisLabel}>{format(summary.endedAt, 'HH:mm')}</Text>
      </View>
    </View>
  );
}

function LockedBlock({ lines }: { lines: number }) {
  return (
    <View style={styles.lockedBlock}>
      {Array.from({ length: lines }, (_, i) => (
        <View key={i} style={[styles.lockedBar, { width: `${88 - i * 16}%` }]} />
      ))}
      <Text style={styles.lockedHint}>🔒 Unlock to see the full breakdown</Text>
    </View>
  );
}

export default function SessionReportScreen() {
  const navigation = useNavigation<{ goBack: () => void; navigate: (r: string) => void }>();
  const summary = useSessionStore((s) => s.last);
  const { has } = useEntitlements();
  const detailed = has('session-report');

  if (!summary) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>No session to report</Text>
          <Text style={styles.emptySub}>
            Finish a fishing session and its debrief appears here.
          </Text>
          <Pressable style={styles.doneBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.doneText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const { conditions } = summary;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Session report</Text>
        <Text style={styles.subtitle}>
          {format(summary.startedAt, 'EEE d MMM · HH:mm')} — {format(summary.endedAt, 'HH:mm')}
        </Text>

        {/* Headline numbers stay free: this is the payoff for the session the
            user just fished, and paywalling it would sour the whole debrief. */}
        <View style={styles.statsRow}>
          <Stat label="Bites" value={String(summary.totalBites)} accent />
          <Stat label="Duration" value={formatDuration(summary.durationSeconds)} />
          <Stat
            label="Best strike"
            value={
              summary.strongest ? `${summary.strongest.event.peakMagnitude.toFixed(2)} g` : '—'
            }
          />
        </View>

        {summary.totalBites === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No bites this time</Text>
            <Text style={styles.muted}>
              Blank sessions happen. Check the Conditions tab for the next good window before you
              head out again.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Bite timeline</Text>
              {detailed ? (
                <Timeline summary={summary} />
              ) : (
                <LockedBlock lines={3} />
              )}
            </View>

            {/* Per-rod split stays FREE: with several rods armed, "which rod"
                is the primary fact of the session, not a premium detail. */}
            {summary.perRod.length > 1 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>By rod</Text>
                {summary.perRod.map((r) => (
                  <View key={r.rodId} style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{r.rodName}</Text>
                    <Text style={styles.detailValue}>
                      {r.bites} {r.bites === 1 ? 'bite' : 'bites'} · peak{' '}
                      {r.peakMagnitude.toFixed(2)} g
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Strike breakdown</Text>
              {detailed ? (
                <>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Big fish</Text>
                    <Text style={styles.detailValue}>{summary.bigBites}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Nibbles</Text>
                    <Text style={styles.detailValue}>{summary.smallBites}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Bite rate</Text>
                    <Text style={styles.detailValue}>{summary.biteRate.toFixed(1)} / hour</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Mean confidence</Text>
                    <Text style={styles.detailValue}>
                      {Math.round(summary.avgConfidence * 100)}%
                    </Text>
                  </View>
                  {summary.hottestWindow && (
                    <Text style={styles.hotLine}>
                      🔥 Hottest half hour: {format(summary.hottestWindow.startAt, 'HH:mm')} —{' '}
                      {summary.hottestWindow.count} bites
                    </Text>
                  )}
                </>
              ) : (
                <LockedBlock lines={4} />
              )}
            </View>

            {conditions && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Conditions that produced them</Text>
                {detailed ? (
                  <View style={styles.condGrid}>
                    {conditions.pressure != null && (
                      <Stat label="Pressure" value={`${conditions.pressure.toFixed(0)} hPa`} />
                    )}
                    {conditions.temperature != null && (
                      <Stat label="Air" value={`${conditions.temperature.toFixed(1)} °C`} />
                    )}
                    {conditions.windSpeed != null && (
                      <Stat label="Wind" value={`${conditions.windSpeed.toFixed(1)} m/s`} />
                    )}
                    {conditions.moon?.name && <Stat label="Moon" value={conditions.moon.name} />}
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

        <Pressable style={styles.doneBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.doneText}>Done</Text>
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
