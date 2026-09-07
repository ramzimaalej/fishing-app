/**
 * Paired-device registry.
 *
 * Persisted, because a paired tag is physical kit the user owns — they should
 * pair it once, not every trip. Liveness is NOT persisted: whether a tag is
 * advertising is a fact about right now, and restoring a stale "live" from disk
 * would show a rod as watched before a single advertisement had arrived.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { ensureScanning, scanBrokerState, subscribeToScan } from '@/features/ble/scanBroker';
import { getSensorDevice } from '@/features/ble/deviceRegistry';
import type { BroadcastAdvertisement } from '@/features/ble/BroadcastSensorClient';

import { canonicalDeviceId, type PairedDevice } from './device';
import { codeMatchesDevice, isPlausibleCode, normaliseCode } from './deviceCode';

/** UI publish cadence — never once per advertisement. */
const PUBLISH_MS = 1000;

/** Tags seen while scanning but not yet paired. */
export interface DiscoveredDevice {
  id: string;
  /** Platform handle to connect with. See PairedDevice.connectionId. */
  connectionId: string;
  name: string;
  rssi: number;
  lastSeenAt: number;
  battery: number | null;
}

/** A code the user typed, waiting for the matching tag to be heard. */
export interface PendingPair {
  code: string;
  /** Rod to bind it to once found, if they started from a rod. */
  rodId: string | null;
  requestedAt: number;
}

interface DeviceState {
  /** Paired tags, keyed by id. Persisted. */
  paired: Record<string, PairedDevice>;
  /**
   * Codes awaiting their tag.
   *
   * The printed code is the last four digits of a MAC and the tags share no
   * common prefix, so a code cannot be turned INTO an address — it can only be
   * matched against something heard on air. Remembering it means the user types
   * it once at the car and it binds when they reach the rod.
   */
  pending: PendingPair[];
  /** Tags seen in the current scan and not paired. Not persisted. */
  discovered: Record<string, DiscoveredDevice>;
  scanning: boolean;
  /**
   * When scanning actually began, or null when it is not running.
   *
   * Not persisted and not "app start": a paired tag that has not been heard is
   * only meaningful relative to how long we have been listening, and the scan
   * can start late — or restart after the adapter comes back.
   */
  scanStartedAt: number | null;

  pair: (device: DiscoveredDevice) => void;
  /** Queue a printed code; binds when a matching tag is heard. */
  requestPair: (code: string, rodId: string | null) => boolean;
  cancelPending: (code: string) => void;
  /** Pair a tag by typed id, before it has ever been seen. */
  pairById: (rawId: string, name?: string) => PairedDevice;
  unpair: (id: string) => void;
  rename: (id: string, label: string | null) => void;
  markPoweredOff: (id: string) => void;
  /**
   * Record a battery reading. `percent` null with ok=true means the tag answered
   * but does not implement 0x180F — a settled fact worth remembering, so the UI
   * can stop offering a refresh that will never return a number.
   */
  setBattery: (id: string, percent: number | null) => void;
  clearDiscovered: () => void;
}

