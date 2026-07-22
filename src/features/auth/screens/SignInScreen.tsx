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

export default function SignInScreen() {
  const navigation = useNavigation<any>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const signInEmail = useAuthStore((s) => s.signInEmail);
  const signInGoogle = useAuthStore((s) => s.signInGoogle);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Castmate</Text>
        <Text style={styles.subtitle}>Sign in to track your bites</Text>

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
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.primaryBtn, !canSubmit && styles.btnDisabled]}
          disabled={!canSubmit}
          onPress={() => signInEmail(email, password)}
        >
          {busy ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.primaryBtnText}>Sign In</Text>
          )}
        </Pressable>

        <View style={styles.dividerRow}>
          <View style={styles.divider} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.divider} />
        </View>

        <Pressable
          style={styles.socialBtn}
          disabled={busy}
          onPress={() => signInGoogle()}
        >
          <Text style={styles.socialBtnText}>Continue with Google</Text>
        </Pressable>

        <Pressable style={styles.linkRow} onPress={() => navigation.navigate('SignUp')}>
          <Text style={styles.linkText}>
            No account? <Text style={styles.linkStrong}>Create one</Text>
          </Text>
        </Pressable>

        {__DEV__ && (
          <Pressable
            style={styles.linkRow}
            testID="dev-demo-mode"
            onPress={() =>
              // DEV-ONLY: explore the app without a configured Firebase backend.
              // Compiled out of release builds via __DEV__.
              useAuthStore.setState({
                user: {
                  uid: 'dev-demo',
                  email: 'demo@castmate.dev',
                  displayName: 'Demo Angler',
                  emailVerified: true,
                  photoURL: null,
                  isPremium: false,
                },
                initializing: false,
                error: null,
              })
            }
          >
            <Text style={styles.devLink}>Continue in demo mode (dev only)</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  title: { ...typography.h1, color: colors.primary, textAlign: 'center' },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
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
  error: { color: colors.danger, marginBottom: spacing.md, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { ...typography.h3, color: colors.bg },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.lg,
  },
  divider: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textMuted, marginHorizontal: spacing.md },
  socialBtn: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  socialBtnText: { ...typography.body, color: colors.text, fontWeight: '600' },
  linkRow: { marginTop: spacing.md, alignItems: 'center' },
  linkText: { color: colors.textMuted },
  linkStrong: { color: colors.primary, fontWeight: '700' },
  devLink: { color: colors.accent, ...typography.caption },
});
