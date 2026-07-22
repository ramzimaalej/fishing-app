import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';

import { useAuthStore } from '../authStore';

export default function SignUpScreen() {
  const navigation = useNavigation<any>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const signUpEmail = useAuthStore((s) => s.signUpEmail);

  const onSubmit = async () => {
    setLocalError(null);
    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setLocalError('Passwords do not match.');
      return;
    }
    await signUpEmail(email, password);
    // On success the account exists and a verification email was sent.
    if (!useAuthStore.getState().error) {
      navigation.navigate('VerifyEmail');
    }
  };

  const shownError = localError ?? error;
  const canSubmit =
    email.trim().length > 0 && password.length > 0 && confirm.length > 0 && !busy;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Create account</Text>
        <Text style={styles.subtitle}>
          We&apos;ll email you a confirmation link to activate your account.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password (min 6 characters)"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <TextInput
          style={styles.input}
          placeholder="Confirm password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          value={confirm}
          onChangeText={setConfirm}
        />

        {shownError ? <Text style={styles.error}>{shownError}</Text> : null}

        <Pressable
          style={[styles.primaryBtn, !canSubmit && styles.btnDisabled]}
          disabled={!canSubmit}
          onPress={onSubmit}
        >
          {busy ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.primaryBtnText}>Sign Up</Text>
          )}
        </Pressable>

        <Pressable style={styles.linkRow} onPress={() => navigation.navigate('SignIn')}>
          <Text style={styles.linkText}>
            Already have an account? <Text style={styles.linkStrong}>Sign in</Text>
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted, marginBottom: spacing.xl },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    fontSize: typography.body.fontSize,
  },
  error: { color: colors.danger, marginBottom: spacing.md },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { ...typography.h3, color: colors.bg },
  linkRow: { marginTop: spacing.lg, alignItems: 'center' },
  linkText: { color: colors.textMuted },
  linkStrong: { color: colors.primary, fontWeight: '700' },
});
