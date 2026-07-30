import { useNavigation } from '@react-navigation/native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FREE_FORECAST_DAYS } from '@/config/constants';
import { formatCoords, formatPlace } from '@/features/location/location';
import { useLocationStore } from '@/features/location/locationStore';
import { intlTag } from '@/i18n/formatting';
import { useEntitlements } from '@/features/subscription/useEntitlements';
import { colors, radius, spacing, typography } from '@/theme';
import type { EnvironmentSnapshot } from '@/types';

import { type DayForecast, useEnvironment } from './useEnvironment';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number): string => COMPASS[Math.round(deg / 45) % 8]!;
const hourLabel = (iso: string): string =>
  new Date(iso).toLocaleTimeString(intlTag(), { hour: 'numeric' });

const activityColor = (v: number): string =>
  v >= 0.66 ? colors.success : v >= 0.4 ? colors.accent : colors.textMuted;

/**
 * "Today" / "Tomorrow" / "Wed 30" for a local yyyy-mm-dd key.
 * Takes `t` rather than calling a hook: this is a plain helper, and the weekday
 * comes from Intl so it is localised without needing a translation key per day.
 */
function dayLabel(date: string, index: number, t: TFunction): string {
  if (index === 0) return t('conditions.today');
  if (index === 1) return t('conditions.tomorrow');
  const [y, m, d] = date.split('-').map(Number);
  const when = new Date(y!, m! - 1, d!);
  return `${when.toLocaleDateString(intlTag(), { weekday: 'short' })} ${when.getDate()}`;
}

