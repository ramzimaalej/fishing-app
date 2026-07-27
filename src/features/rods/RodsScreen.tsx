import { useNavigation } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { MAX_RODS } from '@/config/constants';
import { RewardedUnlockCard, useOfferSlot } from '@/features/ads';
import { getSensorDevice, listSensorDevices } from '@/features/ble/deviceRegistry';
import { colors, radius, spacing, typography } from '@/theme';

import { canAddRod, type Rod } from './rod';
import { useRodRuntimeStore } from './rodRuntime';
import { useRodStore } from './rodStore';

function RodRow({
  rod,
  index,
  onRename,
  onPair,
}: {
  rod: Rod;
  index: number;
  onRename: (rod: Rod) => void;
  onPair: (rod: Rod) => void;
}) {
  const setSensorKind = useRodStore((s) => s.setSensorKind);
  const setEnabled = useRodStore((s) => s.setEnabled);
  const removeRod = useRodStore((s) => s.removeRod);
  const rods = useRodStore((s) => s.rods);
  // Subscribed, not read imperatively: the label must update when the rod is
  // armed or disarmed from the Fishing screen.
  const armed = useRodRuntimeStore((s) => Boolean(s.views[rod.id]));

  const dev = getSensorDevice(rod.sensorKind);
  const needsPairing = dev.requiresDeviceBinding && rod.deviceId === null;

  const confirmRemove = () =>
    Alert.alert('Remove rod', `Remove “${rod.name}”? Logged bites are kept.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeRod(rod.id) },
    ]);

  return (
    <View style={styles.card}>
      <View style={styles.rowHeader}>
        <Pressable style={{ flex: 1 }} onPress={() => onRename(rod)}>
          <Text style={styles.rodName}>{rod.name}</Text>
          <Text style={styles.rodSub}>
            {dev.label}
            {armed ? ' · armed' : ''}
          </Text>
        </Pressable>
        <Switch
          value={rod.enabled}
          onValueChange={(v) => setEnabled(rod.id, v)}
          trackColor={{ true: colors.primaryDark, false: colors.surfaceAlt }}
          thumbColor={rod.enabled ? colors.primary : colors.textMuted}
        />
      </View>

      <View style={styles.divider} />

      <Text style={styles.fieldLabel}>Sensor</Text>
      <View style={styles.chipRow}>
        {listSensorDevices().map((d) => {
          const active = d.kind === rod.sensorKind;
          return (
            <Pressable
              key={d.kind}
              onPress={() => setSensorKind(rod.id, d.kind)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{d.short}</Text>
            </Pressable>
          );
        })}
      </View>

      {dev.requiresDeviceBinding && (
        <>
          <View style={styles.divider} />
          <Pressable style={styles.pairRow} onPress={() => onPair(rod)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Paired sensor</Text>
              <Text style={needsPairing ? styles.pairWarn : styles.pairValue}>
                {rod.deviceId ?? 'Not paired — tap to pair'}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          {needsPairing && (
            <Text style={styles.pairHint}>
              Each rod must be bound to its own sensor, or two rods would read the same one.
            </Text>
          )}
        </>
      )}

      {rods.length > 1 && (
        <>
          <View style={styles.divider} />
          <Pressable onPress={confirmRemove}>
            <Text style={styles.removeText}>Remove rod</Text>
          </Pressable>
        </>
      )}
      {index === 0 && rods.length === 1 && (
        <Text style={styles.pairHint}>Your first rod can&apos;t be removed.</Text>
      )}
    </View>
  );
}

export default function RodsScreen() {
  const navigation = useNavigation<{ navigate: (route: string, params?: object) => void }>();
  const rods = useRodStore((s) => s.rods);
  const addRod = useRodStore((s) => s.addRod);
  const renameRod = useRodStore((s) => s.renameRod);

  const [editing, setEditing] = useState<Rod | null>(null);
  const [draftName, setDraftName] = useState('');

  const verdict = canAddRod(rods.length);

  /**
   * Pairing is NOT ad-gated any more.
   *
   * It was, and it was the worst trade in the app: pairing is first-time setup,
   * so the gate turned a new user's opening experience into "watch an ad before
   * you can use the thing you just bought" — at the exact moment they are least
   * invested and most likely to leave. It earned one impression per 30 minutes.
   *
   * The impression is not lost, only moved: a rewarded offer is now presented
   * after a rod is successfully paired (see the offer slot below), which is a
   * moment of success rather than a moment of blocking. Post-success offers
   * convert better, so this should earn more, not less.
   */
  const paired = rods.some((r) => r.deviceId !== null);
  const offer = useOfferSlot(
    useMemo(() => (paired ? (['extended-forecast'] as const) : []), [paired]),
  );

  const openPairing = useCallback(
    (rod: Rod) => navigation.navigate('PairSensor', { rodId: rod.id }),
    [navigation],
  );

  const onAdd = useCallback(() => {
    if (verdict.allowed) {
      addRod();
      return;
    }
    // The only refusal is the practical ceiling, which paying cannot lift — so
    // this path never offers the paywall.
    Alert.alert('Maximum rods', `Castmate monitors up to ${MAX_RODS} rods at once.`);
  }, [verdict, addRod]);

  const openRename = (rod: Rod) => {
    setEditing(rod);
    setDraftName(rod.name);
  };

  const saveName = () => {
    if (editing) renameRod(editing.id, draftName);
    setEditing(null);
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Each rod runs its own detector and its own alarm, so a bite alert tells you which rod to
          pick up.
        </Text>

        {rods.map((rod, i) => (
          <RodRow
            key={rod.id}
            rod={rod}
            index={i}
            onRename={openRename}
            onPair={openPairing}
          />
        ))}

        <Pressable style={styles.addBtn} onPress={onAdd}>
          <Text style={styles.addBtnText}>
            {verdict.allowed ? '＋ Add rod' : `＋ Add rod (${rods.length}/${MAX_RODS})`}
          </Text>
        </Pressable>
      </ScrollView>

      {/* Banner removed: Rods is a task screen with seconds of dwell, so a
          banner earned almost nothing while adding chrome to setup. The offer
          below only appears once a rod is actually paired. */}
      {offer && (
        <View style={styles.offerSlot}>
          <RewardedUnlockCard kind={offer} hideWhenUnlocked />
        </View>
      )}

      <Modal visible={editing !== null} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rod name</Text>
            <TextInput
              style={styles.input}
              value={draftName}
              onChangeText={setDraftName}
              placeholder="e.g. Left rod"
              placeholderTextColor={colors.textMuted}
              autoFocus
              maxLength={40}
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalBtn} onPress={() => setEditing(null)}>
                <Text style={styles.modalBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={saveName}>
                <Text style={[styles.modalBtnText, styles.modalBtnTextPrimary]}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  intro: { ...typography.caption, color: colors.textMuted },
  offerSlot: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rodName: { ...typography.h3, color: colors.text },
  rodSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.border },
  fieldLabel: { ...typography.caption, color: colors.textMuted, textTransform: 'uppercase' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textMuted },
  chipTextActive: { color: colors.bg, fontWeight: '700' },
  pairRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pairValue: { ...typography.body, color: colors.text, marginTop: 2 },
  pairWarn: { ...typography.body, color: colors.accent, marginTop: 2 },
  pairHint: { ...typography.caption, color: colors.textMuted },
  chevron: { ...typography.h2, color: colors.textMuted },
  removeText: { ...typography.body, color: colors.danger, fontWeight: '600' },
  addBtn: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  addBtnText: { ...typography.body, color: colors.primary, fontWeight: '700' },
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
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  modalBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md },
  modalBtnPrimary: { backgroundColor: colors.primary },
  modalBtnText: { ...typography.body, color: colors.textMuted, fontWeight: '600' },
  modalBtnTextPrimary: { color: colors.bg },
});
