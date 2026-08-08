/**
 * Admin console: capture labelled accelerometer data for tuning the detector.
 *
 * NOT INTERNATIONALISED, on purpose. Every other screen goes through i18n
 * because it faces users; this one is a developer instrument behind a code, and
 * pushing thirty diagnostic strings into fr.ts and es.ts would bury the
 * translations that do matter under copy no user will ever read.
 */
import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  BACKGROUND_WATCH_SUPPORTED,
  isBatteryExempt,
  openBatteryOptimisationSettings,
  PLATFORM_LIMIT_BODY,
  PLATFORM_LIMIT_TITLE,
} from '@/features/detection/platformLimits';
import { useCp27OpcodeStore } from '@/features/devices/cp27Opcodes';
import { useAnyArmed, useArmableRods } from '@/features/rods/useRodRuntime';
import { colors, radius, spacing, typography } from '@/theme';

import { useAdminStore } from './adminStore';
import type { RecordingSummary } from './captureTypes';
import {
  DEFAULT_MATCH_OPTIONS,
  formatRate,
  type MatchOptions,
  matchEvents,
} from './matching';
import { captureDirectory, startRecording, stopRecording, useCaptureStore } from './recorder';
import {
  deleteRecording,
  exportRecording,
  formatBytes,
  formatDuration,
  listRecordings,
} from './recordingsRepo';

/**
 * Match-tolerance presets.
 *
 * Exposed because the right window depends on how the angler was fishing: a rod
 * in a holder that they are watching closely earns a tight window, while a rod
 * they glance at between other tasks needs a loose one. Scoring at a fixed
 * tolerance would silently flatter or punish the detector depending on
 * conditions that have nothing to do with the algorithm.
 */
const PRESETS: { key: string; label: string; opts: Partial<MatchOptions> }[] = [
  { key: 'tight', label: 'Tight', opts: { preMs: 1500, postMs: 750 } },
  { key: 'normal', label: 'Normal', opts: DEFAULT_MATCH_OPTIONS },
  { key: 'loose', label: 'Loose', opts: { preMs: 6000, postMs: 3000 } },
];

const clockTime = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

// ---------------------------------------------------------------------------

