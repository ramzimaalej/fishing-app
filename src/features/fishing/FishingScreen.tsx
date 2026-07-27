import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AD_POLICY,
  maybeShowSessionEndInterstitial,
  prepareSessionAds,
  useAdsStore,
} from '@/features/ads';
import AccelerationChart from '@/features/graph/AccelerationChart';
import {
  armRods,
  disarmAll,
  getSessionBites,
  startSessionLog,
  type RodRuntimeView,
} from '@/features/rods/rodRuntime';
import { useRodStore } from '@/features/rods/rodStore';
import { useAnyArmed, useArmableRods, useRodView } from '@/features/rods/useRodRuntime';
import { useSessionStore } from '@/features/session-report/sessionStore';
import { buildSessionSummary } from '@/features/session-report/sessionSummary';
import SensitivitySlider from '@/features/settings/components/SensitivitySlider';
import { useSettings, useSettingsStore } from '@/features/settings/settingsStore';
import { colors, radius, spacing, typography } from '@/theme';
import type { BiteEvent, EnvironmentSnapshot } from '@/types';

const STATUS_LABEL: Record<string, string> = {
  idle: 'Not armed',
  poweredOff: 'Bluetooth off',
  unauthorized: 'Permission needed',
  scanning: 'Scanning…',
  connecting: 'Connecting…',
  connected: 'Live',
  reconnecting: 'Reconnecting…',
  error: 'Error',
};

const STATUS_COLOR: Record<string, string> = {
  connected: colors.success,
  reconnecting: colors.accent,
  scanning: colors.accent,
  connecting: colors.accent,
  error: colors.danger,
  poweredOff: colors.danger,
  unauthorized: colors.danger,
  idle: colors.textMuted,
};

function BiteBanner({ bite, rodName }: { bite: BiteEvent; rodName: string }) {
  const isBig = bite.size === 'big';
  return (
    <View style={[styles.banner, { borderColor: isBig ? colors.big : colors.small }]}>
      <Text style={styles.bannerEmoji}>{isBig ? '🎣' : '🐟'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.bannerTitle}>
          {isBig ? 'Big fish!' : 'Nibble'} — {rodName}
        </Text>
        <Text style={styles.bannerMeta}>
          Peak {bite.peakMagnitude.toFixed(2)} g · {Math.round(bite.confidence * 100)}% confidence
        </Text>
      </View>
    </View>
  );
}

/** Compact per-rod status card. Tapping it selects that rod's chart. */
function RodCard({
  name,
  view,
  selected,
  onPress,
}: {
  name: string;
  view: RodRuntimeView;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.rodCard, selected && styles.rodCardSelected]} onPress={onPress}>
      <View style={styles.rodCardHeader}>
        <View
          style={[styles.dot, { backgroundColor: STATUS_COLOR[view.status] ?? colors.textMuted }]}
        />
        <Text style={styles.rodCardName} numberOfLines={1}>
          {name}
        </Text>
      </View>
      <Text style={styles.rodCardCount}>{view.biteCount}</Text>
      <Text style={styles.rodCardLabel}>
        {view.status === 'connected' && !view.isWarmedUp
          ? 'Calibrating'
          : (STATUS_LABEL[view.status] ?? view.status)}
      </Text>
      {view.device?.battery != null && (
        <Text style={styles.rodCardBattery}>🔋{view.device.battery}%</Text>
      )}
    </Pressable>
  );
}

