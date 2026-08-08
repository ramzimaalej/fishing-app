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

import { subscribeToScan } from '@/features/ble/scanBroker';
import { getSensorDevice } from '@/features/ble/deviceRegistry';
import type { BroadcastAdvertisement } from '@/features/ble/BroadcastSensorClient';

import { normaliseDeviceId, type PairedDevice } from './device';

/** UI publish cadence — never once per advertisement. */
const PUBLISH_MS = 1000;

/** Tags seen while scanning but not yet paired. */
export interface DiscoveredDevice {
  id: string;
  name: string;
  rssi: number;
  lastSeenAt: number;
  battery: number | null;
}

interface DeviceState {
  /** Paired tags, keyed by id. Persisted. */
  paired: Record<string, PairedDevice>;
  /** Tags seen in the current scan and not paired. Not persisted. */
  discovered: Record<string, DiscoveredDevice>;
  scanning: boolean;

  pair: (device: DiscoveredDevice) => void;
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
      discovered: {},
      scanning: false,

      pair: (device) =>
        set((s) => ({
          paired: {
            ...s.paired,
            [device.id]: s.paired[device.id] ?? {
              id: device.id,
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
        })),

      pairById: (rawId, name) => {
        const id = normaliseDeviceId(rawId);
        const existing = get().paired[id];
        if (existing) return existing;

        // lastSeenAt stays null: pairing by typed id proves nothing about
        // whether the tag exists, so the rod must read as unpaired-but-silent
        // rather than ready until an advertisement actually arrives.
        const device: PairedDevice = {
          id,
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
        set((s) => ({ paired: { ...s.paired, [id]: device } }));
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
      // Liveness is deliberately excluded — see the module note.
      partialize: (s) => ({
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
let pendingPaired: Record<string, { lastSeenAt: number; rssi: number; battery: number | null }> = {};
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
  if (unsubscribe) return;
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

    const id = normaliseDeviceId(reading?.deviceKey ?? adv.id);
    const now = Date.now();
    const rssi = adv.rssi ?? -127;
    const battery = reading?.batteryPct ?? null;

    if (useDeviceStore.getState().paired[id]) {
      pendingPaired[id] = { lastSeenAt: now, rssi, battery };
    } else {
      pendingDiscovered[id] = { id, name: name || id, rssi, lastSeenAt: now, battery };
    }
  });

  publishTimer ??= setInterval(publish, PUBLISH_MS);
  useDeviceStore.setState({ scanning: true });
}

function publish(): void {
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
        // Advertisements never carry a battery level on this hardware, so a
        // GATT reading must survive them. `?? device.battery` alone would be
        // enough today; being explicit stops a future frame with a battery field
        // silently overwriting a fresher connected reading.
        battery: seen.battery ?? device.battery,
        // Hearing from a tag settles the question: it is not off. Clearing this
        // is what stops "powered off" persisting after the user switches it back
        // on by hand.
        poweredOffAt: null,
      };
    }
    return { paired: nextPaired, discovered: { ...s.discovered, ...discovered } };
  });
}

export function stopDeviceWatch(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (publishTimer) {
    clearInterval(publishTimer);
    publishTimer = null;
  }
  useDeviceStore.setState({ scanning: false });
}

/** The device bound to a rod, or null. */
export function deviceFor(deviceId: string | null): PairedDevice | null {
  if (!deviceId) return null;
  return useDeviceStore.getState().paired[normaliseDeviceId(deviceId)] ?? null;
}
