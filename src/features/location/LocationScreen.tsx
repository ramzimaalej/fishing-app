import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { currentLanguage } from '@/i18n';
import { colors, radius, spacing, typography } from '@/theme';

import { searchPlaces } from './geocoding';
import { formatCoords, formatPlace, type GeoPlace } from './location';
import { useLocationStore } from './locationStore';

/** Keystrokes settle before a request goes out. */
const SEARCH_DEBOUNCE_MS = 350;

export default function LocationScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<{ goBack: () => void }>();

  const mode = useLocationStore((s) => s.mode);
  const device = useLocationStore((s) => s.device);
  const manual = useLocationStore((s) => s.manual);
  const permission = useLocationStore((s) => s.permission);
  const locating = useLocationStore((s) => s.locating);
  const storeError = useLocationStore((s) => s.error);
  const detectDeviceLocation = useLocationStore((s) => s.detectDeviceLocation);
  const setManualPlace = useLocationStore((s) => s.setManualPlace);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Debounced, and every superseded request is aborted — otherwise a slow early
  // response can land after a faster later one and overwrite the right results.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setSearching(true);
      setSearchError(null);

      void searchPlaces(trimmed, { language: currentLanguage(), signal: controller.signal })
        .then((places) => {
          if (controller.signal.aborted) return;
          setResults(places);
          setSearching(false);
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted) return;
          setSearching(false);
          setSearchError(e instanceof Error ? e.message : t('location.searchFailed'));
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, t]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const choose = useCallback(
    (place: GeoPlace) => {
      setManualPlace(place);
      navigation.goBack();
    },
    [setManualPlace, navigation],
  );

  const onUseDevice = useCallback(async () => {
    const ok = await detectDeviceLocation();
    if (ok) navigation.goBack();
  }, [detectDeviceLocation, navigation]);

  const deviceActive = mode === 'device' && device !== null;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>{t('location.intro')}</Text>

        {/* --- Device location --- */}
        <Pressable
          style={[styles.card, deviceActive && styles.cardActive]}
          onPress={() => void onUseDevice()}
          disabled={locating}
        >
          <View style={styles.row}>
            <Text style={styles.emoji}>📍</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{t('location.useMyLocation')}</Text>
              <Text style={styles.cardSub}>
                {deviceActive
                  ? formatCoords(device.coords)
                  : permission === 'denied'
                    ? t('location.permissionDenied')
                    : t('location.useMyLocationSub')}
              </Text>
            </View>
            {locating ? (
              <ActivityIndicator color={colors.primary} />
            ) : deviceActive ? (
              <Text style={styles.check}>●</Text>
            ) : null}
          </View>
        </Pressable>

        {permission === 'denied' && (
          <Text style={styles.hint}>{t('location.permissionHint')}</Text>
        )}
        {storeError && <Text style={styles.error}>{storeError}</Text>}

        {/* --- Currently pinned city --- */}
        {manual && (
          <View style={[styles.card, mode === 'manual' && styles.cardActive]}>
            <View style={styles.row}>
              <Text style={styles.emoji}>🏙️</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{formatPlace(manual)}</Text>
                <Text style={styles.cardSub}>
                  {formatCoords({ latitude: manual.latitude, longitude: manual.longitude })}
                </Text>
              </View>
              {mode === 'manual' ? (
                <Text style={styles.check}>●</Text>
              ) : (
                <Pressable onPress={() => setManualPlace(manual)} hitSlop={8}>
                  <Text style={styles.link}>{t('location.usePinned')}</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {/* --- City search --- */}
        <Text style={styles.sectionTitle}>{t('location.searchTitle')}</Text>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder={t('location.searchPlaceholder')}
          placeholderTextColor={colors.textMuted}
          autoCorrect={false}
          returnKeyType="search"
        />

        {searching && <ActivityIndicator color={colors.primary} style={styles.spinner} />}
        {searchError && <Text style={styles.error}>{searchError}</Text>}
        {!searching && !searchError && query.trim().length >= 2 && results.length === 0 && (
          <Text style={styles.hint}>{t('location.noResults', { query: query.trim() })}</Text>
        )}

        {results.map((place) => (
          <Pressable key={place.id} style={styles.resultRow} onPress={() => choose(place)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.resultName}>{place.name}</Text>
              <Text style={styles.resultMeta} numberOfLines={1}>
                {[place.admin1, place.country].filter(Boolean).join(', ')}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}

        <Text style={styles.footnote}>{t('location.marineNote')}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  intro: { ...typography.caption, color: colors.textMuted },
  sectionTitle: { ...typography.h3, color: colors.text, marginTop: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  cardActive: { borderColor: colors.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  emoji: { fontSize: 22 },
  cardTitle: { ...typography.h3, color: colors.text },
  cardSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  check: { color: colors.primary, fontSize: 18 },
  link: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  hint: { ...typography.caption, color: colors.textMuted },
  error: { ...typography.caption, color: colors.danger },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    color: colors.text,
  },
  spinner: { marginTop: spacing.sm },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  resultName: { ...typography.body, color: colors.text, fontWeight: '600' },
  resultMeta: { ...typography.caption, color: colors.textMuted, marginTop: 1 },
  chevron: { ...typography.h2, color: colors.textMuted },
  footnote: { ...typography.caption, color: colors.border, marginTop: spacing.md },
});