function ActivityMeter({ value }: { value: number }) {
  const { t } = useTranslation();
  const pct = Math.round(value * 100);
  const barColor = activityColor(value);
  return (
    <View style={styles.meterWrap}>
      <View style={styles.meterHeader}>
        <Text style={styles.meterTitle}>{t('conditions.fishActivity')}</Text>
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
  const { t } = useTranslation();
  return (
    <View style={styles.card}>
      <ActivityMeter value={s.fishActivity} />
      <View style={styles.tileGrid}>
        <StatTile label={t('conditions.pressure')} value={s.pressure.toFixed(0)} unit="hPa" />
        <StatTile label={t('conditions.temperature')} value={s.temperature.toFixed(1)} unit="°C" />
        <StatTile
          label={t('conditions.wind')}
          value={s.windSpeed.toFixed(1)}
          unit={`m/s ${compass(s.windDirection)}`}
        />
        <StatTile label={t('conditions.waveHeight')} value={s.waveHeight.toFixed(2)} unit="m" />
        <StatTile
          label={t('conditions.tide')}
          value={s.tide ? s.tide.state : '—'}
          unit={s.tide ? `${s.tide.height.toFixed(2)} m` : undefined}
        />
        <StatTile
          label={t('conditions.moon')}
          value={s.moon.name}
          unit={`${Math.round(s.moon.illuminationFraction * 100)}%`}
        />
      </View>
    </View>
  );
}

function HourColumn({ s }: { s: EnvironmentSnapshot }) {
  const pct = Math.round(s.fishActivity * 100);
  const barColor = activityColor(s.fishActivity);
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

/** A day row in the multi-day outlook; tapping it reveals that day's hours. */
function DayRow({
  day,
  index,
  expanded,
  onToggle,
}: {
  day: DayForecast;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const pct = Math.round(day.peak.fishActivity * 100);
  const barColor = activityColor(day.peak.fishActivity);
  return (
    <View style={styles.dayWrap}>
      <Pressable style={styles.dayRow} onPress={onToggle}>
        <Text style={styles.dayLabel}>{dayLabel(day.date, index, t)}</Text>
        <View style={styles.dayBarTrack}>
          <View
            style={[styles.dayBarFill, { width: `${pct}%`, backgroundColor: barColor }]}
          />
        </View>
        <Text style={[styles.dayPct, { color: barColor }]}>{pct}%</Text>
        <Text style={styles.dayPeak}>{hourLabel(day.peak.time)}</Text>
        <Text style={styles.dayChevron}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>

      {expanded && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hourRow}>
          {day.hours.map((h) => (
            <HourColumn key={h.time} s={h} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

export default function EnvironmentScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<{ navigate: (route: string) => void }>();
  const { hasLocation, hourly, daily, current, loading, error, refresh } = useEnvironment();

  // Which location these numbers describe. Shown always, not tucked away: a
  // forecast without a visible place is how the old build served Californian
  // tides to everyone without anyone noticing.
  const mode = useLocationStore((st) => st.mode);
  const device = useLocationStore((st) => st.device);
  const manual = useLocationStore((st) => st.manual);
  const refreshIfStale = useLocationStore((st) => st.refreshIfStale);
  const locationLabel =
    mode === 'manual' && manual
      ? formatPlace(manual)
      : device
        ? formatCoords(device.coords)
        : null;

  // Silent: only refreshes an already-granted fix, never prompts.
  useEffect(() => {
    void refreshIfStale();
  }, [refreshIfStale]);
  const { has } = useEntitlements();
  const [expanded, setExpanded] = useState<string | null>(null);

  const fullOutlook = has('extended-forecast');
  const visibleDays = fullOutlook ? daily : daily.slice(0, FREE_FORECAST_DAYS);
  const lockedDays = daily.length - visibleDays.length;


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
        <Text style={styles.title}>{t('conditions.title')}</Text>

        <Pressable style={styles.locationRow} onPress={() => navigation.navigate('Location')}>
          <Text style={styles.locationPin}>📍</Text>
          <Text style={styles.locationLabel} numberOfLines={1}>
            {locationLabel ?? t('location.notSet')}
          </Text>
          <Text style={styles.locationChange}>{t('location.change')}</Text>
        </Pressable>

        {!hasLocation && (
          <Pressable
            style={styles.noLocationCard}
            onPress={() => navigation.navigate('Location')}
          >
            <Text style={styles.noLocationTitle}>{t('location.neededTitle')}</Text>
            <Text style={styles.noLocationSub}>{t('location.neededSub')}</Text>
          </Pressable>
        )}

        {hasLocation && loading && hourly.length === 0 && (
          <View style={styles.centerBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>{t('conditions.loading')}</Text>
          </View>
        )}

        {error && hourly.length === 0 && (
          <View style={styles.centerBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.muted}>{t('common.retry')}</Text>
          </View>
        )}

        {current && <CurrentConditions s={current} />}

        {best && (
          <Text style={styles.bestLine}>
            {t('conditions.bestWindow', {
              time: hourLabel(best.time),
              percent: Math.round(best.fishActivity * 100),
            })}
          </Text>
        )}

        {hourly.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t('conditions.hourlyForecast')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hourRow}>
              {hourly.map((h) => (
                <HourColumn key={h.time} s={h} />
              ))}
            </ScrollView>
          </>
        )}

        {daily.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t('conditions.outlook')}</Text>
            <View style={styles.card}>
              {visibleDays.map((d, i) => (
                <DayRow
                  key={d.date}
                  day={d}
                  index={i}
                  expanded={expanded === d.date}
                  onToggle={() => setExpanded(expanded === d.date ? null : d.date)}
                />
              ))}

              {lockedDays > 0 && (
                <View style={styles.lockedRow}>
                  <Text style={styles.lockedText}>
                    {t('conditions.lockedDays', { count: lockedDays })}
                  </Text>
                </View>
              )}
            </View>
          </>
        )}


        <Pressable style={styles.calendarLink} onPress={() => navigation.navigate('BestTimes')}>
          <Text style={styles.calendarLinkEmoji}>🌙</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.calendarLinkTitle}>{t('conditions.bestTimesLink')}</Text>
            <Text style={styles.calendarLinkSub}>{t('conditions.bestTimesSub')}</Text>
          </View>
          <Text style={styles.calendarLinkChevron}>›</Text>
        </Pressable>
      </ScrollView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  title: { ...typography.h1, color: colors.text },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  locationPin: { fontSize: 13 },
  locationLabel: { ...typography.caption, color: colors.text, flex: 1 },
  locationChange: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  noLocationCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    padding: spacing.md,
    gap: spacing.xs,
  },
  noLocationTitle: { ...typography.h3, color: colors.text },
  noLocationSub: { ...typography.caption, color: colors.textMuted },
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
  dayWrap: { gap: spacing.xs },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dayLabel: { ...typography.body, color: colors.text, width: 76 },
  dayBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  dayBarFill: { height: '100%', borderRadius: radius.pill },
  dayPct: { ...typography.caption, width: 34, textAlign: 'right', fontWeight: '700' },
  dayPeak: { ...typography.caption, color: colors.textMuted, width: 48, textAlign: 'right' },
  dayChevron: { ...typography.caption, color: colors.textMuted, width: 12 },
  lockedRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    alignItems: 'center',
  },
  lockedText: { ...typography.caption, color: colors.textMuted },
  calendarLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  calendarLinkEmoji: { fontSize: 24 },
  calendarLinkTitle: { ...typography.h3, color: colors.text },
  calendarLinkSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  calendarLinkChevron: { ...typography.h2, color: colors.textMuted },
  centerBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  muted: { ...typography.body, color: colors.textMuted },
  errorText: { ...typography.body, color: colors.danger, textAlign: 'center' },
});