function LockGate() {
  const unlock = useAdminStore((s) => s.unlock);
  const [code, setCode] = useState('');
  const [wrong, setWrong] = useState(false);

  const submit = () => {
    if (unlock(code)) return;
    setWrong(true);
    setCode('');
  };

  return (
    <View style={styles.gate}>
      <Text style={styles.gateEmoji}>🔒</Text>
      <Text style={styles.gateTitle}>Admin mode</Text>
      <Text style={styles.gateSub}>Enter the access code.</Text>
      <TextInput
        style={[styles.codeInput, wrong && styles.codeInputWrong]}
        value={code}
        onChangeText={(v) => {
          setCode(v);
          setWrong(false);
        }}
        placeholder="••••"
        placeholderTextColor={colors.textMuted}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={12}
        onSubmitEditing={submit}
        autoFocus
      />
      {wrong && <Text style={styles.error}>Incorrect code.</Text>}
      <Pressable style={styles.primaryBtn} onPress={submit}>
        <Text style={styles.primaryBtnText}>Unlock</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------

function ScoreRow({
  summary,
  options,
}: {
  summary: RecordingSummary;
  options: Partial<MatchOptions>;
}) {
  // Re-scored in the UI rather than stored, so changing the tolerance is
  // instant and never rewrites what was recorded.
  const result = useMemo(() => matchEvents(summary.events, options), [summary.events, options]);

  return (
    <View style={styles.scoreGrid}>
      <Score label="Hit" value={String(result.truePositives.length)} tone={colors.success} />
      <Score label="False" value={String(result.falsePositives.length)} tone={colors.danger} />
      <Score label="Missed" value={String(result.falseNegatives.length)} tone={colors.accent} />
      <Score label="Prec." value={formatRate(result.precision)} tone={colors.text} />
      <Score label="Recall" value={formatRate(result.recall)} tone={colors.text} />
      <Score
        label="Lead"
        value={
          result.meanDeltaMs === null ? '—' : `${(result.meanDeltaMs / 1000).toFixed(1)}s`
        }
        tone={colors.textMuted}
      />
    </View>
  );
}

function Score({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View style={styles.scoreCell}>
      <Text style={[styles.scoreValue, { color: tone }]}>{value}</Text>
      <Text style={styles.scoreLabel}>{label}</Text>
    </View>
  );
}

function RecordingCard({
  summary,
  options,
  onChanged,
}: {
  summary: RecordingSummary;
  options: Partial<MatchOptions>;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const duration =
    summary.endedAt === null ? null : formatDuration(summary.endedAt - summary.startedAt);

  const onExport = async () => {
    setBusy(true);
    const result = await exportRecording(summary.id);
    setBusy(false);
    Alert.alert(
      result.ok ? 'Exported' : 'Export failed',
      result.ok ? `Saved to ${result.destination}.` : (result.error ?? 'Unknown error.'),
    );
  };

  const onDelete = () => {
    Alert.alert('Delete recording?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteRecording(summary.id)
            .then(onChanged)
            .catch((e: unknown) =>
              Alert.alert('Delete failed', e instanceof Error ? e.message : 'Unknown error.'),
            );
        },
      },
    ]);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{summary.label || clockTime(summary.startedAt)}</Text>
      <Text style={styles.cardMeta}>
        {clockTime(summary.startedAt)}
        {duration ? ` · ${duration}` : ' · unfinished'}
        {` · ${summary.sampleCount.toLocaleString()} samples · ${formatBytes(summary.bytes)}`}
      </Text>

      <ScoreRow summary={summary} options={options} />

      <View style={styles.cardActions}>
        <Pressable style={styles.smallBtn} onPress={() => void onExport()} disabled={busy}>
          <Text style={styles.smallBtnText}>{busy ? 'Exporting…' : 'Export'}</Text>
        </Pressable>
        <Pressable style={[styles.smallBtn, styles.dangerBtn]} onPress={onDelete}>
          <Text style={[styles.smallBtnText, { color: colors.danger }]}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

export default function AdminScreen() {
  const unlocked = useAdminStore((s) => s.unlocked);
  const lock = useAdminStore((s) => s.lock);
  const navigation = useNavigation<{ navigate: (route: string) => void }>();

  const capture = useCaptureStore();
  const armable = useArmableRods();
  const anyArmed = useAnyArmed();

  const [label, setLabel] = useState('');
  const opcodes = useCp27OpcodeStore((s) => s.opcodes);
  const setPowerOff = useCp27OpcodeStore((s) => s.setPowerOff);
  const setPassword = useCp27OpcodeStore((s) => s.setPassword);
  const [powerOffDraft, setPowerOffDraft] = useState(opcodes.powerOff ?? '');
  const [passwordDraft, setPasswordDraft] = useState(opcodes.password ?? '');
  const [recordings, setRecordings] = useState<RecordingSummary[] | null>(null);
  const [preset, setPreset] = useState('normal');
  const [elapsed, setElapsed] = useState(0);

  const options = PRESETS.find((p) => p.key === preset)?.opts ?? DEFAULT_MATCH_OPTIONS;

  const refresh = useCallback(() => {
    void listRecordings().then(setRecordings);
  }, []);

  useEffect(() => {
    if (unlocked) refresh();
  }, [unlocked, refresh]);

  // Ticks the elapsed readout while capturing; stopped otherwise so an idle
  // admin screen is not re-rendering once a second in the background.
  useEffect(() => {
    if (!capture.recording || capture.startedAt === null) return;
    const started = capture.startedAt;
    setElapsed(Date.now() - started);
    const timer = setInterval(() => setElapsed(Date.now() - started), 1000);
    return () => clearInterval(timer);
  }, [capture.recording, capture.startedAt]);

  const onStart = async () => {
    const ok = await startRecording(armable, label.trim());
    if (!ok) Alert.alert('Could not start', 'The recording directory could not be created.');
  };

  const onStop = async () => {
    await stopRecording();
    setLabel('');
    refresh();
  };

  if (!unlocked) return <LockGate />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Capture ----------------------------------------------------------- */}
      <Text style={styles.sectionTitle}>Capture</Text>
      <View style={styles.card}>
        {capture.recording ? (
          <>
            <View style={styles.liveRow}>
              <View style={styles.recDot} />
              <Text style={styles.liveTitle}>Recording · {formatDuration(elapsed)}</Text>
            </View>
            <View style={styles.scoreGrid}>
              <Score
                label="Samples"
                value={capture.sampleCount.toLocaleString()}
                tone={colors.text}
              />
              <Score label="Detected" value={String(capture.detections)} tone={colors.primary} />
              <Score label="Marked" value={String(capture.humanMarks)} tone={colors.accent} />
            </View>

            {/* A running capture with nothing streaming looks identical to a
                working one until you open the file, so say so here. */}
            {!anyArmed && (
              <Text style={styles.warn}>
                No rods are armed — no samples are being captured. Start a session on the
                Fishing tab.
              </Text>
            )}
            {capture.error && <Text style={styles.error}>{capture.error}</Text>}

            <Text style={styles.hint}>
              Use the “I saw a bite” button on the Fishing tab to mark bites as you see them.
            </Text>

            <Pressable style={[styles.primaryBtn, styles.stopBtn]} onPress={() => void onStop()}>
              <Text style={styles.primaryBtnText}>Stop recording</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.hint}>
              Captures every accelerometer sample from every armed rod, plus each detection and
              each bite you mark by hand.
            </Text>
            <TextInput
              style={styles.input}
              value={label}
              onChangeText={setLabel}
              placeholder="Label (e.g. evening surf, live bait)"
              placeholderTextColor={colors.textMuted}
            />
            <Pressable style={styles.primaryBtn} onPress={() => void onStart()}>
              <Text style={styles.primaryBtnText}>Start recording</Text>
            </Pressable>
            {!anyArmed && (
              <Text style={styles.hint}>
                Tip: arm a session first, or the recording will start out empty.
              </Text>
            )}
          </>
        )}
      </View>

      {/* Hardware ---------------------------------------------------------- */}
      <Text style={styles.sectionTitle}>Hardware</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>
          Inspect raw BLE advertisements to work out an unknown sensor&apos;s frame layout.
        </Text>
        <Pressable style={styles.primaryBtn} onPress={() => navigation.navigate('Sniffer')}>
          <Text style={styles.primaryBtnText}>Open BLE sniffer</Text>
        </Pressable>
      </View>

      {/* Device commands --------------------------------------------------- */}
      <Text style={styles.sectionTitle}>Device commands</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>
          Commands are ASCII, prefixed “NO”, written to 0xFFE2 after unlocking 0xFFE3 with the
          password. That framing is confirmed from HCI captures. No individual opcode is —
          INCLUDING power-off — so nothing here guesses one: the same channel sets advertising
          interval, transmit power and the password itself, a bad write looks exactly like a
          flat battery, and there is no factory reset outside the vendor app.
        </Text>
        <Text style={styles.hint}>
          To capture it: Developer options → enable Bluetooth HCI snoop log, cycle Bluetooth,
          power the tag off from the VENDOR app, then pull btsnoop_hci.log and filter
          btatt.opcode == 0x12 for the write to 0xFFE2. Its ASCII value minus “NO” goes below.
        </Text>
        <TextInput
          style={styles.input}
          value={powerOffDraft}
          onChangeText={setPowerOffDraft}
          onBlur={() => setPowerOff(powerOffDraft)}
          placeholder="Power-off opcode (without NO)"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          value={passwordDraft}
          onChangeText={setPasswordDraft}
          onBlur={() => setPassword(passwordDraft)}
          placeholder="Password (default dx1234)"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.hint}>
          {opcodes.powerOff
            ? `Power-off will send "NO${opcodes.powerOff}".`
            : 'Power-off is disabled until an opcode is set.'}
        </Text>
      </View>

      {/* Tuning ----------------------------------------------------------- */}
      <Text style={styles.sectionTitle}>Tuning</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>
          The shipped thresholds are a guess. Label fish and waves during a session, then set
          the onset rate from the separation between them rather than by feel.
        </Text>
        <Pressable style={styles.primaryBtn} onPress={() => navigation.navigate('Calibration')}>
          <Text style={styles.primaryBtnText}>Calibration</Text>
        </Pressable>
        <Pressable style={styles.primaryBtn} onPress={() => navigation.navigate('DetectionSettings')}>
          <Text style={styles.primaryBtnText}>Detection parameters</Text>
        </Pressable>
      </View>

      {/* Platform limits --------------------------------------------------- */}
      <Text style={styles.sectionTitle}>Platform limits</Text>
      <View style={styles.card}>
        <Text style={styles.warn}>{PLATFORM_LIMIT_TITLE}</Text>
        <Text style={styles.hint}>{PLATFORM_LIMIT_BODY}</Text>
        {BACKGROUND_WATCH_SUPPORTED && (
          <Text style={isBatteryExempt() ? styles.hint : styles.warn}>
            {isBatteryExempt()
              ? '✓ Exempt from battery optimisation.'
              : '⚠ Not exempt from battery optimisation — long sessions may be killed.'}
          </Text>
        )}
        <Pressable
          style={styles.smallBtn}
          onPress={() =>
            void (BACKGROUND_WATCH_SUPPORTED
              ? openBatteryOptimisationSettings()
              : Linking.openSettings())
          }
        >
          <Text style={styles.smallBtnText}>
            {BACKGROUND_WATCH_SUPPORTED ? 'Battery optimisation settings' : 'Open app settings'}
          </Text>
        </Pressable>
      </View>

      {/* Scoring ----------------------------------------------------------- */}
      <Text style={styles.sectionTitle}>Match tolerance</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>
          How far apart a detection and your mark may be and still count as the same bite. Your
          reaction lag means a correct detection normally lands a second or two BEFORE your
          press, so the window is wider on that side.
        </Text>
        <View style={styles.presetRow}>
          {PRESETS.map((p) => (
            <Pressable
              key={p.key}
              style={[styles.preset, preset === p.key && styles.presetOn]}
              onPress={() => setPreset(p.key)}
            >
              <Text style={[styles.presetText, preset === p.key && styles.presetTextOn]}>
                {p.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>
          −{(options.preMs ?? 0) / 1000}s before your mark, +{(options.postMs ?? 0) / 1000}s
          after.
        </Text>
      </View>

      {/* Recordings -------------------------------------------------------- */}
      <Text style={styles.sectionTitle}>Recordings</Text>
      {recordings === null ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
      ) : recordings.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.hint}>Nothing recorded yet.</Text>
        </View>
      ) : (
        recordings.map((r) => (
          <RecordingCard key={r.id} summary={r} options={options} onChanged={refresh} />
        ))
      )}

      {/* Footer ------------------------------------------------------------ */}
      <Text style={styles.sectionTitle}>Storage</Text>
      <View style={styles.card}>
        <Text style={styles.hint} selectable>
          {captureDirectory()}
        </Text>
        <Text style={styles.hint}>
          Export writes samples, events and metadata as separate files to a folder you pick.
        </Text>
      </View>

      <Pressable style={styles.lockBtn} onPress={lock}>
        <Text style={styles.lockBtnText}>Lock admin mode</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },

  gate: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  gateEmoji: { fontSize: 44 },
  gateTitle: { ...typography.h1, color: colors.text },
  gateSub: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.md },
  codeInput: {
    ...typography.h2,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    textAlign: 'center',
    letterSpacing: 8,
    minWidth: 180,
  },
  codeInputWrong: { borderColor: colors.danger },

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
  cardTitle: { ...typography.h3, color: colors.text },
  cardMeta: { ...typography.caption, color: colors.textMuted },
  cardActions: { flexDirection: 'row', gap: spacing.sm },

  liveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
  liveTitle: { ...typography.h3, color: colors.text },

  scoreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  scoreCell: { minWidth: 62, alignItems: 'center' },
  scoreValue: { ...typography.h3, fontWeight: '700' },
  scoreLabel: { ...typography.caption, color: colors.textMuted },

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
  primaryBtnText: { ...typography.body, color: colors.bg, fontWeight: '800' },
  smallBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
  },
  dangerBtn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.danger },
  smallBtnText: { ...typography.caption, color: colors.text, fontWeight: '700' },

  presetRow: { flexDirection: 'row', gap: spacing.sm },
  preset: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
  },
  presetOn: { backgroundColor: colors.primary },
  presetText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  presetTextOn: { color: colors.bg },

  hint: { ...typography.caption, color: colors.textMuted },
  warn: { ...typography.caption, color: colors.accent, fontWeight: '600' },
  error: { ...typography.caption, color: colors.danger },

  lockBtn: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
  },
  lockBtnText: { ...typography.body, color: colors.textMuted, fontWeight: '600' },
});
