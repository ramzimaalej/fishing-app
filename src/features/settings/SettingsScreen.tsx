/**
 * Settings screen. All changes persist automatically through useSettingsStore.
 */
import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useNavigation } from '@react-navigation/native';

import { NOTIFICATION_SOUNDS } from '@/config/constants';
import { useAuthStore } from '@/features/auth/authStore';
import { playSoundPreview, requestNotificationPermissions } from '@/features/notifications/feedback';
import { useSubscriptionStore } from '@/features/subscription/subscriptionStore';
import { colors, radius, spacing, typography } from '@/theme';

import SensitivitySlider from './components/SensitivitySlider';
import { useSettingsStore } from './settingsStore';

export default function SettingsScreen() {
  const settings = useSettingsStore((s) => s.settings);
  const setSensitivity = useSettingsStore((s) => s.setSensitivity);
  const setLiveBaitMode = useSettingsStore((s) => s.setLiveBaitMode);
  const setVibration = useSettingsStore((s) => s.setVibration);
  const setSoundEnabled = useSettingsStore((s) => s.setSoundEnabled);
  const setSoundKey = useSettingsStore((s) => s.setSoundKey);
  const setPushEnabled = useSettingsStore((s) => s.setPushEnabled);
  const reset = useSettingsStore((s) => s.reset);

  const navigation = useNavigation<{ navigate: (route: string) => void }>();
  const isPremium = useSubscriptionStore((s) => s.isPremium);
  const restore = useSubscriptionStore((s) => s.restore);
  const purchasing = useSubscriptionStore((s) => s.purchasing);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  const [requesting, setRequesting] = useState(false);

  const onTogglePush = async (next: boolean) => {
    if (!next) {
      setPushEnabled(false);
      return;
    }
    setRequesting(true);
    const granted = await requestNotificationPermissions();
    setRequesting(false);
    setPushEnabled(granted);
    if (!granted) {
      Alert.alert(
        'Notifications disabled',
        'Enable notifications for FishOn in your device Settings to receive bite alerts.',
      );
    }
  };

  const confirmReset = () =>
    Alert.alert('Reset settings', 'Restore all settings to their defaults?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: reset },
    ]);

  const sensitivityPct = Math.round(settings.sensitivity * 100);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Detection --------------------------------------------------------- */}
      <Text style={styles.sectionTitle}>Detection</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Live Bait Mode</Text>
            <Text style={styles.rowHelp}>
              Adapts to constant bait motion so a lively bait isn&apos;t mistaken for a bite.
            </Text>
          </View>
          <Switch
            value={settings.liveBaitMode}
            onValueChange={setLiveBaitMode}
            trackColor={{ true: colors.primary, false: colors.surfaceAlt }}
            thumbColor={colors.text}
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.rowText}>
          <View style={styles.sliderHeader}>
            <Text style={styles.rowLabel}>Bite Sensitivity</Text>
            <Text style={styles.sliderValue}>{sensitivityPct}%</Text>
          </View>
          <Text style={styles.rowHelp}>
            Higher sensitivity detects smaller nibbles; lower ignores all but strong strikes.
          </Text>
          <SensitivitySlider value={settings.sensitivity} onChange={setSensitivity} />
        </View>
      </View>

      {/* Alerts ------------------------------------------------------------ */}
      <Text style={styles.sectionTitle}>Alerts</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Vibration</Text>
          <Switch
            value={settings.vibrationEnabled}
            onValueChange={setVibration}
            trackColor={{ true: colors.primary, false: colors.surfaceAlt }}
            thumbColor={colors.text}
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.row}>
          <Text style={styles.rowLabel}>Sound</Text>
          <Switch
            value={settings.soundEnabled}
            onValueChange={setSoundEnabled}
            trackColor={{ true: colors.primary, false: colors.surfaceAlt }}
            thumbColor={colors.text}
          />
        </View>

        {settings.soundEnabled && (
          <View style={styles.soundList}>
            {NOTIFICATION_SOUNDS.map((sound) => {
              const selected = sound.key === settings.soundKey;
              return (
                <View key={sound.key} style={styles.soundRow}>
                  <TouchableOpacity
                    style={styles.soundSelect}
                    onPress={() => setSoundKey(sound.key)}
                  >
                    <Text style={[styles.check, selected && styles.checkOn]}>
                      {selected ? '●' : '○'}
                    </Text>
                    <Text style={styles.soundLabel}>{sound.label}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.previewBtn}
                    onPress={() => playSoundPreview(sound.key)}
                  >
                    <Text style={styles.previewText}>Preview</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.divider} />

        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Push Notifications</Text>
            <Text style={styles.rowHelp}>Get a notification the moment a bite is detected.</Text>
          </View>
          <Switch
            value={settings.pushEnabled}
            onValueChange={onTogglePush}
            disabled={requesting}
            trackColor={{ true: colors.primary, false: colors.surfaceAlt }}
            thumbColor={colors.text}
          />
        </View>
      </View>

      {/* Premium ----------------------------------------------------------- */}
      <Text style={styles.sectionTitle}>Premium</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>{isPremium ? 'Premium active' : 'FishOn Premium'}</Text>
            <Text style={styles.rowHelp}>
              {isPremium
                ? 'Ads removed and all features unlocked. Thank you!'
                : 'Remove ads and unlock everything.'}
            </Text>
          </View>
          {!isPremium && (
            <TouchableOpacity
              style={styles.upgradeBtn}
              onPress={() => navigation.navigate('Paywall')}
            >
              <Text style={styles.upgradeText}>Upgrade</Text>
            </TouchableOpacity>
          )}
        </View>
        {!isPremium && (
          <>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.row} onPress={() => restore()} disabled={purchasing}>
              <Text style={styles.rowLabel}>Restore purchases</Text>
              <Text style={styles.rowHelp}>{purchasing ? 'Working…' : ''}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Account ----------------------------------------------------------- */}
      <Text style={styles.sectionTitle}>Account</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Signed in</Text>
          <Text style={styles.rowHelp} numberOfLines={1}>
            {user?.email ?? '—'}
          </Text>
        </View>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.row} onPress={() => signOut()}>
          <Text style={[styles.rowLabel, { color: colors.danger }]}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.resetBtn} onPress={confirmReset}>
        <Text style={styles.resetText}>Reset to defaults</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  sectionTitle: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  rowText: { flex: 1, paddingRight: spacing.md, paddingVertical: spacing.md },
  rowLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
  rowHelp: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  sliderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sliderValue: { ...typography.body, color: colors.primary, fontWeight: '700' },
  soundList: { paddingBottom: spacing.sm },
  soundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  soundSelect: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  check: { color: colors.textMuted, fontSize: 18, width: 26 },
  checkOn: { color: colors.primary },
  soundLabel: { ...typography.body, color: colors.text },
  previewBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  previewText: { ...typography.caption, color: colors.text, fontWeight: '600' },
  upgradeBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    alignSelf: 'center',
  },
  upgradeText: { ...typography.body, color: colors.bg, fontWeight: '700' },
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
