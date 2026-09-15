import { useEffect, useState } from 'react';

/**
 * True once every persisted store has finished loading from storage.
 *
 * WHY THIS EXISTS. zustand's persist middleware hydrates ASYNCHRONOUSLY. Until
 * it finishes, every store serves the initial state it was declared with, and
 * the UI renders that as though it were real — a rod with no tag reads "No tag
 * paired", a running session reads "idle", and the Start button offers to start
 * something already running.
 *
 * None of it is distinguishable from the truth, which is what makes it
 * expensive. It cost real diagnosis time twice in one session: once chasing a
 * rod binding that had never actually been lost, and once tapping what the
 * screen called Start and getting Stop, ending a session eleven minutes in.
 *
 * Gating a render is the whole fix. There is no correct way to show state that
 * has not loaded yet, and showing the DECLARED state is worse than showing
 * nothing — nothing is obviously nothing, while a wrong value looks like a fact.
 */

interface Hydratable {
  persist: {
    hasHydrated: () => boolean;
    onFinishHydration: (fn: () => void) => () => void;
  };
}

/** True when every store has already finished loading. */
export function allHydrated(stores: readonly Hydratable[]): boolean {
  return stores.every((s) => s.persist.hasHydrated());
}

/**
 * Call `onHydrated` once every store has loaded, and return an unsubscribe.
 *
 * Separated from the hook so the coordination can be tested without a renderer.
 * The ordering here is the whole substance — the hook around it is a
 * `useState` and a `useEffect`.
 *
 * Fires synchronously when nothing needs waiting for, and re-checks AFTER
 * subscribing because a store may finish between the caller's first look and
 * this one: its callback has already fired by then and will never fire again,
 * so subscribing alone would wait for ever.
 */
export function watchHydration(
  stores: readonly Hydratable[],
  onHydrated: () => void,
): () => void {
  if (allHydrated(stores)) {
    onHydrated();
    return () => {};
  }

  let settled = false;
  const check = () => {
    if (settled || !allHydrated(stores)) return;
    settled = true;
    onHydrated();
  };

  const unsubscribes = stores.map((s) => s.persist.onFinishHydration(check));
  check();

  return () => unsubscribes.forEach((off) => off());
}

/**
 * @param stores must be a STABLE array — declare it at module scope. A fresh
 *   array each render would re-subscribe on every pass.
 */
export function useHydrated(stores: readonly Hydratable[]): boolean {
  // Seeded in the initialiser rather than an effect: hydration from AsyncStorage
  // often completes before the first commit, and starting at false would then
  // produce exactly the flash this exists to remove, only shorter.
  const [hydrated, setHydrated] = useState(() => allHydrated(stores));

  useEffect(() => {
    if (hydrated) return;
    return watchHydration(stores, () => setHydrated(true));
  }, [hydrated, stores]);

  return hydrated;
}