export const useDeviceStore = create<DeviceState>()(
  persist(
    (set, get) => ({
      paired: {},
      pending: [],
      discovered: {},
      scanning: false,
      scanStartedAt: null,

      pair: (device) =>
        set((s) => {
          // Canonicalised on the way in as well as on the way out of the radio:
          // this is also called from the pairing screen, and a caller that
          // passed a full MAC would recreate the duplicate-tag bug from the
          // other side of the store.
          const id = canonicalDeviceId(device.id);
          // Remove from `discovered` as it moves to `paired`. Leaving it in both
          // made resolvePending see two matches for one physical tag, declare it
          // ambiguous, and skip the request on every tick forever — while the UI
          // claimed "2 tags in range share this code" about a single tag.
          const discovered = { ...s.discovered };
          delete discovered[id];
          return {
          discovered,
          paired: {
            ...s.paired,
            [id]: s.paired[id] ?? {
              id,
              connectionId: device.connectionId,
              name: device.name,
              label: null,
              pairedAt: Date.now(),
              lastSeenAt: device.lastSeenAt,
              rssi: device.rssi,
              battery: device.battery,
              batteryReadAt: null,
              batteryUnsupported: false,
              poweredOffAt: null,
            },
          },
          };
        }),

      requestPair: (code, rodId) => {
        if (!isPlausibleCode(code)) return false;
        const normalised = normaliseCode(code);
        set((s) => ({
          pending: [
            ...s.pending.filter((p) => p.code !== normalised),
            { code: normalised, rodId, requestedAt: Date.now() },
          ],
        }));
        return true;
      },

      cancelPending: (code) =>
        set((s) => ({ pending: s.pending.filter((p) => p.code !== normaliseCode(code)) })),

      pairById: (rawId, name) => {
        const id = canonicalDeviceId(rawId);
        const existing = get().paired[id];
        if (existing) return existing;

        // lastSeenAt stays null: pairing by typed id proves nothing about
        // whether the tag exists, so the rod must read as unpaired-but-silent
        // rather than ready until an advertisement actually arrives.
        const device: PairedDevice = {
          id,
          // No address yet: a typed code proves nothing about where the tag is.
          // GATT commands stay unavailable until it is actually heard.
          connectionId: null,
          name: name ?? `CP27-${id.replace(/[^0-9A-F]/gi, '').slice(-4).toUpperCase()}`,
          label: null,
          pairedAt: Date.now(),
          lastSeenAt: null,
          rssi: null,
          battery: null,
          batteryReadAt: null,
          batteryUnsupported: false,
          poweredOffAt: null,
        };
        // Same reason as `pair`: a tag that is now owned must leave Nearby, or
        // it is offered for pairing while already paired.
        set((s) => {
          const discovered = { ...s.discovered };
          delete discovered[id];
          return { paired: { ...s.paired, [id]: device }, discovered };
        });
        return device;
      },

      unpair: (id) =>
        set((s) => {
          const next = { ...s.paired };
          delete next[id];
          return { paired: next };
        }),

      rename: (id, label) =>
        set((s) => {
          const device = s.paired[id];
          if (!device) return s;
          return { paired: { ...s.paired, [id]: { ...device, label } } };
        }),

      markPoweredOff: (id) =>
        set((s) => {
          const device = s.paired[id];
          if (!device) return s;
          return {
            paired: { ...s.paired, [id]: { ...device, poweredOffAt: Date.now() } },
          };
        }),

      setBattery: (id, percent) =>
        set((s) => {
          const device = s.paired[id];
          if (!device) return s;
          return {
            paired: {
              ...s.paired,
              [id]: {
                ...device,
                battery: percent,
                batteryReadAt: Date.now(),
                batteryUnsupported: percent === null,
              },
            },
          };
        }),

      clearDiscovered: () => set({ discovered: {} }),
    }),
    {
      name: 'castmate:devices',
      storage: createJSONStorage(() => AsyncStorage),
      // Bumped when tag identity became the five-octet MAC tail.
      version: 1,
      /**
       * Re-key tags stored under a full six-octet MAC. Without this an already
       * paired tag no longer matches what the scanner reports, so it silently
       * reappears in Nearby as a stranger and every rod bound to it reads as
       * unpaired.
       */
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as {
          paired?: Record<string, PairedDevice>;
          pending?: PendingPair[];
        };
        if (version >= 1) return state;
        const paired: Record<string, PairedDevice> = {};
        for (const device of Object.values(state.paired ?? {})) {
          const id = canonicalDeviceId(device.id);
          paired[id] = { ...device, id };
        }
        return { ...state, paired };
      },
      // Liveness is deliberately excluded — see the module note.
      partialize: (s) => ({
        // Pending requests persist: typing a code at the car and walking to the
        // rod is the whole point, and the app may be backgrounded in between.
        pending: s.pending,
        paired: Object.fromEntries(
          Object.entries(s.paired).map(([id, d]) => [
            id,
            { ...d, lastSeenAt: null, rssi: null },
          ]),
        ),
      }),
    },
  ),
);

