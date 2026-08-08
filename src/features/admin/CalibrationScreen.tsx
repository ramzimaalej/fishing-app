/**
 * Calibration: compare the onset-rate distributions of labelled fish and waves,
 * so ONSET_RATE_MIN can be set from evidence rather than guessed.
 *
 * Not internationalised — a developer instrument behind the admin gate.
 *
 * The design brief this screen answers is "show the separation, and say plainly
 * when there isn't any". A view that only ever produced a suggested number would
 * let someone tune into false confidence: at ~10 Hz the sensor may simply not
 * resolve the difference, and no threshold fixes that.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useDetectionParamsStore } from '@/features/detection/detectionParamsStore';
import { colors, radius, spacing, typography } from '@/theme';

import { calibrate, type Distribution, labelCrossings } from './calibration';
import type { RecordingSummary } from './captureTypes';
import { listRecordings } from './recordingsRepo';

/** Histogram bin count. Enough shape to read, few enough to fill from one session. */
const BINS = 12;

function histogram(values: readonly number[], max: number): number[] {
  const bins = new Array<number>(BINS).fill(0);
  if (max <= 0) return bins;
  for (const v of values) {
    const i = Math.min(BINS - 1, Math.floor((v / max) * BINS));
    bins[i] = (bins[i] ?? 0) + 1;
  }
  return bins;
}

/**
 * Two overlaid histograms drawn with plain Views.
 *
 * No charting library: this is one screen behind a developer gate, and the
 * question it answers — "do these two piles of numbers overlap?" — is answered
 * as well by bar heights as by anything fancier.
 */
