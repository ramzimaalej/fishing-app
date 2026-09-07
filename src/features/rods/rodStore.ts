import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_SENSOR_KIND, type SensorKind } from '@/features/ble/deviceRegistry';
import { canonicalDeviceId } from '@/features/devices/device';
import type { RodColour } from '@/theme';
import i18n from '@/i18n';

import {
  defaultRodName,
  migrateRods,
  nextRodColour,
  normaliseRodName,
  normaliseRods,
  type Rod,
} from './rod';

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
  setColour: (id: string, colour: RodColour) => void;
  /** Bind (or clear) the physical device this rod reads. */
  setDeviceId: (id: string, deviceId: string | null) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  selectRod: (id: string | null) => void;
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
          // Defaults to the shipping sensor: it is the only device a customer
          // has, so anything else means every new rod starts wrong.
          sensorKind: init?.sensorKind ?? DEFAULT_SENSOR_KIND,
          deviceId: null,
          enabled: true,
          colour: nextRodColour(rods.map((r) => r.colour)),
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

      setColour: (id, colour) =>
        set((s) => ({
          rods: s.rods.map((r) => (r.id === id ? { ...r, colour } : r)),
        })),

      selectRod: (id) => set({ selectedRodId: id }),
    }),
    {
      name: 'castmate:rods',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ rods: s.rods, selectedRodId: s.selectedRodId }),
      // 1: the four selectable sensor kinds collapsed to one device.
      // 2: tag identity became the five-octet MAC tail.
      version: 2,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as { rods?: Rod[]; selectedRodId?: string | null };
        let rods = state.rods ?? [];
        /**
         * One-time upgrade from the multi-device build: rewrites the retired
         * kinds ('minew' / 'cp27' / 'generic') and moves rods off the now
         * dev-only simulator, which used to be the default for every rod this
         * app created.
         */
        if (version < 1) rods = migrateRods(rods);
        /**
         * Bindings written before tag identity was canonicalised hold a full
         * six-octet MAC. The tag is now keyed by its five-octet tail, so an
         * unmigrated rod would point at an id no tag will ever report and read
         * as permanently unpaired.
         */
        if (version < 2) {
          rods = rods.map((r) =>
            r.deviceId ? { ...r, deviceId: canonicalDeviceId(r.deviceId) } : r,
          );
        }
        return { ...state, rods };
      },
      onRehydrateStorage: () => (state) => {
        // Every launch, but only rescuing kinds the registry cannot resolve —
        // `migrate` runs only when the stored version is older, so a rod written
        // by an intermediate build or hand-edited storage would otherwise crash
        // on arming. Deliberately NOT the full migration: that would revert a
        // simulator picked in admin mode on the next launch.
        if (state) state.rods = normaliseRods(state.rods);
        // Deliberately NOT creating a starter rod here. An auto-created rod is
        // one nobody chose and no tag is bound to, so it shows on the Fishing
        // screen as a rod that cannot fish — and, being the only rod, it could
        // not be deleted either. Rods are created by the user (Fishing → ＋), and
        // "no rods yet" is a state the Rods and Devices screens both handle.
      },
    },
  ),
);

/** Convenience selectors. */
export const useRods = (): Rod[] => useRodStore((s) => s.rods);
export const useSelectedRodId = (): string | null => useRodStore((s) => s.selectedRodId);
