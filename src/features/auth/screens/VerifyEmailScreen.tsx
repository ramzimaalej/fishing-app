import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';

import { useAuthStore } from '../authStore';

export default function VerifyEmailScreen() {
  const [checking, setChecking] = useState(false);

  const user = useAuthStore((s) => s.user);
  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const reload = useAuthStore((s) => s.reload);
  const sendVerification = useAuthStore((s) => s.sendVerification);
  const signOut = useAuthStore((s) => s.signOut);

  const onContinue = async () => {
    setChecking(true);
    await reload();
    setChecking(false);
    // The app's root navigator gates on isVerified — if still unverified, tell them.
    if (!useAuthStore.getState().user?.emailVerified) {
      Alert.alert(
        'Not verified yet',
        'We could not confirm your email. Please tap the link in the email we sent, then try again.',
      );
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.emoji}>📩</Text>
        <Text style={styles.title}>Confirm your email</Text>
        <Text style={styles.body}>
          We sent a confirmation link to{'\n'}
          <Text style={styles.email}>{user?.email ?? 'your inbox'}</Text>.{'\n\n'}
          Tap the link to activate your account, then come back and continue.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.primaryBtn, (busy || checking) && styles.btnDisabled]}
          disabled={busy || checking}
          onPress={onContinue}
        >
          {checking ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.primaryBtnText}>I&apos;ve verified — continue</Text>
          )}
        </Pressable>

        <Pressable
          style={styles.secondaryBtn}
          disabled={busy}
          onPress={() => sendVerification()}
        >
          <Text style={styles.secondaryBtnText}>Resend email</Text>
        </Pressable>

        <Pressable style={styles.linkRow} onPress={() => signOut()}>
          <Text style={styles.linkText}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  emoji: { fontSize: 56, textAlign: 'center', marginBottom: spacing.md },
  title: { ...typography.h1, color: colors.text, textAlign: 'center' },
  body: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xl,
    lineHeight: 22,
  },
  email: { color: colors.primary, fontWeight: '700' },
  error: { color: colors.danger, marginBottom: spacing.md, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { ...typography.h3, color: colors.bg },
  secondaryBtn: {
    marginTop: spacing.md,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  secondaryBtnText: { ...typography.body, color: colors.text, fontWeight: '600' },
  linkRow: { marginTop: spacing.lg, alignItems: 'center' },
  linkText: { color: colors.textMuted, textDecorationLine: 'underline' },
});
