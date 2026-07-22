import { useMemo } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdBanner, PremiumPreviewCard } from '@/features/ads';
import { colors, radius, spacing, typography } from '@/theme';
import type { EnvironmentSnapshot } from '@/types';

import { useEnvironment } from './useEnvironment';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number): string => COMPASS[Math.round(deg / 45) % 8]!;
const hourLabel = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric' });

function ActivityMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const barColor = value >= 0.66 ? colors.success : value >= 0.4 ? colors.accent : colors.textMuted;
  return (
    <View style={styles.meterWrap}>
      <View style={styles.meterHeader}>
        <Text style={styles.meterTitle}>Fish activity</Text>
        <Text style={[styles.meterPct, { color: barColor }]}>{pct}%</Text>
      </View>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${pct}%`, backgroundColor: barColor }]} />
      </View>
    </View>
  );
}

function StatTile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>
        {value}
        {unit ? <Text style={styles.tileUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

function CurrentConditions({ s }: { s: EnvironmentSnapshot }) {
  return (
    <View style={styles.card}>
      <ActivityMeter value={s.fishActivity} />
      <View style={styles.tileGrid}>
        <StatTile label="Pressure" value={s.pressure.toFixed(0)} unit="hPa" />
        <StatTile label="Temperature" value={s.temperature.toFixed(1)} unit="°C" />
        <StatTile
          label="Wind"
          value={s.windSpeed.toFixed(1)}
          unit={`m/s ${compass(s.windDirection)}`}
        />
        <StatTile label="Wave height" value={s.waveHeight.toFixed(2)} unit="m" />
        <StatTile
          label="Tide"
          value={s.tide ? s.tide.state : '—'}
          unit={s.tide ? `${s.tide.height.toFixed(2)} m` : undefined}
        />
        <StatTile
          label="Moon"
          value={s.moon.name}
          unit={`${Math.round(s.moon.illuminationFraction * 100)}%`}
        />
      </View>
    </View>
  );
}

function HourColumn({ s }: { s: EnvironmentSnapshot }) {
  const pct = Math.round(s.fishActivity * 100);
  const barColor = s.fishActivity >= 0.66 ? colors.success : s.fishActivity >= 0.4 ? colors.accent : colors.textMuted;
  return (
    <View style={styles.hourCol}>
      <Text style={styles.hourTime}>{hourLabel(s.time)}</Text>
      <View style={styles.hourBarTrack}>
        <View style={[styles.hourBarFill, { height: `${pct}%`, backgroundColor: barColor }]} />
      </View>
      <Text style={styles.hourPct}>{pct}%</Text>
      <Text style={styles.hourMeta}>{s.temperature.toFixed(0)}°</Text>
      <Text style={styles.hourMeta}>{s.windSpeed.toFixed(0)}m/s</Text>
    </View>
  );
}

export default function EnvironmentScreen() {
  const { hourly, current, loading, error, refresh } = useEnvironment();

  const best = useMemo(() => {
    let top: EnvironmentSnapshot | null = null;
    for (const h of hourly) if (!top || h.fishActivity > top.fishActivity) top = h;
    return top;
  }, [hourly]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primary} />
        }
      >
        <Text style={styles.title}>Conditions</Text>

        {loading && hourly.length === 0 && (
          <View style={styles.centerBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>Loading local conditions…</Text>
          </View>
        )}

        {error && hourly.length === 0 && (
          <View style={styles.centerBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.muted}>Pull down to retry.</Text>
          </View>
        )}

        {current && <CurrentConditions s={current} />}

        {best && (
          <Text style={styles.bestLine}>
            🎣 Best window today around {hourLabel(best.time)} ({Math.round(best.fishActivity * 100)}%)
          </Text>
        )}

        {hourly.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Hourly forecast</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hourRow}>
              {hourly.map((h) => (
                <HourColumn key={h.time} s={h} />
              ))}
            </ScrollView>
          </>
        )}

        {/* Opt-in rewarded slot: renders only when an ad is actually loaded. */}
        <PremiumPreviewCard />
      </ScrollView>

      {/* Planning surface — the anchored banner lives here, never on Fishing. */}
      <AdBanner placement="conditions" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  title: { ...typography.h1, color: colors.text },
  sectionTitle: { ...typography.h3, color: colors.text, marginTop: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  meterWrap: { gap: spacing.xs },
  meterHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  meterTitle: { ...typography.h3, color: colors.text },
  meterPct: { ...typography.h2 },
  meterTrack: {
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  meterFill: { height: '100%', borderRadius: radius.pill },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 100,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  tileLabel: { ...typography.caption, color: colors.textMuted },
  tileValue: { ...typography.h3, color: colors.text, marginTop: 2 },
  tileUnit: { ...typography.caption, color: colors.textMuted },
  bestLine: { ...typography.body, color: colors.accent, textAlign: 'center' },
  hourRow: { marginHorizontal: -spacing.md, paddingHorizontal: spacing.md },
  hourCol: {
    width: 56,
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.sm,
  },
  hourTime: { ...typography.caption, color: colors.textMuted },
  hourBarTrack: {
    width: 10,
    height: 90,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  hourBarFill: { width: '100%', borderRadius: radius.pill },
  hourPct: { ...typography.caption, color: colors.text },
  hourMeta: { ...typography.caption, color: colors.textMuted },
  centerBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  muted: { ...typography.body, color: colors.textMuted },
  errorText: { ...typography.body, color: colors.danger, textAlign: 'center' },
});
