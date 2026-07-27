import { useEffect, useMemo } from 'react';

import { useAuthStore } from '@/features/auth/authStore';
import { useSettings } from '@/features/settings/settingsStore';

import { activeRods, type Rod } from './rod';
import {
  disarmAll,
  retuneAll,
  setRuntimeUid,
  syncRodMeta,
  useRodRuntimeStore,
  type RodRuntimeView,
} from './rodRuntime';
import { useRodStore } from './rodStore';

/** Empty view for a rod that isn't armed, so the UI has no null branches. */
function idleView(rodId: string): RodRuntimeView {
  return {
    rodId,
    status: 'idle',
    device: null,
    error: null,
    biteCount: 0,
    threshold: 0,
    isWarmedUp: false,
    points: [],
    bites: [],
    lastBite: null,
  };
}

/** One rod's live view, falling back to an idle view when not armed. */
export function useRodView(rodId: string | null): RodRuntimeView {
  const views = useRodRuntimeStore((s) => s.views);
  return useMemo(
    () => (rodId ? (views[rodId] ?? idleView(rodId)) : idleView('')),
    [views, rodId],
  );
}

export function useAnyArmed(): boolean {
  return useRodRuntimeStore((s) => s.anyArmed);
}

export function useLastBiteRodId(): string | null {
  return useRodRuntimeStore((s) => s.lastBiteRodId);
}

/** The rods that may be armed (enabled, up to the practical ceiling). */
export function useArmableRods(): Rod[] {
  const rods = useRodStore((s) => s.rods);
  return useMemo(() => activeRods(rods), [rods]);
}

/**
 * Wires the non-React runtime to app state. Mounted ONCE, high in the tree:
 *  - keeps the runtime's uid current so bites persist to the right user;
 *  - retunes every live detector when the sensitivity/live-bait settings move;
 *  - propagates rod renames into running runtimes (alerts name the rod);
 *  - disarms everything on unmount so no sensor is left streaming.
 */
export function useRodRuntimeBridge(): void {
  const uid = useAuthStore((s) => s.user?.uid ?? null);
  const settings = useSettings();
  const rods = useRodStore((s) => s.rods);

  useEffect(() => {
    setRuntimeUid(uid);
  }, [uid]);

  useEffect(() => {
    retuneAll({ sensitivity: settings.sensitivity, liveBaitMode: settings.liveBaitMode });
  }, [settings.sensitivity, settings.liveBaitMode]);

  useEffect(() => {
    for (const rod of rods) syncRodMeta(rod);
  }, [rods]);

  useEffect(
    () => () => {
      void disarmAll();
    },
    [],
  );
}