function Distributions({
  fish,
  wave,
  threshold,
  suggested,
}: {
  fish: number[];
  wave: number[];
  threshold: number;
  suggested: number | null;
}) {
  const max = Math.max(1, ...fish, ...wave);
  const fishBins = histogram(fish, max);
  const waveBins = histogram(wave, max);
  const peak = Math.max(1, ...fishBins, ...waveBins);

  return (
    <View>
      <View style={styles.chart}>
        {fishBins.map((_, i) => {
          const binStart = (i / BINS) * max;
          const binEnd = ((i + 1) / BINS) * max;
          const inCurrent = threshold >= binStart && threshold < binEnd;
          const inSuggested = suggested !== null && suggested >= binStart && suggested < binEnd;
          return (
            <View key={i} style={styles.binColumn}>
              <View style={styles.bars}>
                <View
                  style={[
                    styles.bar,
                    styles.fishBar,
                    { height: `${((fishBins[i] ?? 0) / peak) * 100}%` },
                  ]}
                />
                <View
                  style={[
                    styles.bar,
                    styles.waveBar,
                    { height: `${((waveBins[i] ?? 0) / peak) * 100}%` },
                  ]}
                />
              </View>
              {(inCurrent || inSuggested) && (
                <View
                  style={[styles.marker, inSuggested ? styles.markerSuggested : styles.markerCurrent]}
                />
              )}
              <Text style={styles.binLabel}>{Math.round(binStart)}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.legend}>
        <Legend colour={colors.accent} label={`fish (${fish.length})`} />
        <Legend colour={colors.primary} label={`wave (${wave.length})`} />
        <Legend colour={colors.text} label="current" />
        <Legend colour={colors.success} label="suggested" />
      </View>
      <Text style={styles.axis}>onset rate, °/s</Text>
    </View>
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: colour }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function Stats({ label, d }: { label: string; d: Distribution | null }) {
  if (!d) return <Text style={styles.hint}>{label}: none labelled</Text>;
  return (
    <Text style={styles.hint}>
      {label}: n={d.count} · median {Math.round(d.median)} · p10–p90 {Math.round(d.p10)}–
      {Math.round(d.p90)} °/s
    </Text>
  );
}

export default function CalibrationScreen() {
  const [recordings, setRecordings] = useState<RecordingSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const params = useDetectionParamsStore((s) => s.params);
  const setParam = useDetectionParamsStore((s) => s.set);

  const refresh = useCallback(() => {
    void listRecordings().then((rs) => {
      setRecordings(rs);
      setSelected((cur) => cur ?? rs[0]?.id ?? null);
    });
  }, []);

  useEffect(refresh, [refresh]);

  const events = useMemo(() => {
    if (!recordings) return [];
    if (selected === 'ALL') return recordings.flatMap((r) => r.events);
    return recordings.find((r) => r.id === selected)?.events ?? [];
  }, [recordings, selected]);

  const result = useMemo(() => calibrate(events), [events]);
  const labelled = useMemo(() => labelCrossings(events), [events]);

  const fish = labelled.filter((l) => l.label === 'fish').map((l) => l.onsetRateDegPerS);
  const wave = labelled.filter((l) => l.label === 'wave').map((l) => l.onsetRateDegPerS);

  if (recordings === null) {
    return <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />;
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Session</Text>
      <View style={styles.chipRow}>
        <Pressable
          style={[styles.chip, selected === 'ALL' && styles.chipOn]}
          onPress={() => setSelected('ALL')}
        >
          <Text style={[styles.chipText, selected === 'ALL' && styles.chipTextOn]}>All</Text>
        </Pressable>
        {recordings.map((r) => (
          <Pressable
            key={r.id}
            style={[styles.chip, selected === r.id && styles.chipOn]}
            onPress={() => setSelected(r.id)}
          >
            <Text style={[styles.chipText, selected === r.id && styles.chipTextOn]}>
              {r.label || new Date(r.startedAt).toLocaleDateString()}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Onset rate distribution</Text>
      <View style={styles.card}>
        {fish.length === 0 && wave.length === 0 ? (
          <Text style={styles.hint}>
            Nothing labelled in this session. During a capture, tap FISH when you see a real
            fish and WAVE when the rod moves because of swell.
          </Text>
        ) : (
          <Distributions
            fish={fish}
            wave={wave}
            threshold={params.onsetRateMinDegPerS}
            suggested={result.suggestedThreshold}
          />
        )}
        <Stats label="Fish" d={result.fish} />
        <Stats label="Wave" d={result.wave} />
        {result.unmeasurable > 0 && (
          <Text style={styles.warn}>
            {result.unmeasurable} crossing{result.unmeasurable === 1 ? '' : 's'} had no
            measurable onset — packets were dropped on the rising edge. That is a signal
            problem, not a tuning one.
          </Text>
        )}
      </View>

      <Text style={styles.sectionTitle}>Verdict</Text>
      <View style={[styles.card, result.overlapping && styles.cardWarn]}>
        <Text style={[styles.verdict, result.overlapping && styles.verdictWarn]}>
          {result.verdict}
        </Text>
        {result.suggestedThreshold !== null && !result.overlapping && (
          <Pressable
            style={styles.applyBtn}
            onPress={() => setParam('onsetRateMinDegPerS', result.suggestedThreshold!)}
          >
            <Text style={styles.applyText}>
              Apply {result.suggestedThreshold}°/s (current {params.onsetRateMinDegPerS})
            </Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  sectionTitle: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.md,
    marginLeft: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardWarn: { borderColor: colors.danger },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  chipOn: { backgroundColor: colors.primary },
  chipText: { ...typography.caption, color: colors.text },
  chipTextOn: { color: colors.bg, fontWeight: '700' },

  chart: { flexDirection: 'row', height: 140, alignItems: 'flex-end', gap: 2 },
  binColumn: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: '100%', gap: 1, flex: 1 },
  bar: { flex: 1, borderTopLeftRadius: 2, borderTopRightRadius: 2, minHeight: 1 },
  fishBar: { backgroundColor: colors.accent },
  waveBar: { backgroundColor: colors.primary },
  marker: { width: '100%', height: 3, marginTop: 2 },
  markerCurrent: { backgroundColor: colors.text },
  markerSuggested: { backgroundColor: colors.success },
  binLabel: { fontSize: 8, color: colors.textMuted },

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  legendText: { ...typography.caption, color: colors.textMuted },
  axis: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },

  verdict: { ...typography.body, color: colors.text },
  verdictWarn: { color: colors.danger, fontWeight: '700' },
  applyBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  applyText: { ...typography.caption, color: colors.bg, fontWeight: '800' },
  hint: { ...typography.caption, color: colors.textMuted },
  warn: { ...typography.caption, color: colors.accent },
});