export default function FishingScreen() {
  const navigation = useNavigation<{ navigate: (route: string) => void }>();

  // NOTE: the rod-runtime bridge is mounted by MainTabs, not here. Tying it to
  // this screen would disarm every rod the moment the user opened another tab.
  const rods = useRodStore((s) => s.rods);
  const selectedRodId = useRodStore((s) => s.selectedRodId);
  const selectRod = useRodStore((s) => s.selectRod);
  const armable = useArmableRods();
  const anyArmed = useAnyArmed();

  const settings = useSettings();
  const setLiveBaitMode = useSettingsStore((s) => s.setLiveBaitMode);
  const setSensitivity = useSettingsStore((s) => s.setSensitivity);
  const setLastSession = useSessionStore((s) => s.setLast);

  const selected = selectedRodId ?? rods[0]?.id ?? null;
  const selectedView = useRodView(selected);
  const selectedRod = rods.find((r) => r.id === selected) ?? null;

  const [armError, setArmError] = useState<string | null>(null);

  // Session accounting for the report + ad governance. The bite log itself is
  // owned by the runtime (that's where bites are born, across all rods).
  const sessionStartRef = useRef<number | null>(null);
  const sessionConditionsRef = useRef<Partial<EnvironmentSnapshot> | null>(null);

  const onToggleAll = useCallback(async () => {
    setArmError(null);

    if (anyArmed) {
      const startedAt = sessionStartRef.current;
      const endedAt = Date.now();
      const capturedBites = getSessionBites();
      const capturedConditions = sessionConditionsRef.current;

      await disarmAll();
      sessionStartRef.current = null;
      useAdsStore.getState().setFishingActive(false);

      const seconds = startedAt !== null ? (endedAt - startedAt) / 1000 : 0;
      const reportable = startedAt !== null && seconds >= AD_POLICY.interstitial.minSessionSeconds;
      if (reportable) {
        useAdsStore.getState().recordCompletedSession();
        setLastSession(
          buildSessionSummary({
            startedAt,
            endedAt,
            bites: capturedBites,
            conditions: capturedConditions,
          }),
        );
      }

      // One interstitial at session end, then the report. See adPolicy.ts.
      setTimeout(() => {
        maybeShowSessionEndInterstitial(seconds, () => {
          if (reportable) navigation.navigate('SessionReport');
        });
      }, 900);
      return;
    }

    if (armable.length === 0) {
      setArmError('Add a rod first.');
      return;
    }

    sessionStartRef.current = Date.now();
    sessionConditionsRef.current = null;
    startSessionLog();
    useAdsStore.getState().setFishingActive(true);
    prepareSessionAds();

    const errors = await armRods(armable);
    if (errors.length > 0) setArmError(errors.join('\n'));
    // Every rod failed → there is no session to report on.
    if (errors.length === armable.length) {
      sessionStartRef.current = null;
      useAdsStore.getState().setFishingActive(false);
    }
  }, [anyArmed, armable, navigation, setLastSession]);

  useEffect(() => () => useAdsStore.getState().setFishingActive(false), []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Fishing</Text>
            <Text style={styles.subtitle}>
              {armable.length} {armable.length === 1 ? 'rod' : 'rods'}
              {anyArmed ? ' · monitoring' : ' · idle'}
            </Text>
          </View>
          <Pressable
            style={[styles.armBtn, anyArmed && styles.armBtnActive]}
            onPress={() => void onToggleAll()}
          >
            <Text style={styles.armBtnText}>{anyArmed ? 'Stop' : 'Start'}</Text>
          </Pressable>
        </View>

        {armError && <Text style={styles.errorText}>{armError}</Text>}

        {/* Rod strip — every armed rod is visible at a glance, which is the
            whole point of multi-rod: knowing WHICH rod went off. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.rodStrip}>
          {rods.map((rod) => (
            <RodCardBinding
              key={rod.id}
              rodId={rod.id}
              name={rod.name}
              selected={rod.id === selected}
              onPress={() => selectRod(rod.id)}
            />
          ))}
          <Pressable style={styles.addRodCard} onPress={() => navigation.navigate('Rods')}>
            <Text style={styles.addRodPlus}>＋</Text>
            <Text style={styles.rodCardLabel}>Manage</Text>
          </Pressable>
        </ScrollView>

        {selectedRod && (
          <>
            <Text style={styles.chartTitle}>{selectedRod.name}</Text>
            <AccelerationChart points={selectedView.points} bites={selectedView.bites} />
            <View style={styles.statsRow}>
              <Stat label="Bites" value={String(selectedView.biteCount)} />
              <Stat label="Threshold" value={`${selectedView.threshold.toFixed(2)} g`} />
              <Stat
                label="Sensor"
                value={
                  selectedView.status === 'connected'
                    ? selectedView.isWarmedUp
                      ? 'Ready'
                      : 'Calibrating'
                    : (STATUS_LABEL[selectedView.status] ?? '—')
                }
              />
            </View>
          </>
        )}

        {selectedView.lastBite && selectedRod && (
          <BiteBanner bite={selectedView.lastBite} rodName={selectedRod.name} />
        )}

        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchTitle}>Live bait mode</Text>
              <Text style={styles.switchSub}>
                Filters constant bait motion — applies to every rod
              </Text>
            </View>
            <Switch
              value={settings.liveBaitMode}
              onValueChange={setLiveBaitMode}
              trackColor={{ true: colors.primaryDark, false: colors.surfaceAlt }}
              thumbColor={settings.liveBaitMode ? colors.primary : colors.textMuted}
            />
          </View>
          <View style={styles.divider} />
          <SensitivitySlider value={settings.sensitivity} onChange={setSensitivity} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Subscribes one rod's view — a component per rod keeps the hook rule intact. */
function RodCardBinding({
  rodId,
  name,
  selected,
  onPress,
}: {
  rodId: string;
  name: string;
  selected: boolean;
  onPress: () => void;
}) {
  const view = useRodView(rodId);
  return <RodCard name={name} view={view} selected={selected} onPress={onPress} />;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textMuted },
  armBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  armBtnActive: { backgroundColor: colors.surfaceAlt },
  armBtnText: { ...typography.h3, color: colors.text },
  errorText: { ...typography.caption, color: colors.danger },
  rodStrip: { marginHorizontal: -spacing.md, paddingHorizontal: spacing.md },
  rodCard: {
    width: 104,
    marginRight: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 2,
  },
  rodCardSelected: { borderColor: colors.primary },
  rodCardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rodCardName: { ...typography.caption, color: colors.text, flex: 1, fontWeight: '600' },
  rodCardCount: { ...typography.h2, color: colors.primary },
  rodCardLabel: { ...typography.caption, color: colors.textMuted },
  rodCardBattery: { ...typography.caption, color: colors.textMuted },
  addRodCard: {
    width: 104,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  addRodPlus: { fontSize: 24, color: colors.primary },
  chartTitle: { ...typography.h3, color: colors.text },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: { ...typography.h2, color: colors.primary },
  statLabel: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 2,
  },
  bannerEmoji: { fontSize: 28 },
  bannerTitle: { ...typography.h3, color: colors.text },
  bannerMeta: { ...typography.caption, color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  switchTitle: { ...typography.h3, color: colors.text },
  switchSub: { ...typography.caption, color: colors.textMuted },
  divider: { height: 1, backgroundColor: colors.border },
});
