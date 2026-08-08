/**
 * Every detection parameter, tunable in the field.
 *
 * Not internationalised — a developer instrument behind the admin gate.
 *
 * Changes apply to rods that are ALREADY armed (see setDetectionParams), which
 * matters: otherwise tuning would mean disarming and re-arming after every
 * adjustment, and re-arming re-baselines, so you would never be comparing like
 * with like.
 */
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  DETECTION_PARAM_RANGES,
  type DetectionParams,
  MAX_DT_FOR_RATE_MS,
} from '@/features/detection/detectionParams';
import { useDetectionParamsStore } from '@/features/detection/detectionParamsStore';
import { colors, radius, spacing, typography } from '@/theme';

interface Field {
  key: keyof DetectionParams;
  label: string;
  help: string;
}

const FIELDS: Field[] = [
  {
    key: 'thetaDeg',
    label: 'Deflection threshold',
    help: 'Angle from baseline that counts as a deflection. Must sit above the swell-induced tilt floor — in rough conditions that floor is high, and small fish fall under it. No setting fixes that.',
  },
  {
    key: 'dwellMs',
    label: 'Dwell',
    help: 'How long the rod must stay deflected for a sustained-load alert. This is what rejects swell on Path A: waves oscillate back through baseline, a loaded rod does not.',
  },
  {
    key: 'onsetRateMinDegPerS',
    label: 'Onset rate minimum',
    help: 'THE number to calibrate. A wave loads the rod over 1–3 s; a fish over 100–300 ms. Set this from the calibration view, not by feel.',
  },
  {
    key: 'crossingsN',
    label: 'Crossings required',
    help: 'How many deflections within the window before Path B will consider an alert.',
  },
  {
    key: 'meanDevDeg',
    label: 'Mean deviation',
    help: 'Sustained offset that supports Path B — oscillation sitting on top of a load, rather than around baseline.',
  },
  {
    key: 'cvMin',
    label: 'Interval CV minimum',
    help: 'Irregularity of crossing timing. Swell is periodic (low CV); fish are irregular (high).',
  },
  {
    key: 'windowMs',
    label: 'Window',
    help: 'Sliding window over which crossings, mean deviation and CV are computed.',
  },
  {
    key: 'tauS',
    label: 'Baseline time constant',
    help: 'How fast the at-rest attitude tracks drift such as tide. Frozen whenever the rod is deflected, so a hooked fish is never absorbed into it.',
  },
];

function ParamRow({ field }: { field: Field }) {
  const value = useDetectionParamsStore((s) => s.params[field.key]);
  const set = useDetectionParamsStore((s) => s.set);
  const range = DETECTION_PARAM_RANGES[field.key];
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    const parsed = Number(draft);
    setDraft(null);
    if (draft === null || draft.trim() === '' || !Number.isFinite(parsed)) return;
    set(field.key, parsed);
  };

  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{field.label}</Text>
        <Text style={styles.help}>{field.help}</Text>
        <Text style={styles.range}>
          {range.min}–{range.max} {range.unit}
        </Text>
      </View>
      <TextInput
        style={styles.input}
        value={draft ?? String(value)}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        keyboardType="numeric"
        selectTextOnFocus
      />
    </View>
  );
}

export default function DetectionSettingsScreen() {
  const reset = useDetectionParamsStore((s) => s.reset);

  const confirmReset = () =>
    Alert.alert('Reset detection parameters?', 'Back to the shipped defaults.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: reset },
    ]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.hint}>
          Values are clamped to their range on save, and applied immediately to rods that are
          already armed.
        </Text>
      </View>

      {FIELDS.map((f) => (
        <View key={f.key} style={styles.card}>
          <ParamRow field={f} />
        </View>
      ))}

      <Text style={styles.sectionTitle}>Fixed</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Max Δt for rate: {MAX_DT_FOR_RATE_MS} ms</Text>
        <Text style={styles.help}>
          Deliberately not tunable. Slope is only trusted across sample pairs close enough
          together that no packet can have been lost between them — the stream carries no
          sequence numbers, so there is no other way to know. Raising it would silently
          re-admit the artifact it exists to reject.
        </Text>
      </View>

      <Pressable style={styles.resetBtn} onPress={confirmReset}>
        <Text style={styles.resetText}>Reset to defaults</Text>
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
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  label: { ...typography.body, color: colors.text, fontWeight: '700' },
  help: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  range: { ...typography.caption, color: colors.border, marginTop: 2 },
  input: {
    ...typography.h3,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 84,
    textAlign: 'center',
  },
  hint: { ...typography.caption, color: colors.textMuted },
  resetBtn: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger,
    alignItems: 'center',
  },
  resetText: { ...typography.body, color: colors.danger, fontWeight: '600' },
});
