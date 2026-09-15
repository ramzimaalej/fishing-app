import { watchHydration } from '../useHydrated';

/** A store that hydrates when told to, mimicking zustand's persist API. */
function fakeStore() {
  let hydrated = false;
  const listeners = new Set<() => void>();
  return {
    persist: {
      hasHydrated: () => hydrated,
      onFinishHydration: (fn: () => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    finish() {
      hydrated = true;
      listeners.forEach((fn) => fn());
    },
    /** Hydrate WITHOUT notifying — models finishing before anyone subscribed. */
    finishSilently() {
      hydrated = true;
    },
    listenerCount: () => listeners.size,
  };
}

it('waits for every store, not just the first', () => {
  // The first screens read several stores, and any one still unloaded is enough
  // to render a wrong value as though it were a fact.
  const a = fakeStore();
  const b = fakeStore();
  const done = jest.fn();

  watchHydration([a, b], done);
  expect(done).not.toHaveBeenCalled();

  a.finish();
  expect(done).not.toHaveBeenCalled();

  b.finish();
  expect(done).toHaveBeenCalledTimes(1);
});

it('fires synchronously when storage was already loaded', () => {
  // Hydration often completes before the first commit. Deferring to a callback
  // would reproduce the same flash, only shorter.
  const a = fakeStore();
  a.finishSilently();
  const done = jest.fn();

  watchHydration([a], done);

  expect(done).toHaveBeenCalledTimes(1);
  // And nothing was subscribed, since there was nothing to wait for.
  expect(a.listenerCount()).toBe(0);
});

it('catches a store that finished between the first look and subscribing', () => {
  // THE ordering hazard, and it only bites when the store in question is the
  // LAST one still pending: its callback has already fired by the time we
  // subscribe and will never fire again, so nothing else will ever notice. The
  // re-check immediately after subscribing is the only thing that can.
  //
  // A first version of this test used two stores and passed with the re-check
  // deleted, because the other store's notification did the work. One store is
  // what makes the assertion load-bearing.
  const late = fakeStore();
  const subscribe = late.persist.onFinishHydration;
  late.persist.onFinishHydration = (fn: () => void) => {
    // Finishes DURING subscription — after the initial check saw it pending.
    late.finishSilently();
    return subscribe(fn);
  };

  const done = jest.fn();
  watchHydration([late], done);

  expect(done).toHaveBeenCalledTimes(1);
});

it('reports completion once, however many stores finish after', () => {
  const a = fakeStore();
  const b = fakeStore();
  const done = jest.fn();

  watchHydration([a, b], done);
  a.finish();
  b.finish();
  // A late notification from an already-satisfied set must not fire again.
  b.finish();

  expect(done).toHaveBeenCalledTimes(1);
});

it('unsubscribes everything it subscribed', () => {
  const a = fakeStore();
  const b = fakeStore();

  const stop = watchHydration([a, b], jest.fn());
  expect(a.listenerCount()).toBe(1);
  expect(b.listenerCount()).toBe(1);

  stop();
  expect(a.listenerCount()).toBe(0);
  expect(b.listenerCount()).toBe(0);
});
