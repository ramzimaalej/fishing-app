import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';

import { useAdsStore } from '@/features/ads';
import { useAuthStore } from '@/features/auth/authStore';
import { cancelSessionNotifications } from '@/features/notifications/feedback';
import { useFishingSessionStore } from '@/features/session/fishingSessionStore';
import { isExpired } from '@/features/session/sessionLimit';
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

  useSessionExpiryEnforcement();
}

/** How often the running session is checked against the wall clock. */
const EXPIRY_POLL_MS = 30_000;

/**
 * Disarms every rod when the session window lapses.
 *
 * Checked against the wall clock on a poll AND on every return to foreground,
 * rather than with a single long timer: a six-hour setTimeout does not survive
 * the app being suspended, and a user who backgrounds the app past expiry must
 * not come back to rods still streaming past their allowance.
 *
 * The user-facing warning is a scheduled OS notification (see
 * scheduleSessionNotifications) precisely because this code may not be running
 * at the moment it matters.
 */
function useSessionExpiryEnforcement(): void {
  const window = useFishingSessionStore((s) => s.window);

  // Kept in a ref so the interval callback never needs re-creating.
  const windowRef = useRef(window);
  windowRef.current = window;
  /** Guards against re-disarming every poll once already expired. */
  const handled = useRef<number | null>(null);

  useEffect(() => {
    if (!window || window.expiresAt === null) return;
    // A new or extended window is a fresh deadline to enforce.
    if (handled.current !== window.expiresAt) handled.current = null;

    const check = () => {
      const current = windowRef.current;
      if (!current || current.expiresAt === null) return;
      if (!isExpired(current, Date.now())) return;
      if (handled.current === current.expiresAt) return;
      handled.current = current.expiresAt;

      // The window is deliberately NOT cleared here. It stays in an expired
      // state so the UI can show "session ended" and offer the extension —
      // clearing it would make the lapse invisible, which is the one outcome
      // this whole feature exists to prevent.
      void disarmAll();
      void cancelSessionNotifications();
      useAdsStore.getState().setFishingActive(false);
    };

    check();
    const timer = setInterval(check, EXPIRY_POLL_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });

    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [window]);
}
