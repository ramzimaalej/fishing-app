/**
 * The angler's observation buttons: "I saw a fish" and "that was a wave".
 *
 * Renders only while a capture is running, and lives on the Fishing screen
 * rather than inside admin: the whole value of the mark is that it is pressed at
 * the moment the bite is seen, and nobody watching a rod is going to navigate
 * two screens deep first. Every hundred milliseconds of delay widens the gap
 * this label is supposed to pin down.
 *
 * Deliberately oversized and high-contrast — pressed one-handed, in the dark, by
 * someone whose attention is on the water.
 *
 * WHY TWO BUTTONS. Labelling only fish gives the distribution of fish onset
 * rates, which on its own says nothing about whether a threshold WORKS — that
 * depends entirely on whether it separates from the waves. Without labelled
 * negatives the calibration view can report a number, but not whether the number
 * means anything.
 */
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';

import { markHumanBite, undoLastHumanMark, useCaptureStore } from './recorder';

/** How long the confirmation and the undo offer stay up after a press. */
const CONFIRM_MS = 4000;

export default function BiteMarkButton({
  rodId,
  rodName,
}: {
  rodId: string | null;
  rodName: string;
}) {
  const recording = useCaptureStore((s) => s.recording);
  const humanMarks = useCaptureStore((s) => s.humanMarks);
  const waveMarks = useCaptureStore((s) => s.waveMarks);
  const [justMarked, setJustMarked] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const arm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setJustMarked(true);
    timer.current = setTimeout(() => setJustMarked(false), CONFIRM_MS);
  }, []);

  const onMark = useCallback(
    (kind: 'fish' | 'wave') => {
      if (!rodId) return;
      const event = markHumanBite(rodId, rodName, kind);
      if (!event) return;
      // Distinct feedback per label, so a mis-tap is noticeable without looking.
      void Haptics.notificationAsync(
        kind === 'fish'
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      );
      arm();
    },
    [rodId, rodName, arm],
  );

  const onUndo = useCallback(() => {
    if (!undoLastHumanMark()) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (timer.current) clearTimeout(timer.current);
    setJustMarked(false);
  }, []);

  if (!recording) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable
          style={({ pressed }) => [styles.button, styles.fish, pressed && styles.pressed]}
          onPress={() => onMark('fish')}
          disabled={!rodId}
          accessibilityRole="button"
          accessibilityLabel="Mark a fish you observed"
        >
          <Text style={styles.emoji}>🐟</Text>
          <Text style={styles.title}>FISH</Text>
          <Text style={styles.sub}>{humanMarks}</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.button, styles.wave, pressed && styles.pressed]}
          onPress={() => onMark('wave')}
          disabled={!rodId}
          accessibilityRole="button"
          accessibilityLabel="Mark a wave you observed"
        >
          <Text style={styles.emoji}>🌊</Text>
          <Text style={styles.title}>WAVE</Text>
          <Text style={styles.sub}>{waveMarks}</Text>
        </Pressable>
      </View>

      <Text style={styles.hint}>
        {rodId ? `Labelling ${rodName}` : 'Select a rod first'}
      </Text>

      {/* A mis-tap poisons the ground truth, so undo is offered inline rather
          than buried in the admin screen. */}
      {justMarked && (
        <Pressable style={styles.undo} onPress={onUndo} hitSlop={8}>
          <Text style={styles.undoText}>Logged — tap to undo</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  fish: { backgroundColor: colors.accent },
  wave: { backgroundColor: colors.surfaceAlt },
  pressed: { opacity: 0.7 },
  emoji: { fontSize: 26 },
  title: { ...typography.h3, color: colors.text, fontWeight: '800', letterSpacing: 1 },
  sub: { ...typography.caption, color: colors.text, opacity: 0.7 },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  undo: { alignSelf: 'center', paddingVertical: spacing.xs },
  undoText: { ...typography.caption, color: colors.accent, fontWeight: '700' },
});
