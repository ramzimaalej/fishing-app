import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { GeoCoords } from '@/types';

import {
  type DeviceFix,
  type GeoPlace,
  isFixStale,
  type LocationMode,
  type PermissionState,
  resolveCoords,
} from './location';

/**
 * The fishing location: the device's position, or a city the user picked.
 *
 * Persisted so the app opens on the right coast. The device fix is persisted too
 * — a cached position from the last trip is far better than a blank Conditions
 * tab while the GPS warms up, and staleness is visible via `capturedAt`.
 */

/** Lazily required: a native module, absent in Jest and in unlinked builds. */
function getLocationModule(): typeof import('expo-location') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-location');
  } catch {
    return null;
  }
}

interface LocationState {
  mode: LocationMode;
  device: DeviceFix | null;
  manual: GeoPlace | null;
  permission: PermissionState;
  /** True while a GPS read is in flight, for a spinner on the picker. */
  locating: boolean;
  error: string | null;

  /** Ask for permission and take a fix. Switches to device mode on success. */
  detectDeviceLocation: () => Promise<boolean>;
  /** Refresh the fix if it's stale. Silent — never prompts, never sets error. */
  refreshIfStale: () => Promise<void>;
  /** Pin to a searched city. */
  setManualPlace: (place: GeoPlace) => void;
  /** Active coordinates, or null when unknown. */
  coords: () => GeoCoords | null;
}

export const useLocationStore = create<LocationState>()(
  persist(
    (set, get) => ({
      // Defaults to device: following the angler is right almost always, and the
      // alternative (a hardcoded city) is the bug this replaces.
      mode: 'device',
      device: null,
      manual: null,
      permission: 'unknown',
      locating: false,
      error: null,

      detectDeviceLocation: async () => {
        const Location = getLocationModule();
        if (!Location) {
          set({ error: 'Location is unavailable in this build.', permission: 'denied' });
          return false;
        }

        set({ locating: true, error: null });
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') {
            set({ permission: 'denied', locating: false });
            return false;
          }
          set({ permission: 'granted' });

          // Last-known first: it returns almost instantly and is plenty accurate
          // for a weather grid, so the UI fills immediately. The precise fix then
          // replaces it.
          const last = await Location.getLastKnownPositionAsync();
          if (last) {
            set({
              mode: 'device',
              device: {
                coords: { latitude: last.coords.latitude, longitude: last.coords.longitude },
                capturedAt: last.timestamp,
              },
            });
          }

          const current = await Location.getCurrentPositionAsync({
            // Balanced is deliberate: a forecast grid cell is kilometres wide, so
            // high accuracy would burn battery for no change in the data.
            accuracy: Location.Accuracy.Balanced,
          });
          set({
            mode: 'device',
            device: {
              coords: {
                latitude: current.coords.latitude,
                longitude: current.coords.longitude,
              },
              capturedAt: current.timestamp,
            },
            locating: false,
            error: null,
          });
          return true;
        } catch (e) {
          set({
            locating: false,
            error: e instanceof Error ? e.message : 'Could not determine your location.',
          });
          return false;
        }
      },

      refreshIfStale: async () => {
        const s = get();
        // Only ever refreshes an already-granted device fix. Never prompts, so
        // it is safe to call on screen focus.
        if (s.mode !== 'device' || s.permission !== 'granted') return;
        if (!isFixStale(s.device, Date.now())) return;

        const Location = getLocationModule();
        if (!Location) return;
        try {
          const current = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          set({
            device: {
              coords: {
                latitude: current.coords.latitude,
                longitude: current.coords.longitude,
              },
              capturedAt: current.timestamp,
            },
          });
        } catch {
          /* keep the previous fix — a stale position beats none */
        }
      },

      setManualPlace: (place) => set({ mode: 'manual', manual: place, error: null }),

      coords: () => {
        const s = get();
        return resolveCoords(s.mode, s.device, s.manual);
      },
    }),
    {
      name: 'castmate:location',
      storage: createJSONStorage(() => AsyncStorage),
      // `locating` and `error` are transient; permission is re-checked by the OS.
      partialize: (s) => ({
        mode: s.mode,
        device: s.device,
        manual: s.manual,
        permission: s.permission,
      }),
    },
  ),
);
