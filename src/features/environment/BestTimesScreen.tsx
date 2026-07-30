import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '@/theme';

import {
  bestDays,
  type DayOutlook,
  monthOutlook,
  monthStartWeekday,
  type SolunarRating,
} from './solunar';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const RATING_COLOR: Record<SolunarRating, string> = {
  excellent: colors.success,
  good: colors.primary,
  fair: colors.accent,
  poor: colors.textMuted,
};

/** Month shifted by `offset` from today, anchored on the 1st (never overflows). */
function monthAnchor(offset: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + offset, 1);
}

function todayKey(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function DayCell({
  outlook,
  isToday,
  selected,
  onPress,
}: {
  outlook: DayOutlook;
  isToday: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const color = RATING_COLOR[outlook.rating];
  return (
    <Pressable
      style={[styles.cell, selected && styles.cellSelected, isToday && styles.cellToday]}
      onPress={onPress}
    >
      <Text style={[styles.cellDay, isToday && styles.cellDayToday]}>{outlook.day}</Text>
      <View style={styles.cellBarTrack}>
        <View
          style={[
            styles.cellBarFill,
            { height: `${Math.round(outlook.score * 100)}%`, backgroundColor: color },
          ]}
        />
      </View>
    </Pressable>
  );
}

export default function BestTimesScreen() {
  const { t } = useTranslation();
  const [monthOffset, setMonthOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const anchor = useMemo(() => monthAnchor(monthOffset), [monthOffset]);
  const outlook = useMemo(() => monthOutlook(anchor), [anchor]);
  const leadingBlanks = useMemo(() => monthStartWeekday(anchor), [anchor]);
  const top = useMemo(() => bestDays(outlook, 5), [outlook]);

  const today = todayKey();
  const selectedDay = outlook.find((d) => d.date === selected) ?? null;

  const monthTitle = anchor.toLocaleDateString([], { month: 'long', year: 'numeric' });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('bestTimes.title')}</Text>
        <Text style={styles.subtitle}>{t('bestTimes.subtitle')}</Text>

        <View style={styles.monthHeader}>
          <Pressable hitSlop={12} onPress={() => setMonthOffset(monthOffset - 1)}>
            <Text style={styles.monthNav}>‹</Text>
          </Pressable>
          <Text style={styles.monthTitle}>{monthTitle}</Text>
          <Pressable hitSlop={12} onPress={() => setMonthOffset(monthOffset + 1)}>
            <Text style={styles.monthNav}>›</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <View style={styles.weekRow}>
            {WEEKDAYS.map((d, i) => (
              <Text key={`${d}-${i}`} style={styles.weekday}>
                {d}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {Array.from({ length: leadingBlanks }, (_, i) => (
              <View key={`blank-${i}`} style={styles.cell} />
            ))}
            {outlook.map((d) => (
              <DayCell
                key={d.date}
                outlook={d}
                isToday={d.date === today}
                selected={d.date === selected}
                onPress={() => setSelected(d.date === selected ? null : d.date)}
              />
            ))}
          </View>

          <View style={styles.legend}>
            {(['excellent', 'good', 'fair', 'poor'] as SolunarRating[]).map((r) => (
              <View key={r} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: RATING_COLOR[r] }]} />
                <Text style={styles.legendText}>{t(`bestTimes.ratings.${r}`)}</Text>
              </View>
            ))}
          </View>
        </View>

        {selectedDay && (
          <View style={styles.card}>
            <Text style={styles.detailTitle}>
              {new Date(anchor.getFullYear(), anchor.getMonth(), selectedDay.day).toLocaleDateString(
                [],
                { weekday: 'long', month: 'long', day: 'numeric' },
              )}
            </Text>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('bestTimes.rating')}</Text>
              <Text style={[styles.detailValue, { color: RATING_COLOR[selectedDay.rating] }]}>
                {t(`bestTimes.ratings.${selectedDay.rating}`)} · {Math.round(selectedDay.score * 100)}%
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t('bestTimes.moon')}</Text>
              <Text style={styles.detailValue}>
                {selectedDay.moon.name} ·{' '}
                {Math.round(selectedDay.moon.illuminationFraction * 100)}% lit
              </Text>
            </View>
            <Text style={styles.detailHint}>{t('bestTimes.hint')}</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>{t('bestTimes.topDays')}</Text>
        <View style={styles.card}>
          {top.map((d) => (
            <Pressable key={d.date} style={styles.topRow} onPress={() => setSelected(d.date)}>
              <View style={[styles.legendDot, { backgroundColor: RATING_COLOR[d.rating] }]} />
              <Text style={styles.topDate}>
                {new Date(anchor.getFullYear(), anchor.getMonth(), d.day).toLocaleDateString([], {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </Text>
              <Text style={styles.topMoon} numberOfLines={1}>
                {d.moon.name}
              </Text>
              <Text style={[styles.topScore, { color: RATING_COLOR[d.rating] }]}>
                {Math.round(d.score * 100)}%
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textMuted },
  sectionTitle: { ...typography.h3, color: colors.text, marginTop: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthTitle: { ...typography.h3, color: colors.text },
  monthNav: { ...typography.h1, color: colors.primary, paddingHorizontal: spacing.md },
  weekRow: { flexDirection: 'row' },
  weekday: {
    ...typography.caption,
    color: colors.textMuted,
    width: `${100 / 7}%`,
    textAlign: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    alignItems: 'center',
    paddingVertical: spacing.xs,
    gap: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cellSelected: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  cellToday: { backgroundColor: colors.surfaceAlt },
  cellDay: { ...typography.caption, color: colors.text },
  cellDayToday: { color: colors.primary, fontWeight: '700' },
  cellBarTrack: {
    width: 8,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  cellBarFill: { width: '100%', borderRadius: radius.pill },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { ...typography.caption, color: colors.textMuted },
  detailTitle: { ...typography.h3, color: colors.text },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailLabel: { ...typography.body, color: colors.textMuted },
  detailValue: { ...typography.body, color: colors.text, fontWeight: '600' },
  detailHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  topDate: { ...typography.body, color: colors.text, width: 110 },
  topMoon: { ...typography.caption, color: colors.textMuted, flex: 1 },
  topScore: { ...typography.body, fontWeight: '700' },
});
