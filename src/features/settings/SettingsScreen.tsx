/**
 * Settings screen. All changes persist automatically through useSettingsStore.
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
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

import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES, type LanguagePreference } from '@/i18n';
import { useLanguagePreference, useLanguageStore } from '@/i18n/languageStore';

import { SUBSCRIPTIONS_ENABLED } from '@/config/features';
import { useAdminStore } from '@/features/admin/adminStore';
import { appVersion } from '@/features/admin/storage';
import { useAuthStore } from '@/features/auth/authStore';
import { requestNotificationPermissions } from '@/features/notifications/feedback';
import { useSubscriptionStore } from '@/features/subscription/subscriptionStore';
import { colors, radius, spacing, typography } from '@/theme';

import SensitivitySlider from './components/SensitivitySlider';
import { useSettingsStore } from './settingsStore';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const languagePreference = useLanguagePreference();
  const setLanguagePreference = useLanguageStore((st) => st.setPreference);
  const settings = useSettingsStore((s) => s.settings);
  const setSensitivity = useSettingsStore((s) => s.setSensitivity);
  const setLiveBaitMode = useSettingsStore((s) => s.setLiveBaitMode);
  const setVibration = useSettingsStore((s) => s.setVibration);
  const setSoundEnabled = useSettingsStore((s) => s.setSoundEnabled);
  const setPushEnabled = useSettingsStore((s) => s.setPushEnabled);
  const reset = useSettingsStore((s) => s.reset);

  const navigation = useNavigation<{ navigate: (route: string) => void }>();
  const isPremium = useSubscriptionStore((s) => s.isPremium);
  const premiumSource = useSubscriptionStore((s) => s.source);
  const restore = useSubscriptionStore((s) => s.restore);
  const purchasing = useSubscriptionStore((s) => s.purchasing);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  const [requesting, setRequesting] = useState(false);

  /**
   * Hidden entry to the developer console: tap the version row seven times.
   *
   * The same gesture Android uses for its own developer options — familiar to
   * anyone who would want this, and effectively invisible to everyone else. A
   * plain visible row would put a data recorder one stray tap away for users who
   * have no use for it. Once unlocked the row becomes a normal link, since
   * re-tapping seven times every session is pure friction.
   */
  const adminUnlocked = useAdminStore((s) => s.unlocked);
  const [versionTaps, setVersionTaps] = useState(0);

  const onVersionPress = () => {
    if (adminUnlocked) {
      navigation.navigate('Admin');
      return;
    }
    const next = versionTaps + 1;
    if (next >= 7) {
      setVersionTaps(0);
      navigation.navigate('Admin');
      return;
    }
    setVersionTaps(next);
  };

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
        t('settings.pushDeniedTitle'),
        t('settings.pushDeniedBody'),
      );
    }
  };

  const confirmReset = () =>
    Alert.alert(t('settings.resetTitle'), t('settings.resetBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.reset'), style: 'destructive', onPress: reset },
    ]);

  const sensitivityPct = Math.round(settings.sensitivity * 100);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
      {/* Detection --------------------------------------------------------- */}
      <Text style={styles.sectionTitle}>{t('settings.detection')}</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>{t('settings.liveBait')}</Text>
            <Text style={styles.rowHelp}>{t('settings.liveBaitHelp')}</Text>
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
            <Text style={styles.rowLabel}>{t('settings.sensitivity')}</Text>
            <Text style={styles.sliderValue}>{sensitivityPct}%</Text>
          </View>
          <Text style={styles.rowHelp}>{t('settings.sensitivityHelp')}</Text>
          <SensitivitySlider value={settings.sensitivity} onChange={setSensitivity} />
        </View>
      </View>

      {/* Alerts ------------------------------------------------------------ */}
      <Text style={styles.sectionTitle}>{t('settings.alerts')}</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('settings.vibration')}</Text>
          <Switch
            value={settings.vibrationEnabled}
            onValueChange={setVibration}
            trackColor={{ true: colors.primary, false: colors.surfaceAlt }}
            thumbColor={colors.text}
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>{t('settings.sound')}</Text>
            {/* No audio ships in this build: SOUND_ASSETS is empty and every
                request degrades to a haptic tick. Selling a picker, a Preview
                button and a paywall line for sounds nobody can hear is the
                worst kind of overstatement in an alarm app. */}
            <Text style={styles.rowHelp}>{t('settings.soundUnavailable')}</Text>
          </View>
          <Switch
            value={false}
            disabled
            onValueChange={setSoundEnabled}
            trackColor={{ true: colors.primary, false: colors.surfaceAlt }}
            thumbColor={colors.text}
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>{t('settings.push')}</Text>
            <Text style={styles.rowHelp}>{t('settings.pushHelp')}</Text>
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

      {/* Language ---------------------------------------------------------- */}
      <Text style={styles.sectionTitle}>{t('settings.language')}</Text>
      <View style={styles.card}>
        {(['system', ...SUPPORTED_LANGUAGES] as LanguagePreference[]).map((option, i) => {
          const selected = option === languagePreference;
          return (
            <View key={option}>
              {i > 0 && <View style={styles.divider} />}
              <TouchableOpacity
                style={styles.row}
                onPress={() => setLanguagePreference(option)}
              >
                <Text style={styles.rowLabel}>
                  {/* Each language is named in itself, so someone can find their
                      own language without reading the current UI language. */}
                  {option === 'system' ? t('settings.languageSystem') : LANGUAGE_NAMES[option]}
                </Text>
                <Text style={[styles.check, selected && styles.checkOn]}>
                  {selected ? '●' : '○'}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      {/* Premium ----------------------------------------------------------- */}
      {/* Hidden wholesale on a hardware-only build: with no paid tier there is
          nothing to upgrade to and nothing to restore, and an "Upgrade" row
          that leads nowhere is worse than no row. */}
      {SUBSCRIPTIONS_ENABLED && (
      <>
      <Text style={styles.sectionTitle}>{t('settings.premium')}</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>
              {isPremium
                ? premiumSource === 'lifetime'
                  ? t('settings.premiumLifetime')
                  : t('settings.premiumActive')
                : t('settings.premiumTitle')}
            </Text>
            <Text style={styles.rowHelp}>
              {isPremium
                ? premiumSource === 'subscription'
                  ? t('settings.premiumRenews')
                  : t('settings.premiumThanks')
                : t('settings.premiumPitch')}
            </Text>
          </View>
          {!isPremium && (
            <TouchableOpacity
              style={styles.upgradeBtn}
              onPress={() => navigation.navigate('Paywall')}
            >
              <Text style={styles.upgradeText}>{t('settings.upgrade')}</Text>
            </TouchableOpacity>
          )}
        </View>
        {!isPremium && (
          <>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.row} onPress={() => restore()} disabled={purchasing}>
              <Text style={styles.rowLabel}>{t('settings.restore')}</Text>
              <Text style={styles.rowHelp}>{purchasing ? t('settings.working') : ''}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      </>
      )}

      {/* Account ----------------------------------------------------------- */}
      <Text style={styles.sectionTitle}>{t('settings.account')}</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('settings.signedIn')}</Text>
          <Text style={styles.rowHelp} numberOfLines={1}>
            {user?.email ?? '—'}
          </Text>
        </View>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.row} onPress={() => signOut()}>
          <Text style={[styles.rowLabel, { color: colors.danger }]}>{t('settings.signOut')}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.resetBtn} onPress={confirmReset}>
        <Text style={styles.resetText}>{t('settings.resetToDefaults')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.versionRow}
        onPress={onVersionPress}
        activeOpacity={1}
        accessibilityRole="button"
      >
        <Text style={styles.versionText}>
          Castmate {appVersion()}
          {adminUnlocked ? ' · Admin' : ''}
        </Text>
      </TouchableOpacity>
      </ScrollView>

    </View>
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
  soundLabelLocked: { color: colors.textMuted },
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
  versionRow: { marginTop: spacing.lg, paddingVertical: spacing.md, alignItems: 'center' },
  versionText: { ...typography.caption, color: colors.border },
});
