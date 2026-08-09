/**
 * Manage paired tags: pair, name, associate to a rod, power down, unpair.
 *
 * One screen rather than a flow buried under each rod, because tags outlive
 * rods: they get swapped between them, go flat, and get switched off, and the
 * user needs one place that answers "which of my tags is alive right now".
 */
import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { isBatteryReadingStale } from '@/features/ble/battery';
import { batteryColor, batteryGlyph } from '@/features/ble/batteryDisplay';
import { ensureBlePermissions, waitForPoweredOn } from '@/features/ble/bleManager';
import { useRodStore } from '@/features/rods/rodStore';
import { colors, radius, rodColours, spacing, typography } from '@/theme';

import { powerOff, readBattery, verifyDevice } from './cp27Commands';
import { currentOpcodes } from './cp27Opcodes';
import {
  canBindDevice,
  DEVICE_LIVE_WINDOW_MS,
  deviceLabel,
  deviceStatus,
  type DeviceStatus,
  type PairedDevice,
} from './device';
import { isPlausibleCode, printedCode } from './deviceCode';
import {
  type DiscoveredDevice,
  pendingCandidates,
  startDeviceWatch,
  useDeviceStore,
} from './deviceStore';

const STATUS_TEXT: Record<DeviceStatus, string> = {
  live: 'Live',
  stale: 'Not responding',
  'never-seen': 'Never seen',
  'powered-off': 'Powered off',
};

const STATUS_COLOUR: Record<DeviceStatus, string> = {
  live: colors.success,
  stale: colors.danger,
  'never-seen': colors.textMuted,
  'powered-off': colors.accent,
};

