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

import { FREE_SOUND_COUNT, NOTIFICATION_SOUNDS } from '@/config/constants';
import { SUBSCRIPTIONS_ENABLED } from '@/config/features';
import { useAuthStore } from '@/features/auth/authStore';
import { playSoundPreview, requestNotificationPermissions } from '@/features/notifications/feedback';
import { useSubscriptionStore } from '@/features/subscription/subscriptionStore';
import { useEntitlements } from '@/features/subscription/useEntitlements';
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
  const setSoundKey = useSettingsStore((s) => s.setSoundKey);
  const setPushEnabled = useSettingsStore((s) => s.setPushEnabled);
  const reset = useSettingsStore((s) => s.reset);

  const navigation = useNavigation<{ navigate: (route: string) => void }>();
  const isPremium = useSubscriptionStore((s) => s.isPremium);
  const premiumSource = useSubscriptionStore((s) => s.source);
  const restore = useSubscriptionStore((s) => s.restore);
  const purchasing = useSubscriptionStore((s) => s.purchasing);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const { has } = useEntitlements();

  const allSounds = has('sound-pack');
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
          <Text style={styles.rowLabel}>{t('settings.sound')}</Text>
          <Switch
            value={settings.soundEnabled}
            onValueChange={setSoundEnabled}
            trackColor={{ true: colors.primary, false: colors.surfaceAlt }}
            thumbColor={colors.text}
          />
        </View>

        {settings.soundEnabled && (
          <View style={styles.soundList}>
            {NOTIFICATION_SOUNDS.map((sound, i) => {
              const selected = sound.key === settings.soundKey;
              // The first FREE_SOUND_COUNT sounds are always available; the rest
              // need premium. Preview stays open for every sound — hearing it
              // is what sells the upgrade.
              const locked = !allSounds && i >= FREE_SOUND_COUNT;
              return (
                <View key={sound.key} style={styles.soundRow}>
                  <TouchableOpacity
                    style={styles.soundSelect}
                    onPress={() =>
                      locked && SUBSCRIPTIONS_ENABLED
                        ? navigation.navigate('Paywall')
                        : setSoundKey(sound.key)
                    }
                  >
                    <Text style={[styles.check, selected && styles.checkOn]}>
                      {locked ? '🔒' : selected ? '●' : '○'}
                    </Text>
                    <Text style={[styles.soundLabel, locked && styles.soundLabelLocked]}>
                      {sound.label}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.previewBtn}
                    onPress={() => playSoundPreview(sound.key)}
                  >
                    <Text style={styles.previewText}>{t('settings.preview')}</Text>
                  </TouchableOpacity>
                </View>
              );
            })}

          </View>
        )}

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
});
