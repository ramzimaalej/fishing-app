/**
 * The angler's "I saw a bite" button.
 *
 * Renders only while a capture is running, and lives on the Fishing screen
 * rather than inside admin: the whole value of the mark is that it is pressed at
 * the moment the bite is seen, and nobody watching a rod is going to navigate
 * two screens deep first. Every hundred milliseconds of delay widens the gap
 * this label is supposed to pin down.
 *
 * Deliberately oversized and high-contrast — it gets pressed one-handed, in the
 * dark, by someone whose attention is on the water.
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

  const onMark = useCallback(() => {
    if (!rodId) return;
    const event = markHumanBite(rodId, rodName);
    if (!event) return;
    // Confirms the press landed without the angler having to look at the screen.
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    arm();
  }, [rodId, rodName, arm]);

  const onUndo = useCallback(() => {
    if (!undoLastHumanMark()) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (timer.current) clearTimeout(timer.current);
    setJustMarked(false);
  }, []);

  if (!recording) return null;

  return (
    <View style={styles.wrap}>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={onMark}
        disabled={!rodId}
        accessibilityRole="button"
        accessibilityLabel="Mark a bite you observed"
      >
        <Text style={styles.emoji}>🐟</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>I SAW A BITE</Text>
          <Text style={styles.sub}>
            {rodId ? `Marks ${rodName} · ${humanMarks} so far` : 'Select a rod first'}
          </Text>
        </View>
      </Pressable>

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
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  buttonPressed: { opacity: 0.7 },
  emoji: { fontSize: 34 },
  title: { ...typography.h2, color: colors.bg, fontWeight: '800', letterSpacing: 1 },
  sub: { ...typography.caption, color: colors.bg, opacity: 0.8 },
  undo: { alignSelf: 'center', paddingVertical: spacing.xs },
  undoText: { ...typography.caption, color: colors.accent, fontWeight: '700' },
});
