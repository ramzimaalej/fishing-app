import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ensureBlePermissions, waitForPoweredOn } from '@/features/ble/bleManager';
import type { BroadcastAdvertisement } from '@/features/ble/BroadcastSensorClient';
import { DEFAULT_SENSOR_KIND, getSensorDevice } from '@/features/ble/deviceRegistry';
import { subscribeToScan } from '@/features/ble/scanBroker';
import { colors, radius, spacing, typography } from '@/theme';

import { useDeviceStore } from '@/features/devices/deviceStore';

import { useRodStore } from './rodStore';

interface Candidate {
  id: string;
  /** Platform handle to connect with — not the same as `id`. See PairedDevice. */
  connectionId: string;
  label: string;
  rssi: number;
  battery?: number;
  /** True when this device is already bound to a different rod. */
  takenBy?: string;
}

/**
 * Bind one rod to one physical sensor.
 *
 * This screen exists because multi-rod makes binding mandatory: an unbound
 * broadcast client locks onto the first tag it hears, so two unbound rods would
 * both latch the same tag and report one sensor as two rods. Pairing is what
 * makes "which rod went off" meaningful.
 *
 * Runs on the shared scan broker, so opening it never disturbs rods that are
 * already armed and fishing.
 */
export default function PairSensorScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<{ goBack: () => void }>();
  const route = useRoute<{ key: string; name: string; params?: { rodId?: string } }>();
  const rodId = route.params?.rodId ?? null;

  const rods = useRodStore((s) => s.rods);
  const setDeviceId = useRodStore((s) => s.setDeviceId);
  const pairDevice = useDeviceStore((s) => s.pair);
  const rod = rods.find((r) => r.id === rodId) ?? null;

  const [found, setFound] = useState<Record<string, Candidate>>({});
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // Which device ids other rods already own, so we can warn instead of letting
  // two rods silently share one sensor.
  const taken = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rods) {
      if (r.deviceId && r.id !== rodId) map.set(r.deviceId, r.name);
    }
    return map;
  }, [rods, rodId]);

  const kind = rod?.sensorKind ?? DEFAULT_SENSOR_KIND;
  const dev = getSensorDevice(kind);

  useEffect(() => {
    if (!rod || !dev.requiresBle) return;
    let release: (() => void) | null = null;
    let active = true;

    void (async () => {
      const granted = await ensureBlePermissions();
      if (!granted) {
        setError(t('pairing.permissionDenied'));
        return;
      }
      try {
        await waitForPoweredOn();
      } catch (e) {
        setError(e instanceof Error ? e.message : t('pairing.bluetoothUnavailable'));
        return;
      }
      if (!active) return;
      setScanning(true);

      release = subscribeToScan((device) => {
        // Broadcast tags are recognised and identified by their own frame spec —
        // the same one the streaming client uses, so pairing can never disagree
        // with what will actually connect. GATT peripherals fall through to
        // being listed by platform id and advertised name.
        const spec = dev.broadcast;
        if (spec) {
          const reading = spec.extract(device as BroadcastAdvertisement);
          if (!reading) return;
          setFound((prev) => ({
            ...prev,
            [reading.deviceKey]: {
              id: reading.deviceKey,
              connectionId: reading.connectionId,
              label: spec.displayName(reading.deviceKey),
              rssi: device.rssi ?? -127,
              battery: reading.batteryPct,
            },
          }));
          return;
        }

        const name = device.name ?? device.localName;
        if (!name) return;
        setFound((prev) => ({
          ...prev,
          [device.id]: {
            id: device.id,
            connectionId: device.id,
            label: name,
            rssi: device.rssi ?? -127,
          },
        }));
      });
    })();

    return () => {
      active = false;
      setScanning(false);
      release?.();
    };
  }, [rod, dev.requiresBle, dev.broadcast, t]);

  const candidates = useMemo(
    () =>
      Object.values(found)
        .map((c) => ({ ...c, takenBy: taken.get(c.id) }))
        .sort((a, b) => b.rssi - a.rssi),
    [found, taken],
  );

  if (!rod) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{t('pairing.rodNotFound')}</Text>
      </View>
    );
  }

  const choose = (id: string) => {
    // Register in the device registry as well as on the rod. Writing only
    // rod.deviceId left armRod's deviceFor() lookup returning null, so the rod
    // read as 'unpaired' and refused to arm with "its tag is not responding" —
    // about a tag that was two feet away and advertising.
    const found = candidates.find((c) => c.id === id);
    pairDevice({
      id,
      connectionId: found?.connectionId ?? id,
      name: found?.label ?? id,
      rssi: found?.rssi ?? -127,
      lastSeenAt: Date.now(),
      battery: found?.battery ?? null,
    });
    setDeviceId(rod.id, id);
    navigation.goBack();
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('pairing.title', { name: rod.name })}</Text>
      <Text style={styles.subtitle}>
        {dev.discoverable
          ? t('pairing.subtitleBroadcast')
          : t('pairing.subtitleGatt', { device: dev.label })}
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}

      {rod.deviceId && (
        <View style={styles.currentCard}>
          <Text style={styles.currentLabel}>{t('pairing.currentlyPaired')}</Text>
          <Text style={styles.currentValue}>{rod.deviceId}</Text>
          <Pressable onPress={() => setDeviceId(rod.id, null)}>
            <Text style={styles.unpair}>{t('pairing.unpair')}</Text>
          </Pressable>
        </View>
      )}

      {scanning && candidates.length === 0 && !error && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>{t('pairing.scanning')}</Text>
        </View>
      )}

      {candidates.map((c) => (
        <Pressable
          key={c.id}
          style={[styles.row, c.takenBy && styles.rowTaken]}
          onPress={() => choose(c.id)}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>{c.label}</Text>
            <Text style={styles.rowMeta}>
              {c.id}
              {c.battery != null ? ` · 🔋${c.battery}%` : ''} · {c.rssi} dBm
            </Text>
            {c.takenBy && (
              <Text style={styles.rowWarn}>{t('pairing.takenBy', { name: c.takenBy })}</Text>
            )}
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textMuted },
  error: { ...typography.body, color: colors.danger },
  center: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  muted: { ...typography.body, color: colors.textMuted },
  currentCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: spacing.md,
    gap: 2,
  },
  currentLabel: { ...typography.caption, color: colors.textMuted, textTransform: 'uppercase' },
  currentValue: { ...typography.body, color: colors.text },
  unpair: { ...typography.caption, color: colors.danger, marginTop: spacing.xs, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  rowTaken: { borderColor: colors.accent },
  rowLabel: { ...typography.h3, color: colors.text },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  rowWarn: { ...typography.caption, color: colors.accent, marginTop: 2 },
  chevron: { ...typography.h2, color: colors.textMuted },
});
