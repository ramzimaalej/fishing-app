/**
 * Persisted detection parameters.
 *
 * These are tunable at runtime because the shipped defaults WILL be wrong. They
 * depend on rod action, where the tag is mounted, casting weight and sea state,
 * and ONSET_RATE_MIN in particular is an outright guess until it has been set
 * from labelled session data (see the calibration view).
 *
 * Persisted so a tuning session survives a restart — the alternative is
 * re-entering eight numbers every time the app is reopened, which in practice
 * means nobody tunes anything.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  clampParams,
  DEFAULT_DETECTION_PARAMS,
  type DetectionParams,
} from './detectionParams';

interface DetectionParamsState {
  params: DetectionParams;
  set: <K extends keyof DetectionParams>(key: K, value: DetectionParams[K]) => void;
  reset: () => void;
}

/** Applied to every live rod whenever the parameters change. */
let onChange: ((params: DetectionParams) => void) | null = null;

/**
 * Register the runtime's applier.
 *
 * Injected rather than imported: rodRuntime already imports this module's types,
 * and importing it back would be a cycle. It also keeps this store free of any
 * dependency on the BLE stack, so it can be exercised in tests.
 */
export function setDetectionParamsListener(fn: ((p: DetectionParams) => void) | null): void {
  onChange = fn;
}

export const useDetectionParamsStore = create<DetectionParamsState>()(
  persist(
    (set, get) => ({
      params: DEFAULT_DETECTION_PARAMS,

      set: (key, value) => {
        // Clamped on write rather than on read: a value outside its range is a
        // mistake, and storing it would leave the settings screen showing a
        // number the detector is not actually using.
        const next = clampParams({ ...get().params, [key]: value });
        set({ params: next });
        onChange?.(next);
      },

      reset: () => {
        set({ params: DEFAULT_DETECTION_PARAMS });
        onChange?.(DEFAULT_DETECTION_PARAMS);
      },
    }),
    {
      name: 'castmate:detection-params',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ params: s.params }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Backfill parameters added since the stored version was written, and
        // clamp anything a previous build allowed that this one does not.
        state.params = clampParams({ ...DEFAULT_DETECTION_PARAMS, ...state.params });
        onChange?.(state.params);
      },
    },
  ),
);

/** Current parameters, for non-React callers such as the runtime. */
export function currentDetectionParams(): DetectionParams {
  return useDetectionParamsStore.getState().params;
}
