import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { SensorKind } from '@/features/ble/deviceRegistry';
import i18n from '@/i18n';

import { defaultRodName, normaliseRodName, type Rod } from './rod';

/**
 * Localised default name, generated once when a rod is created.
 *
 * Not translated at render time: the name is persisted and user-editable, so
 * re-deriving it would overwrite a name the user had kept — and would rename
 * their rods out from under them on a language switch.
 */
function localisedRodName(index: number): string {
  const translated = i18n.t('rods.defaultName', { number: index + 1 });
  // Before i18next initialises, `t` echoes the key back — fall back rather than
  // persisting "rods.defaultName" as somebody's rod name.
  return translated.includes('rods.defaultName') ? defaultRodName(index) : translated;
}

/**
 * Persisted rod setup.
 *
 * Rods survive restarts because they represent physical kit: the user names
 * their rods and pairs tags once, not every trip. Entitlement is NOT enforced
 * here — the store holds whatever the user configured and `activeRods()` decides
 * what may be armed, so a lapsed subscription hides rods instead of destroying
 * them (see rod.ts).
 */

let seq = 0;
/** Monotonic id. Date.now() alone collides when two rods are added in one tick. */
function newRodId(): string {
  seq += 1;
  return `rod_${Date.now().toString(36)}_${seq.toString(36)}`;
}

interface RodState {
  rods: Rod[];
  /** Rod whose live chart is shown on the Fishing screen. */
  selectedRodId: string | null;

  addRod: (init?: { name?: string; sensorKind?: SensorKind }) => Rod;
  removeRod: (id: string) => void;
  renameRod: (id: string, name: string) => void;
  setSensorKind: (id: string, kind: SensorKind) => void;
  /** Bind (or clear) the physical device this rod reads. */
  setDeviceId: (id: string, deviceId: string | null) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  selectRod: (id: string | null) => void;
  /** Create the implicit first rod on first launch, if none exist. */
  ensureDefaultRod: () => void;
}

export const useRodStore = create<RodState>()(
  persist(
    (set, get) => ({
      rods: [],
      selectedRodId: null,

      addRod: (init) => {
        const rods = get().rods;
        const rod: Rod = {
          id: newRodId(),
          name: init?.name?.trim()
            ? normaliseRodName(init.name, rods.length)
            : localisedRodName(rods.length),
          // Default to the simulator so a new rod is immediately usable with no
          // hardware; the user picks the real sensor when they pair a tag.
          sensorKind: init?.sensorKind ?? 'mock',
          deviceId: null,
          enabled: true,
          createdAt: Date.now(),
        };
        set({
          rods: [...rods, rod],
          selectedRodId: get().selectedRodId ?? rod.id,
        });
        return rod;
      },

      removeRod: (id) =>
        set((s) => {
          const rods = s.rods.filter((r) => r.id !== id);
          return {
            rods,
            // Keep a valid selection: fall back to the first remaining rod.
            selectedRodId: s.selectedRodId === id ? (rods[0]?.id ?? null) : s.selectedRodId,
          };
        }),

      renameRod: (id, name) =>
        set((s) => ({
          rods: s.rods.map((r, i) =>
            r.id === id ? { ...r, name: normaliseRodName(name, i) } : r,
          ),
        })),

      setSensorKind: (id, kind) =>
        set((s) => ({
          rods: s.rods.map((r) =>
            // Changing sensor type invalidates the binding: a MAC from a Minew
            // tag is meaningless to the GATT client, and a stale id would make
            // the rod look paired when it cannot stream.
            r.id === id ? { ...r, sensorKind: kind, deviceId: null } : r,
          ),
        })),

      setDeviceId: (id, deviceId) =>
        set((s) => ({
          rods: s.rods.map((r) => (r.id === id ? { ...r, deviceId } : r)),
        })),

      setEnabled: (id, enabled) =>
        set((s) => ({
          rods: s.rods.map((r) => (r.id === id ? { ...r, enabled } : r)),
        })),

      selectRod: (id) => set({ selectedRodId: id }),

      ensureDefaultRod: () => {
        if (get().rods.length > 0) return;
        const rod: Rod = {
          id: newRodId(),
          name: localisedRodName(0),
          sensorKind: 'mock',
          deviceId: null,
          enabled: true,
          createdAt: Date.now(),
        };
        set({ rods: [rod], selectedRodId: rod.id });
      },
    }),
    {
      name: 'castmate:rods',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ rods: s.rods, selectedRodId: s.selectedRodId }),
      // Guarantee there is always at least one rod to fish with, including for
      // users upgrading from the single-sensor build (who have none stored).
      onRehydrateStorage: () => () => {
        useRodStore.getState().ensureDefaultRod();
      },
    },
  ),
);

/** Convenience selectors. */
export const useRods = (): Rod[] => useRodStore((s) => s.rods);
export const useSelectedRodId = (): string | null => useRodStore((s) => s.selectedRodId);
