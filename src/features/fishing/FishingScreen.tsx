import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AD_POLICY,
  maybeShowSessionEndInterstitial,
  prepareSessionAds,
  useAdsStore,
} from '@/features/ads';
import { useBleStore } from '@/features/ble/bleStore';
import { getSensorDevice, listSensorDevices, type SensorKind } from '@/features/ble/deviceRegistry';
import { useBiteDetection } from '@/features/bite-detection/useBiteDetection';
import { getCurrentConditions } from '@/features/environment/useEnvironment';
import AccelerationChart from '@/features/graph/AccelerationChart';
import { useSessionStore } from '@/features/session-report/sessionStore';
import {
  buildSessionSummary,
  type SessionBite,
} from '@/features/session-report/sessionSummary';
import SensitivitySlider from '@/features/settings/components/SensitivitySlider';
import { useSettings, useSettingsStore } from '@/features/settings/settingsStore';
import { colors, radius, spacing, typography } from '@/theme';
import type { BiteEvent, EnvironmentSnapshot } from '@/types';

const STATUS_LABEL: Record<string, string> = {
  idle: 'Not connected',
  poweredOff: 'Bluetooth off',
  unauthorized: 'Permission needed',
  scanning: 'Scanning…',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  error: 'Connection error',
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

function BiteBanner({ bite }: { bite: BiteEvent }) {
  const isBig = bite.size === 'big';
  return (
    <View style={[styles.banner, { borderColor: isBig ? colors.big : colors.small }]}>
      <Text style={styles.bannerEmoji}>{isBig ? '🎣' : '🐟'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.bannerTitle}>{isBig ? 'Big fish!' : 'Nibble'}</Text>
        <Text style={styles.bannerMeta}>
          Peak {bite.peakMagnitude.toFixed(2)} g · {Math.round(bite.confidence * 100)}% confidence
        </Text>
      </View>
    </View>
  );
}

export default function FishingScreen() {
  const status = useBleStore((s) => s.status);
  const device = useBleStore((s) => s.device);
  const bleError = useBleStore((s) => s.error);
  const connect = useBleStore((s) => s.connect);
  const disconnect = useBleStore((s) => s.disconnect);
  const deviceKind = useBleStore((s) => s.deviceKind);
  const setDeviceKind = useBleStore((s) => s.setDeviceKind);

  const settings = useSettings();
  const setLiveBaitMode = useSettingsStore((s) => s.setLiveBaitMode);
  const setSensitivity = useSettingsStore((s) => s.setSensitivity);

  const navigation = useNavigation<{ navigate: (route: string) => void }>();
  const setLastSession = useSessionStore((s) => s.setLast);

  const [lastBite, setLastBite] = useState<BiteEvent | null>(null);

  // Bites accumulated for this session's report. Stamped with WALL-CLOCK time
  // here because BiteEvent.timestamp is a device-clock value that cannot be
  // placed on a real timeline (see types/index.ts).
  const sessionBitesRef = useRef<SessionBite[]>([]);
  // Conditions captured once at session start, for the report's context card.
  const sessionConditionsRef = useRef<Partial<EnvironmentSnapshot> | null>(null);

  // This screen is deliberately AD-FREE: nothing may interrupt or crowd the
  // live detection surface (see features/ads/adPolicy.ts for the doctrine).
  const onBite = useCallback((bite: BiteEvent) => {
    sessionBitesRef.current.push({ event: bite, at: Date.now() });
    setLastBite(bite);
  }, []);

  const { points, bites, threshold, isWarmedUp, sessionCount, clear } = useBiteDetection({ onBite });

  const isConnected = status === 'connected' || status === 'reconnecting';
  const isBusy = status === 'connecting' || status === 'scanning';

  // Session lifecycle for ad governance: mark active (hard-blocks any ad),
  // warm the session-end interstitial, and count meaningful sessions.
  const sessionStartRef = useRef<number | null>(null);
  useEffect(() => {
    const ads = useAdsStore.getState();
    if (isConnected && sessionStartRef.current === null) {
      sessionStartRef.current = Date.now();
      sessionBitesRef.current = [];
      sessionConditionsRef.current = null;
      ads.setFishingActive(true);
      prepareSessionAds();
      // Best-effort context for the report; never blocks or fails the session.
      void getCurrentConditions().then((c) => {
        sessionConditionsRef.current = c;
      });
    } else if (!isConnected && sessionStartRef.current !== null) {
      const seconds = (Date.now() - sessionStartRef.current) / 1000;
      sessionStartRef.current = null;
      ads.setFishingActive(false);
      if (seconds >= AD_POLICY.interstitial.minSessionSeconds) ads.recordCompletedSession();
    }
  }, [isConnected]);
  useEffect(() => () => useAdsStore.getState().setFishingActive(false), []);

  const onConnectPress = () => {
    if (isConnected) {
      const startedAt = sessionStartRef.current;
      const endedAt = Date.now();
      const capturedBites = sessionBitesRef.current;
      const capturedConditions = sessionConditionsRef.current;

      void disconnect();
      clear();
      setLastBite(null);

      const seconds = startedAt !== null ? (endedAt - startedAt) / 1000 : 0;

      // Debrief any session worth counting. Below that threshold it was a quick
      // fiddle with the sensor, not a trip.
      const reportable = startedAt !== null && seconds >= AD_POLICY.interstitial.minSessionSeconds;
      if (reportable) {
        setLastSession(
          buildSessionSummary({
            startedAt,
            endedAt,
            bites: capturedBites,
            conditions: capturedConditions,
          }),
        );
      }
      sessionBitesRef.current = [];

      // The ONLY interstitial trigger in the app: the user chose to end the
      // session. Dropped connections never lead here. Delay lets the
      // disconnect UI settle; the policy gate applies caps/cooldowns/grace.
      //
      // The report is deliberately NOT a second full-screen trigger — it opens
      // once the ad is dismissed (or immediately if none showed), so ending a
      // session still costs the user at most one interstitial.
      setTimeout(() => {
        maybeShowSessionEndInterstitial(seconds, () => {
          if (reportable) navigation.navigate('SessionReport');
        });
      }, 900);
    } else {
      void connect();
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Fishing</Text>
            <View style={styles.statusRow}>
              <View
                style={[styles.dot, { backgroundColor: STATUS_COLOR[status] ?? colors.textMuted }]}
              />
              <Text style={styles.statusText}>
                {STATUS_LABEL[status] ?? status}
                {device && isConnected ? ` · ${device.name}` : ''}
                {device?.battery != null && isConnected ? ` · 🔋${device.battery}%` : ''}
              </Text>
            </View>
          </View>
          <Pressable
            style={[styles.connectBtn, isConnected && styles.connectBtnActive]}
            onPress={onConnectPress}
            disabled={isBusy}
          >
            <Text style={styles.connectBtnText}>
              {isConnected ? 'Disconnect' : isBusy ? '…' : 'Connect'}
            </Text>
          </Pressable>
        </View>

        {bleError && !isConnected && <Text style={styles.errorText}>{bleError}</Text>}

        {!isConnected && !isBusy && (
          <DeviceSelector selected={deviceKind} onSelect={setDeviceKind} />
        )}

        <AccelerationChart points={points} bites={bites} />

        <View style={styles.statsRow}>
          <Stat label="Bites this session" value={String(sessionCount)} />
          <Stat label="Threshold" value={`${threshold.toFixed(2)} g`} />
          <Stat label="Sensor" value={isWarmedUp ? 'Ready' : isConnected ? 'Calibrating' : '—'} />
        </View>

        {lastBite && <BiteBanner bite={lastBite} />}

        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchTitle}>Live bait mode</Text>
              <Text style={styles.switchSub}>Filters constant bait motion for cleaner detection</Text>
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
      </View>
    </SafeAreaView>
  );
}

function DeviceSelector({
  selected,
  onSelect,
}: {
  selected: SensorKind;
  onSelect: (kind: SensorKind) => void;
}) {
  const devices = listSensorDevices();
  return (
    <View style={styles.selector}>
      <Text style={styles.selectorLabel}>Sensor</Text>
      <View style={styles.chipRow}>
        {devices.map((d) => {
          const active = d.kind === selected;
          return (
            <Pressable
              key={d.kind}
              onPress={() => onSelect(d.kind)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{d.short}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.selectorHint}>{getSensorDevice(selected).description}</Text>
    </View>
  );
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
  content: { flex: 1, padding: spacing.md, gap: spacing.md },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { ...typography.h1, color: colors.text },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { ...typography.caption, color: colors.textMuted },
  connectBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  connectBtnActive: { backgroundColor: colors.surfaceAlt },
  connectBtnText: { ...typography.h3, color: colors.text },
  errorText: { ...typography.caption, color: colors.danger },
  selector: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  selectorLabel: { ...typography.caption, color: colors.textMuted, textTransform: 'uppercase' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textMuted },
  chipTextActive: { color: colors.text },
  selectorHint: { ...typography.caption, color: colors.textMuted },
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