// ---------------------------------------------------------------------------
// Liveness feed
// ---------------------------------------------------------------------------

let unsubscribe: (() => void) | null = null;
let publishTimer: ReturnType<typeof setInterval> | null = null;

/** Buffered between publishes, so a busy scan does not re-render per packet. */
let pendingPaired: Record<
  string,
  { lastSeenAt: number; rssi: number; battery: number | null; connectionId: string }
> = {};
let pendingDiscovered: Record<string, DiscoveredDevice> = {};

/**
 * Watch the shared scan and keep device liveness current.
 *
 * Rides scanBroker rather than starting its own scan — there is exactly one
 * global scan and armed rods depend on it, so device management must never take
 * it over. That also means liveness keeps updating during a session, which is
 * what makes a rod able to notice its tag going quiet.
 */
export function startDeviceWatch(): void {
  if (unsubscribe) {
    // Already subscribed — but the scan underneath may have died, or never
    // started at all. This is called again on every return to foreground and
    // after the tags screen has secured permissions, and both are precisely the
    // moments a failed scan can now succeed. Returning early here is what made a
    // launch-time failure permanent: the subscription exists, so subscribing
    // again is not an option, and nothing else re-arms the radio.
    ensureScanning();
    return;
  }
  const spec = getSensorDevice('castmate-g').broadcast;

  unsubscribe = subscribeToScan((raw) => {
    const adv = raw as BroadcastAdvertisement;
    const reading = spec?.extract(adv) ?? null;
    const name = adv.name ?? adv.localName ?? '';

    // Two ways to recognise one of ours: the frame decodes, or it advertises the
    // CP27 name. The second matters for a tag whose battery is too low to emit a
    // valid frame — it should still be listed rather than vanish.
    const isOurs = reading !== null || name.toUpperCase().startsWith('CP27');
    if (!isOurs) return;

    const id = canonicalDeviceId(reading?.deviceKey ?? adv.id);
    const now = Date.now();
    const rssi = adv.rssi ?? -127;
    const battery = reading?.batteryPct ?? null;
    // Relearned from every advertisement: on iOS the platform handle is not
    // stable across app installs, and on Android a tag can be re-bonded.
    const connectionId = reading?.connectionId ?? adv.id;

    if (useDeviceStore.getState().paired[id]) {
      pendingPaired[id] = { lastSeenAt: now, rssi, battery, connectionId };
    } else {
      pendingDiscovered[id] = { id, connectionId, name: name || id, rssi, lastSeenAt: now, battery };
    }
  });

  publishTimer ??= setInterval(publish, PUBLISH_MS);
  // Whether the radio actually came up is not known yet — startDeviceScan can
  // reject afterwards — so this reads the broker rather than asserting true.
  // publish() keeps it honest from here on.
  syncScanning(scanBrokerState().scanning);
}

function publish(): void {
  // Keep the UI's idea of scanning honest. The flag used to be set optimistically
  // and never corrected, so the tags screen said "Nearby" — implying it was
  // listening — while the scan had rejected and nothing was being heard at all.
  syncScanning(scanBrokerState().scanning);

  const paired = pendingPaired;
  const discovered = pendingDiscovered;
  pendingPaired = {};
  pendingDiscovered = {};
  if (Object.keys(paired).length === 0 && Object.keys(discovered).length === 0) return;

  useDeviceStore.setState((s) => {
    const nextPaired = { ...s.paired };
    for (const [id, seen] of Object.entries(paired)) {
      const device = nextPaired[id];
      if (!device) continue;
      nextPaired[id] = {
        ...device,
        lastSeenAt: seen.lastSeenAt,
        rssi: seen.rssi,
        connectionId: seen.connectionId,
        // Advertisements never carry a battery level on this hardware, so a
        // GATT reading must survive them. When a frame DOES carry one (the Minew
        // layout does), it is accepted but must also restamp batteryReadAt —
        // otherwise a live percentage kept a null timestamp and rendered as
        // "read never" while being greyed out as stale.
        battery: seen.battery ?? device.battery,
        batteryReadAt:
          seen.battery !== null ? seen.lastSeenAt : device.batteryReadAt,
        // Hearing from a tag settles the question: it is not off. Clearing this
        // is what stops "powered off" persisting after the user switches it back
        // on by hand.
        poweredOffAt: null,
      };
    }
    const nextDiscovered = { ...s.discovered, ...discovered };
    // The buffer is filled between publishes, so an advertisement banked before
    // the user paired the tag would put it straight back into Nearby a second
    // later — showing one tag in both lists. Ownership wins.
    for (const id of Object.keys(nextDiscovered)) {
      if (nextPaired[id]) delete nextDiscovered[id];
    }
    return { paired: nextPaired, discovered: nextDiscovered };
  });

  resolvePending();
}