function relativeTime(at: number | null, now: number): string {
  if (at === null) return 'never';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ---------------------------------------------------------------------------

function PairedCard({ device, now }: { device: PairedDevice; now: number }) {
  const rods = useRodStore((s) => s.rods);
  const setDeviceId = useRodStore((s) => s.setDeviceId);
  const rename = useDeviceStore((s) => s.rename);
  const unpair = useDeviceStore((s) => s.unpair);
  const markPoweredOff = useDeviceStore((s) => s.markPoweredOff);
  const setBattery = useDeviceStore((s) => s.setBattery);

  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(device.label ?? '');

  const status = deviceStatus(device, now);
  const boundRod = rods.find((r) => r.deviceId === device.id) ?? null;

  const onVerify = async () => {
    if (!device.connectionId) {
      Alert.alert(
        'Not heard yet',
        'This tag was paired by code and has never been heard, so there is no address to ' +
          'connect to. Bring it in range and try again.',
      );
      return;
    }
    setBusy('Connecting…');
    const result = await verifyDevice(device.connectionId, {
      password: currentOpcodes().password ?? undefined,
    });
    // Recorded whenever the connection succeeded, including the null that means
    // "answered, but does not report one" — that is a settled fact, not a
    // failure, and remembering it stops the UI offering a pointless refresh.
    if (result.ok) setBattery(device.id, result.battery);
    setBusy(null);
    Alert.alert(result.ok ? 'Tag reachable' : 'Could not reach the tag', result.detail);
  };

  const onReadBattery = async () => {
    if (!device.connectionId) return;
    setBusy('Reading battery…');
    const result = await readBattery(device.connectionId, {
      password: currentOpcodes().password ?? undefined,
    });
    if (result.ok) setBattery(device.id, result.percent);
    setBusy(null);
    if (!result.ok) Alert.alert('Could not read the battery', result.detail);
  };

  const onPowerOff = () => {
    const opcodes = currentOpcodes();
    Alert.alert(
      `Power off ${deviceLabel(device)}?`,
      opcodes.powerOff
        ? 'The tag will stop advertising, and any rod using it stops being watched. ' +
          'You will need to switch it back on by hand.'
        : 'No power-off command has been captured for this tag yet. ' +
          'Admin → Device commands explains how to get it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: opcodes.powerOff ? 'Power off' : 'How to fix',
          style: opcodes.powerOff ? 'destructive' : 'default',
          onPress: () => {
            void (async () => {
              setBusy('Powering off…');
              const result = await powerOff(device.connectionId ?? '', opcodes.powerOff, {
                password: opcodes.password ?? undefined,
              });
              setBusy(null);
              // Only claim it is off when the command actually went out.
              if (result.ok) markPoweredOff(device.id);
              Alert.alert(result.ok ? 'Command sent' : 'Not sent', result.detail);
            })();
          },
        },
      ],
    );
  };

  const onBind = (rodId: string) => {
    const verdict = canBindDevice(device.id, rodId, rods);
    if (!verdict.allowed) {
      Alert.alert(
        'Already in use',
        verdict.reason === 'bound-elsewhere'
          ? `${deviceLabel(device)} is already on ${verdict.boundTo}. A tag can only ` +
            'serve one rod — two rods sharing one would alarm together.'
          : 'That rod already uses this tag.',
      );
      return;
    }
    setDeviceId(rodId, device.id);
  };

  const onUnpair = () =>
    Alert.alert(`Unpair ${deviceLabel(device)}?`, 'Any rod using it will have no sensor.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unpair',
        style: 'destructive',
        onPress: () => {
          if (boundRod) setDeviceId(boundRod.id, null);
          unpair(device.id);
        },
      },
    ]);

  return (
    <View style={[styles.card, status === 'live' && styles.cardLive]}>
      <View style={styles.cardHeader}>
        <View style={[styles.dot, { backgroundColor: STATUS_COLOUR[status] }]} />
        <View style={{ flex: 1 }}>
          {editing ? (
            <TextInput
              style={styles.nameInput}
              value={draft}
              onChangeText={setDraft}
              placeholder={device.name}
              placeholderTextColor={colors.textMuted}
              autoFocus
              onBlur={() => {
                rename(device.id, draft.trim() || null);
                setEditing(false);
              }}
              onSubmitEditing={() => {
                rename(device.id, draft.trim() || null);
                setEditing(false);
              }}
            />
          ) : (
            <Pressable onPress={() => setEditing(true)}>
              <Text style={styles.cardTitle}>{deviceLabel(device)}</Text>
            </Pressable>
          )}
          <Text style={styles.cardMeta}>
            <Text style={styles.code}>{printedCode(device.id)}</Text> · {device.id}
          </Text>
        </View>
        {device.battery != null && (
          <Text
            style={[
              styles.battery,
              {
                color: isBatteryReadingStale(device.batteryReadAt, now)
                  ? colors.textMuted
                  : batteryColor(device.battery),
              },
            ]}
          >
            {batteryGlyph(device.battery)} {device.battery}%
          </Text>
        )}
      </View>

      <Text style={[styles.status, { color: STATUS_COLOUR[status] }]}>
        {STATUS_TEXT[status]}
        {status !== 'live' && ` · last heard ${relativeTime(device.lastSeenAt, now)}`}
        {device.rssi !== null && status === 'live' && ` · ${device.rssi} dBm`}
      </Text>

      {/* Battery -------------------------------------------------------- */}
      <View style={styles.batteryRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>Battery</Text>
          <Text style={styles.hint}>
            {!device.connectionId
              ? 'Needs the tag in range once before it can be read.'
              : device.batteryUnsupported
              ? 'Not reported by this tag.'
              : device.battery == null
                ? 'Not read yet — it comes from a connection, not the broadcast.'
                : `${device.battery}% · read ${relativeTime(device.batteryReadAt, now)}` +
                  (isBatteryReadingStale(device.batteryReadAt, now) ? ' · may be out of date' : '')}
          </Text>
        </View>
        {!device.batteryUnsupported && device.connectionId && (
          <Pressable style={styles.smallBtn} onPress={() => void onReadBattery()} disabled={!!busy}>
            <Text style={styles.smallBtnText}>
              {device.battery == null ? 'Read' : 'Refresh'}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Association ---------------------------------------------------- */}
      <Text style={styles.fieldLabel}>Rod</Text>
      <View style={styles.chipRow}>
        {rods.map((rod) => {
          const active = rod.deviceId === device.id;
          return (
            <Pressable
              key={rod.id}
              style={[
                styles.chip,
                active && { backgroundColor: rodColours[rod.colour] },
              ]}
              onPress={() => (active ? setDeviceId(rod.id, null) : onBind(rod.id))}
            >
              <View style={[styles.chipDot, { backgroundColor: rodColours[rod.colour] }]} />
              <Text style={[styles.chipText, active && styles.chipTextOn]}>{rod.name}</Text>
            </Pressable>
          );
        })}
        {rods.length === 0 && <Text style={styles.hint}>No rods yet — add one first.</Text>}
      </View>

      {busy && <Text style={styles.hint}>{busy}</Text>}

      <View style={styles.actions}>
        <Pressable style={styles.smallBtn} onPress={() => void onVerify()} disabled={!!busy}>
          <Text style={styles.smallBtnText}>Test</Text>
        </Pressable>
        <Pressable style={styles.smallBtn} onPress={onPowerOff} disabled={!!busy}>
          <Text style={styles.smallBtnText}>Power off</Text>
        </Pressable>
        <Pressable style={[styles.smallBtn, styles.dangerBtn]} onPress={onUnpair}>
          <Text style={[styles.smallBtnText, { color: colors.danger }]}>Unpair</Text>
        </Pressable>
      </View>
    </View>
  );
}

function DiscoveredCard({ device, now }: { device: DiscoveredDevice; now: number }) {
  const pair = useDeviceStore((s) => s.pair);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{device.name}</Text>
          <Text style={styles.cardMeta}>
            <Text style={styles.code}>{printedCode(device.id)}</Text> · {device.rssi} dBm ·
            seen {relativeTime(device.lastSeenAt, now)}
          </Text>
        </View>
        <Pressable style={styles.pairBtn} onPress={() => pair(device)}>
          <Text style={styles.pairBtnText}>Pair</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

export default function DevicesScreen() {
  const navigation = useNavigation<{ navigate: (r: string) => void }>();
  const paired = useDeviceStore((s) => s.paired);
  const discovered = useDeviceStore((s) => s.discovered);
  const scanning = useDeviceStore((s) => s.scanning);
  const requestPair = useDeviceStore((s) => s.requestPair);
  const cancelPending = useDeviceStore((s) => s.cancelPending);
  const pending = useDeviceStore((s) => s.pending);
  const pair = useDeviceStore((s) => s.pair);

  const [manualId, setManualId] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Re-render on a timer so "live" decays to "not responding" without an
  // advertisement having to arrive to trigger it — the whole point is noticing
  // that nothing arrived.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(timer);
  }, []);

  const startScan = useCallback(async () => {
    setError(null);
    const granted = await ensureBlePermissions();
    if (!granted) {
      setError('Bluetooth permission denied.');
      return;
    }
    try {
      await waitForPoweredOn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bluetooth unavailable.');
      return;
    }
    startDeviceWatch();
  }, []);

  useEffect(() => {
    void startScan();
    // Left running deliberately on unmount: liveness must keep updating while a
    // session is armed, or rods could not notice their tag going quiet.
  }, [startScan]);

  const pairedList = useMemo(
    () => Object.values(paired).sort((a, b) => a.pairedAt - b.pairedAt),
    [paired],
  );
  const discoveredList = useMemo(
    () =>
      Object.values(discovered)
        .filter((d) => !paired[d.id])
        .sort((a, b) => b.rssi - a.rssi),
    [discovered, paired],
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>My tags</Text>
      {pairedList.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.hint}>
            No tags paired yet. Bring one close to the phone and pair it below, or type its
            MAC if you know it.
          </Text>
        </View>
      ) : (
        pairedList.map((d) => <PairedCard key={d.id} device={d} now={now} />)
      )}

      <Text style={styles.sectionTitle}>
        {scanning ? 'Nearby' : 'Nearby — not scanning'}
      </Text>
      {error && <Text style={styles.error}>{error}</Text>}
      {discoveredList.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.hint}>
            {scanning
              ? 'Nothing new in range. A paired tag will not appear here.'
              : 'Scanning stopped.'}
          </Text>
        </View>
      ) : (
        discoveredList.map((d) => <DiscoveredCard key={d.id} device={d} now={now} />)
      )}

      <Text style={styles.sectionTitle}>Pair by printed code</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>
          Type the code on the tag — the four characters after “CP27-”. It binds as soon as
          that tag is heard, so you can enter it now and walk to the rod.
        </Text>
        <TextInput
          style={styles.input}
          value={manualId}
          onChangeText={setManualId}
          placeholder="C00C"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={20}
        />
        <Pressable
          style={[styles.primaryBtn, !isPlausibleCode(manualId) && styles.btnDisabled]}
          disabled={!isPlausibleCode(manualId)}
          onPress={() => {
            if (!requestPair(manualId, null)) return;
            setManualId('');
          }}
        >
          <Text style={styles.primaryBtnText}>Pair this code</Text>
        </Pressable>
        {manualId.length > 0 && !isPlausibleCode(manualId) && (
          <Text style={styles.hint}>
            A code is at least 3 characters, all 0–9 or A–F.
          </Text>
        )}
      </View>

      {pending.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Waiting for</Text>
          {pending.map((p) => {
            const candidates = pendingCandidates(p.code);
            return (
              <View key={p.code} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.code}>{p.code}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.hint}>
                      {candidates.length > 1
                        ? `${candidates.length} tags in range share this code — pick one below.`
                        : 'Not heard yet. Bring the tag within range and switch it on.'}
                    </Text>
                  </View>
                  <Pressable onPress={() => cancelPending(p.code)} hitSlop={8}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </Pressable>
                </View>
                {/* Ambiguity is shown, never resolved by guessing: the printed
                    code is only four digits of a MAC and two tags can collide. */}
                {candidates.length > 1 &&
                  candidates.map((c) => (
                    <Pressable
                      key={c.id}
                      style={styles.smallBtn}
                      onPress={() => {
                        const found = discovered[c.id];
                        if (found) pair(found);
                        cancelPending(p.code);
                      }}
                    >
                      <Text style={styles.smallBtnText}>{c.id}</Text>
                    </Pressable>
                  ))}
              </View>
            );
          })}
        </>
      )}

      <Text style={styles.footnote}>
        A tag counts as live if it has advertised in the last{' '}
        {Math.round(DEVICE_LIVE_WINDOW_MS / 1000)} seconds. A rod whose tag is not live cannot
        be armed — it would look watched while nothing was listening.
      </Text>

      <Pressable style={styles.linkBtn} onPress={() => navigation.navigate('Admin')}>
        <Text style={styles.linkText}>Device commands (admin)</Text>
      </Pressable>
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
  cardLive: { borderColor: colors.success },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cardTitle: { ...typography.h3, color: colors.text },
  cardMeta: { ...typography.caption, color: colors.textMuted },
  battery: { ...typography.caption, fontWeight: '700' },
  batteryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  status: { ...typography.caption, fontWeight: '600' },
  nameInput: {
    ...typography.h3,
    color: colors.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    paddingVertical: 2,
  },
  fieldLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipOn: { backgroundColor: colors.primary },
  chipText: { ...typography.caption, color: colors.text },
  chipTextOn: { color: colors.bg, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  smallBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
  },
  dangerBtn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.danger },
  smallBtnText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  pairBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  pairBtnText: { ...typography.caption, color: colors.bg, fontWeight: '800' },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    color: colors.text,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryBtnText: { ...typography.body, color: colors.bg, fontWeight: '800' },
  code: { ...typography.body, color: colors.primary, fontWeight: '800', letterSpacing: 1 },
  cancelText: { ...typography.caption, color: colors.danger, fontWeight: '700' },
  btnDisabled: { opacity: 0.4 },
  hint: { ...typography.caption, color: colors.textMuted },
  error: { ...typography.caption, color: colors.danger },
  footnote: { ...typography.caption, color: colors.border, marginTop: spacing.md },
  linkBtn: { alignSelf: 'center', paddingVertical: spacing.md },
  linkText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
});
