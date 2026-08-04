/**
 * BLE advertisement sniffer UI — for working out an unknown sensor's frame.
 *
 * Not internationalised, like the rest of admin (see AdminScreen).
 *
 * The intended workflow, which the layout is built around:
 *   1. Start scanning with the new tag close to the phone — it sorts to the top
 *      on RSSI.
 *   2. Filter to "moving payloads" — static beacons vanish, leaving candidates.
 *   3. Shake the tag. Bytes that change are highlighted; three adjacent pairs
 *      appearing at once are the X/Y/Z axes.
 *   4. Hold an axis pointing down and read the decoded columns: whichever scale
 *      shows ≈ ±1 g is the right one.
 *   5. Capture, so the frames become a test vector rather than a memory.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ensureBlePermissions, waitForPoweredOn } from '@/features/ble/bleManager';
import { colors, radius, spacing, typography } from '@/theme';

import {
  type SniffedDeviceView,
  type SniffedSourceView,
  startCapture,
  startSniffing,
  stopCapture,
  stopSniffing,
  useSnifferStore,
} from './bleSniffer';
import { decodeCandidate } from './snifferAnalysis';

/** Offsets are shown above each byte, so a layout can be read straight off. */
function ByteGrid({ hex, varying }: { hex: string[]; varying: number[] }) {
  const moving = new Set(varying);
  return (
    <View style={styles.byteGrid}>
      {hex.map((b, i) => (
        <View key={i} style={[styles.byteCell, moving.has(i) && styles.byteCellMoving]}>
          <Text style={styles.byteOffset}>{i}</Text>
          <Text style={[styles.byteHex, moving.has(i) && styles.byteHexMoving]}>{b}</Text>
        </View>
      ))}
    </View>
  );
}

