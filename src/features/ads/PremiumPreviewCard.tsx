import { useNavigation } from '@react-navigation/native';
import { format } from 'date-fns';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';

import { useRewardedPreview } from './useRewardedPreview';

/**
 * Opt-in monetization card for planning surfaces (Conditions screen).
 *
 * Three states, never pushy:
 *  - preview running → shows the expiry + a soft "keep it" paywall link;
 *  - rewarded ad loaded → offers the 24h Premium Preview;
 *  - nothing loaded / user is ad-free → renders nothing (we never promise an
 *    ad we can't show).
 */
export default function PremiumPreviewCard(): JSX.Element | null {
  const navigation = useNavigation<any>();
  const { available, previewActive, previewUntil, watch } = useRewardedPreview();

  if (previewActive && previewUntil) {
    return (
      <View style={[styles.card, styles.cardActive]}>
        <Text style={styles.emoji}>⭐</Text>
        <View style={styles.body}>
          <Text style={styles.title}>Premium Preview active</Text>
          <Text style={styles.sub}>Ad-free until {format(previewUntil, 'EEE HH:mm')}</Text>
        </View>
        <Pressable onPress={() => navigation.navigate('Paywall')} hitSlop={8}>
          <Text style={styles.link}>Keep it</Text>
        </Pressable>
      </View>
    );
  }

  if (!available) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.emoji}>🎬</Text>
      <View style={styles.body}>
        <Text style={styles.title}>Try Premium free for 24h</Text>
        <Text style={styles.sub}>Watch one short ad — no ads + pro insights for a day.</Text>
      </View>
      <Pressable style={styles.cta} onPress={() => watch()}>
        <Text style={styles.ctaText}>Start</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  cardActive: { borderColor: colors.accent },
  emoji: { fontSize: 24 },
  body: { flex: 1 },
  title: { ...typography.h3, color: colors.text },
  sub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  ctaText: { ...typography.body, color: colors.bg, fontWeight: '700' },
  link: { ...typography.body, color: colors.accent, fontWeight: '600' },
});
