import { format } from 'date-fns';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useState } from 'react';
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

import { AdBanner } from '@/features/ads';
import { useAuth } from '@/features/auth/useAuth';
import { colors, radius, spacing, typography } from '@/theme';
import type { BiteRecord } from '@/types';

import { biteRepository } from './biteRepository';
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
  onEditNote,
}: {
  record: BiteRecord;
  uid: string;
  onEditNote: (record: BiteRecord) => void;
}) {
  const [busy, setBusy] = useState(false);

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
      await biteRepository.attachImage(uid, record.id, result.assets[0].uri);
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Could not attach photo.');
    } finally {
      setBusy(false);
    }
  }, [record.id, uid]);

  return (
    <View style={styles.row}>
      {record.imageUrl ? (
        <Image source={{ uri: record.imageUrl }} style={styles.thumb} />
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

        <Text style={styles.metrics}>
          peak {record.peakMagnitude.toFixed(2)} g · {Math.round(record.confidence * 100)}%
          confidence
        </Text>

        <Pressable onPress={() => onEditNote(record)}>
          <Text style={record.note ? styles.note : styles.notePlaceholder}>
            {record.note ? record.note : 'Add a note…'}
          </Text>
        </Pressable>

        {record.imageUrl && (
          <Pressable onPress={addPhoto} disabled={busy}>
            <Text style={styles.replacePhoto}>{busy ? 'Uploading…' : 'Replace photo'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export default function BiteHistoryScreen() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const { records, loading, error } = useBiteHistory(uid);

  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<BiteRecord | null>(null);
  const [draftNote, setDraftNote] = useState('');

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
      <Text style={styles.title}>Bite History</Text>

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
          data={records}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) =>
            uid ? <BiteRow record={item} uid={uid} onEditNote={openNote} /> : null
          }
          contentContainerStyle={records.length === 0 && styles.emptyContainer}
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
        />
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
  title: { ...typography.h1, color: colors.text, padding: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyContainer: { flexGrow: 1 },
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
  metrics: { ...typography.body, color: colors.text },
  note: { ...typography.body, color: colors.text, fontStyle: 'italic' },
  notePlaceholder: { ...typography.body, color: colors.textMuted, fontStyle: 'italic' },
  replacePhoto: { ...typography.caption, color: colors.primary, marginTop: spacing.xs },
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
