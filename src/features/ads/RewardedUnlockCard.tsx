import { useNavigation } from '@react-navigation/native';
import { format } from 'date-fns';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';

import type { RewardKind } from './rewards';
import { useRewardedUnlock } from './useRewardedUnlock';

interface Props {
  kind: RewardKind;
  /**
   * Render nothing once the feature is unlocked. Use on surfaces where the
   * unlocked state is already obvious from the content appearing.
   */
  hideWhenUnlocked?: boolean;
}

/**
 * The one component that offers a rewarded unlock. Four states, never pushy:
 *  - unlocked by an ad → shows the expiry + a soft "keep it" paywall link;
 *  - unlocked by the subscription → nothing (they already paid);
 *  - ad loaded → offers the trade, naming the feature rather than the ad;
 *  - nothing loaded → nothing (we never promise an ad we can't show).
 */
export default function RewardedUnlockCard({
  kind,
  hideWhenUnlocked,
}: Props): JSX.Element | null {
  const navigation = useNavigation<{ navigate: (route: string) => void }>();
  const { spec, unlocked, fromReward, until, available, watch } = useRewardedUnlock(kind);

  if (fromReward && until !== null) {
    if (hideWhenUnlocked) return null;
    return (
      <View style={[styles.card, styles.cardActive]}>
        <Text style={styles.emoji}>⭐</Text>
        <View style={styles.body}>
          <Text style={styles.title}>Unlocked</Text>
          <Text style={styles.sub}>Until {format(until, 'EEE HH:mm')}</Text>
        </View>
        <Pressable onPress={() => navigation.navigate('Paywall')} hitSlop={8}>
          <Text style={styles.link}>Keep it</Text>
        </Pressable>
      </View>
    );
  }

  if (unlocked || !available) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.emoji}>🎬</Text>
      <View style={styles.body}>
        <Text style={styles.title}>{spec.title}</Text>
        <Text style={styles.sub}>
          {spec.blurb} Watch one short ad to unlock {spec.durationLabel}.
        </Text>
      </View>
      <Pressable style={styles.cta} onPress={() => watch()}>
        <Text style={styles.ctaText}>{spec.cta}</Text>
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
