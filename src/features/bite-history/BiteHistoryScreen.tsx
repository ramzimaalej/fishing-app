import { useNavigation } from '@react-navigation/native';
import { format } from 'date-fns';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FREE_HISTORY_DAYS } from '@/config/constants';
import {
  AdBanner,
  interleaveNativeAds,
  NATIVE_FEED_INTERVAL,
  NativeAdCard,
  RewardedUnlockCard,
  useOfferSlot,
} from '@/features/ads';
import { useAuth } from '@/features/auth/useAuth';
import { useIsPremium } from '@/features/subscription/subscriptionStore';
import { useEntitlements } from '@/features/subscription/useEntitlements';
import { colors, radius, spacing, typography } from '@/theme';
import type { BiteRecord } from '@/types';

import { biteRepository } from './biteRepository';
import { applyHistoryWindow } from './historyGate';
import { resolveLocalPhoto } from './photoStorage';
import { useBiteHistory } from './useBiteHistory';

function SizeBadge({ record }: { record: BiteRecord }) {
  const color = record.size === 'big' ? colors.big : colors.small;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{record.size.toUpperCase()}</Text>
    </View>
  );
}

function BiteRow({
  record,
  uid,
  cloudBackup,
  onEditNote,
}: {
  record: BiteRecord;
  uid: string;
  /** True when this photo may be backed up to the cloud (premium or unlock). */
  cloudBackup: boolean;
  onEditNote: (record: BiteRecord) => void;
}) {
  const [busy, setBusy] = useState(false);

  // Prefer the cloud copy (works across devices); fall back to the local file.
  const photoUri = record.imageUrl ?? (record.localImage ? resolveLocalPhoto(record.localImage) : null);

  const addPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to attach a catch photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;

    setBusy(true);
    try {
      // Saved on-device for everyone; cloud backup depends on entitlement.
      await biteRepository.attachImage(uid, record.id, result.assets[0].uri, { cloudBackup });
    } catch (e) {
      Alert.alert('Could not attach photo', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }, [record.id, uid, cloudBackup]);

  return (
    <View style={styles.row}>
      {photoUri ? (
        <Image source={{ uri: photoUri }} style={styles.thumb} />
      ) : (
        <Pressable
          style={[styles.thumb, styles.thumbPlaceholder]}
          onPress={addPhoto}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={styles.thumbPlus}>＋</Text>
          )}
        </Pressable>
      )}

      <View style={styles.rowBody}>
        <View style={styles.rowHeader}>
          <SizeBadge record={record} />
          <Text style={styles.time}>{format(record.timestamp, 'MMM d, HH:mm:ss')}</Text>
        </View>

        {/* Name as captured, so renaming or deleting a rod can't rewrite history. */}
        {record.rodName ? <Text style={styles.rodTag}>🎣 {record.rodName}</Text> : null}

        <Text style={styles.metrics}>
          peak {record.peakMagnitude.toFixed(2)} g · {Math.round(record.confidence * 100)}%
          confidence
        </Text>

        <Pressable onPress={() => onEditNote(record)}>
          <Text style={record.note ? styles.note : styles.notePlaceholder}>
            {record.note ? record.note : 'Add a note…'}
          </Text>
        </Pressable>

        {photoUri && (
          <View style={styles.photoMetaRow}>
            <Text style={styles.photoMeta}>
              {record.imageUrl ? '☁️ Backed up' : '📱 On this device'}
            </Text>
            <Pressable onPress={addPhoto} disabled={busy}>
              <Text style={styles.replacePhoto}>{busy ? 'Saving…' : 'Replace'}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

export default function BiteHistoryScreen() {
  const navigation = useNavigation<{ navigate: (route: string) => void }>();
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const isPremium = useIsPremium();
  const { adFree, has } = useEntitlements();
  const { records, loading, error } = useBiteHistory(uid);

  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<BiteRecord | null>(null);
  const [draftNote, setDraftNote] = useState('');

  const cloudBackup = has('photo-backup');
  // Resolve to a boolean before memoising: `has` is a fresh closure each render,
  // so depending on it directly would recompute the window every time.
  const historyUnlocked = has('history-depth');

  // Free tier reads the last FREE_HISTORY_DAYS; the rest sits behind the depth
  // gate (premium or a rewarded unlock). Nothing is deleted either way.
  const { visible, hiddenCount } = useMemo(
    () => applyHistoryWindow(records, historyUnlocked),
    [records, historyUnlocked],
  );

  // ONE rewarded offer for this screen, not two. Depth first: a user looking at
  // truncated history is reaching for exactly that, whereas photo backup is
  // incidental to why they opened the list.
  const hasUnbackedPhoto = useMemo(
    () => records.some((r) => r.localImage && !r.imageUrl),
    [records],
  );
  const offer = useOfferSlot(
    useMemo(
      () => [
        ...(hiddenCount > 0 ? (['history-depth'] as const) : []),
        ...(hasUnbackedPhoto ? (['photo-backup'] as const) : []),
      ],
      [hiddenCount, hasUnbackedPhoto],
    ),
  );

  // Interleave native units into the readable rows. Rebuilt only when the rows
  // or the entitlement change, so scrolling never reshuffles ad positions.
  const feed = useMemo(
    () =>
      interleaveNativeAds(visible, (r) => r.id, {
        interval: NATIVE_FEED_INTERVAL,
        enabled: !adFree,
      }),
    [visible, adFree],
  );

  // When a premium user has on-device-only photos (e.g. just upgraded), back
  // them up to the cloud once per session. Idempotent + best-effort.
  const triedBackfill = useRef(false);
  useEffect(() => {
    if (!isPremium || !uid) {
      triedBackfill.current = false;
      return;
    }
    if (triedBackfill.current) return;
    const pending = records.some((r) => r.localImage && !r.imageUrl);
    if (!pending) return;
    triedBackfill.current = true;
    void biteRepository.backfillCloudPhotos(uid, records);
  }, [isPremium, uid, records]);

  const onRefresh = useCallback(async () => {
    if (!uid) return;
    setRefreshing(true);
    try {
      // Subscription already keeps data live; this forces a fetch for feedback.
      await biteRepository.list(uid);
    } finally {
      setRefreshing(false);
    }
  }, [uid]);

  const openNote = useCallback((record: BiteRecord) => {
    setEditing(record);
    setDraftNote(record.note ?? '');
  }, []);

  const saveNote = useCallback(async () => {
    if (!uid || !editing) return;
    const target = editing;
    setEditing(null);
    try {
      await biteRepository.updateNote(uid, target.id, draftNote.trim());
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : 'Could not save note.');
    }
  }, [uid, editing, draftNote]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Bite History</Text>
        {records.length > 0 && (
          <Pressable
            style={styles.insightsBtn}
            onPress={() => navigation.navigate('CatchInsights')}
          >
            <Text style={styles.insightsText}>📊 Insights</Text>
          </Pressable>
        )}
      </View>

      {loading && records.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={feed}
          keyExtractor={(entry) => entry.key}
          renderItem={({ item: entry }) => {
            if (entry.type === 'ad') return <NativeAdCard placement="history-feed" />;
            return uid ? (
              <BiteRow
                record={entry.item}
                uid={uid}
                cloudBackup={cloudBackup}
                onEditNote={openNote}
              />
            ) : null;
          }}
          contentContainerStyle={feed.length === 0 && styles.emptyContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>No bites logged yet</Text>
              <Text style={styles.emptySub}>
                Connect your sensor and start fishing — detected bites appear here.
              </Text>
            </View>
          }
          ListFooterComponent={
            hiddenCount > 0 ? (
              <View style={styles.footer}>
                <Text style={styles.footerText}>
                  🔒 {hiddenCount} older {hiddenCount === 1 ? 'bite' : 'bites'} beyond the last{' '}
                  {FREE_HISTORY_DAYS} days
                </Text>
              </View>
            ) : null
          }
        />
      )}

      {/* Exactly one rewarded offer per screen, chosen by relevance — see
          useOfferSlot. Previously this screen carried two cards plus a banner
          plus in-feed natives. */}
      {offer && (
        <View style={styles.unlockSlot}>
          <RewardedUnlockCard kind={offer} hideWhenUnlocked />
        </View>
      )}

      {/* Review surface — anchored banner below the list, above the tab bar. */}
      <AdBanner placement="history" />

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Note</Text>
            <TextInput
              style={styles.input}
              value={draftNote}
              onChangeText={setDraftNote}
              placeholder="e.g. rainbow trout, spinner lure"
              placeholderTextColor={colors.textMuted}
              multiline
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalBtn} onPress={() => setEditing(null)}>
                <Text style={styles.modalBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={saveNote}>
                <Text style={[styles.modalBtnText, styles.modalBtnTextPrimary]}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: spacing.md,
  },
  title: { ...typography.h1, color: colors.text, padding: spacing.md },
  insightsBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  insightsText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyContainer: { flexGrow: 1 },
  footer: { padding: spacing.md, gap: spacing.sm },
  footerText: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  unlockSlot: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  emptyTitle: { ...typography.h3, color: colors.text },
  emptySub: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  error: { color: colors.danger, ...typography.body },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  thumbPlus: { color: colors.primary, fontSize: 28, fontWeight: '600' },
  rowBody: { flex: 1, gap: spacing.xs },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  time: { ...typography.caption, color: colors.textMuted },
  rodTag: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  metrics: { ...typography.body, color: colors.text },
  note: { ...typography.body, color: colors.text, fontStyle: 'italic' },
  notePlaceholder: { ...typography.body, color: colors.textMuted, fontStyle: 'italic' },
  photoMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  photoMeta: { ...typography.caption, color: colors.textMuted },
  replacePhoto: { ...typography.caption, color: colors.primary },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  badgeDot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: { ...typography.h3, color: colors.text },
  input: {
    minHeight: 80,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  modalBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md },
  modalBtnPrimary: { backgroundColor: colors.primary },
  modalBtnText: { ...typography.body, color: colors.textMuted, fontWeight: '600' },
  modalBtnTextPrimary: { color: colors.bg },
});