function SourceBlock({ source }: { source: SniffedSourceView }) {
  const frame = new Uint8Array(source.hex.map((h) => parseInt(h, 16)));

  return (
    <View style={styles.source}>
      <View style={styles.sourceHeader}>
        <Text style={styles.sourceKey}>{source.key}</Text>
        <Text style={styles.sourceMeta}>
          {source.hex.length} B · {source.frames} frames
          {source.isSensor ? ' · moving' : ''}
        </Text>
      </View>

      <ByteGrid hex={source.hex} varying={source.varying} />

      {source.candidates.length > 0 && (
        <View style={styles.candidates}>
          <Text style={styles.candidateTitle}>
            int16 candidates — point an axis down; the right scale reads ≈ ±1
          </Text>
          {source.candidates.map((c) => {
            const guesses = decodeCandidate(frame, c.offset, c.likelyEndian);
            return (
              <View key={`${c.offset}-${c.likelyEndian}`} style={styles.candidateRow}>
                <Text style={styles.candidateOffset}>
                  @{c.offset} {c.likelyEndian === 'big' ? 'BE' : 'LE'}
                </Text>
                <View style={styles.guessRow}>
                  {guesses
                    .filter((g) => g.label !== 'raw')
                    .map((g) => (
                      <Text key={g.label} style={styles.guess}>
                        {g.label} <Text style={styles.guessValue}>{g.value.toFixed(3)}</Text>
                      </Text>
                    ))}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function DeviceCard({ device }: { device: SniffedDeviceView }) {
  const [open, setOpen] = useState(false);

  return (
    <View style={[styles.card, device.isSensor && styles.cardSensor]}>
      <Pressable onPress={() => setOpen((v) => !v)}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {device.isSensor ? '📈 ' : ''}
              {device.name}
            </Text>
            <Text style={styles.cardMeta} numberOfLines={1}>
              {device.id} · {device.rssi} dBm · {device.frames} adv
            </Text>
          </View>
          <Text style={styles.chevron}>{open ? '⌃' : '⌄'}</Text>
        </View>
      </Pressable>

      {open && device.sources.map((s) => <SourceBlock key={s.key} source={s} />)}
    </View>
  );
}

export default function SnifferScreen() {
  const scanning = useSnifferStore((s) => s.scanning);
  const devices = useSnifferStore((s) => s.devices);
  const capturing = useSnifferStore((s) => s.capturing);
  const capturedFrames = useSnifferStore((s) => s.capturedFrames);
  const error = useSnifferStore((s) => s.error);

  const [sensorsOnly, setSensorsOnly] = useState(true);
  const [label, setLabel] = useState('');
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // Stop the scan on unmount: an abandoned sniff would hold the shared scan open
  // and drain the battery for as long as the app lived.
  useEffect(() => () => stopSniffing(), []);

  const onToggleScan = useCallback(async () => {
    if (scanning) {
      stopSniffing();
      return;
    }
    setPermissionError(null);
    const granted = await ensureBlePermissions();
    if (!granted) {
      setPermissionError('Bluetooth permission denied.');
      return;
    }
    await waitForPoweredOn();
    startSniffing();
  }, [scanning]);

  const onToggleCapture = useCallback(async () => {
    if (!capturing) {
      startCapture();
      return;
    }
    const path = await stopCapture(label);
    setLabel('');
    Alert.alert(
      path ? 'Capture saved' : 'Nothing captured',
      path ?? 'No advertisements arrived while capturing.',
    );
  }, [capturing, label]);

  const shown = sensorsOnly ? devices.filter((d) => d.isSensor) : devices;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.hint}>
          Hold the new tag against the phone and start scanning — it will sort to the top on
          signal strength. Then shake it: the bytes that change are the live reading.
        </Text>
        <Pressable
          style={[styles.primaryBtn, scanning && styles.stopBtn]}
          onPress={() => void onToggleScan()}
        >
          <Text style={styles.primaryBtnText}>{scanning ? 'Stop scanning' : 'Start scanning'}</Text>
        </Pressable>
        {permissionError && <Text style={styles.error}>{permissionError}</Text>}
        {error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.switchRow}>
          <Text style={styles.rowLabel}>Moving payloads only</Text>
          <Switch
            value={sensorsOnly}
            onValueChange={setSensorsOnly}
            trackColor={{ true: colors.primary, false: colors.surfaceAlt }}
            thumbColor={colors.text}
          />
        </View>
        <Text style={styles.hint}>
          Hides identity beacons whose bytes never change. An accelerometer cannot sit still.
        </Text>
      </View>

      {/* Capture ----------------------------------------------------------- */}
      <View style={styles.card}>
        <Text style={styles.sourceKey}>Raw capture</Text>
        <Text style={styles.hint}>
          Writes every advertisement to a file so a frame becomes a test vector. Note the tag&apos;s
          orientation in the label — a resting frame is what proves the scale factor.
        </Text>
        {!capturing && (
          <TextInput
            style={styles.input}
            value={label}
            onChangeText={setLabel}
            placeholder="Label (e.g. flat-on-table-z-up)"
            placeholderTextColor={colors.textMuted}
          />
        )}
        {capturing && <Text style={styles.capturing}>● {capturedFrames} frames captured</Text>}
        <Pressable
          style={[styles.primaryBtn, capturing && styles.stopBtn, !scanning && styles.btnDisabled]}
          onPress={() => void onToggleCapture()}
          disabled={!scanning}
        >
          <Text style={styles.primaryBtnText}>
            {capturing ? 'Stop and save' : 'Start capture'}
          </Text>
        </Pressable>
        {!scanning && <Text style={styles.hint}>Start scanning first.</Text>}
      </View>

      <Text style={styles.sectionTitle}>
        {shown.length} advertiser{shown.length === 1 ? '' : 's'}
      </Text>

      {shown.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.hint}>
            {scanning
              ? sensorsOnly
                ? 'Nothing with moving bytes yet. Shake the tag, or switch the filter off to see everything.'
                : 'No advertisements yet.'
              : 'Not scanning.'}
          </Text>
        </View>
      )}

      {shown.map((d) => (
        <DeviceCard key={d.id} device={d} />
      ))}
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
  cardSensor: { borderColor: colors.primary },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { ...typography.body, color: colors.text, fontWeight: '700' },
  cardMeta: { ...typography.caption, color: colors.textMuted },
  chevron: { ...typography.h3, color: colors.textMuted },

  source: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  sourceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sourceKey: { ...typography.caption, color: colors.text, fontWeight: '800' },
  sourceMeta: { ...typography.caption, color: colors.textMuted },

  byteGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  byteCell: {
    minWidth: 26,
    alignItems: 'center',
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.surfaceAlt,
  },
  byteCellMoving: { backgroundColor: colors.primaryDark },
  byteOffset: { fontSize: 8, color: colors.textMuted },
  byteHex: { fontSize: 12, color: colors.text, fontVariant: ['tabular-nums'] },
  byteHexMoving: { color: colors.text, fontWeight: '800' },

  candidates: { gap: spacing.xs, marginTop: spacing.xs },
  candidateTitle: { ...typography.caption, color: colors.accent },
  candidateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  candidateOffset: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '800',
    minWidth: 56,
  },
  guessRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, flex: 1 },
  guess: { ...typography.caption, color: colors.textMuted },
  guessValue: { color: colors.text, fontWeight: '700' },

  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
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
  stopBtn: { backgroundColor: colors.danger },
  btnDisabled: { opacity: 0.4 },
  primaryBtnText: { ...typography.body, color: colors.bg, fontWeight: '800' },
  capturing: { ...typography.body, color: colors.danger, fontWeight: '700' },
  hint: { ...typography.caption, color: colors.textMuted },
  error: { ...typography.caption, color: colors.danger },
});