/**
 * Mirror the broker's scanning state, stamping when listening actually began.
 *
 * The timestamp moves only on a false→true transition, so it measures how long
 * we have been listening rather than how long the app has been open — which is
 * what makes "nothing heard yet" distinguishable from "nothing there".
 */
function syncScanning(live: boolean): void {
  if (useDeviceStore.getState().scanning === live) return;
  useDeviceStore.setState({
    scanning: live,
    scanStartedAt: live ? Date.now() : null,
  });
}

/** Rod binder, injected so this store stays free of a dependency on rodStore. */
let bindRodDevice: ((rodId: string, deviceId: string) => void) | null = null;

export function setRodBinder(fn: ((rodId: string, deviceId: string) => void) | null): void {
  bindRodDevice = fn;
}

/**
 * Complete any pending code whose tag has now been heard.
 *
 * A code matching MORE THAN ONE tag in range is left pending rather than
 * resolved: the printed code is only four digits of a MAC, two tags can share
 * one, and binding whichever arrived first would be the wrong tag with nothing
 * to indicate it. The UI shows the candidates and asks.
 */
export function resolvePending(): void {
  const state = useDeviceStore.getState();
  if (state.pending.length === 0) return;

  const seen = uniqueById(state);

  for (const request of state.pending) {
    const matches = seen.filter((d) => codeMatchesDevice(request.code, d.id, d.name));
    if (matches.length !== 1) continue;

    const match = matches[0]!;
    const discovered = useDeviceStore.getState().discovered[match.id];
    if (discovered) useDeviceStore.getState().pair(discovered);
    if (request.rodId) bindRodDevice?.(request.rodId, match.id);
    useDeviceStore.getState().cancelPending(request.code);
  }
}

/** Tags in range matching a pending code — for the ambiguous case. */
export function pendingCandidates(code: string): { id: string; name: string }[] {
  return uniqueById(useDeviceStore.getState()).filter((d) =>
    codeMatchesDevice(code, d.id, d.name),
  );
}

/**
 * Every tag known right now, each appearing ONCE.
 *
 * De-duplicated by id because a tag can legitimately be in both maps for a tick,
 * and counting it twice turns a single tag into a false ambiguity that blocks
 * pairing permanently.
 */
function uniqueById(state: {
  discovered: Record<string, DiscoveredDevice>;
  paired: Record<string, PairedDevice>;
}): { id: string; name: string }[] {
  const byId = new Map<string, { id: string; name: string }>();
  for (const d of Object.values(state.discovered)) byId.set(d.id, { id: d.id, name: d.name });
  for (const d of Object.values(state.paired)) byId.set(d.id, { id: d.id, name: d.name });
  return [...byId.values()];
}

export function stopDeviceWatch(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (publishTimer) {
    clearInterval(publishTimer);
    publishTimer = null;
  }
  syncScanning(false);
}

/** The device bound to a rod, or null. */
export function deviceFor(deviceId: string | null): PairedDevice | null {
  if (!deviceId) return null;
  return useDeviceStore.getState().paired[canonicalDeviceId(deviceId)] ?? null;
}
