import { create } from 'zustand';

import { ensureBlePermissions, waitForPoweredOn } from './bleManager';
import { getSensorDevice, type SensorKind } from './deviceRegistry';
import type { BleDeviceInfo, ConnectionStatus, SensorConnection } from './types';

interface BleState {
  status: ConnectionStatus;
  device: BleDeviceInfo | null;
  error: string | null;
  /** The active connection (mock or real). Not reactive on its own. */
  connection: SensorConnection | null;
  /** Which device implementation to use when connecting. */
  deviceKind: SensorKind;

  setDeviceKind: (kind: SensorKind) => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export const useBleStore = create<BleState>((set, get) => {
  /** Flip status back to connected once samples resume after a reconnect. */
  const watchReconnect = (conn: SensorConnection) => {
    conn.onDisconnect(() => {
      if (get().connection !== conn) return;
      set({ status: 'reconnecting' });
      const off = conn.onSample(() => {
        off();
        if (get().connection === conn) set({ status: 'connected' });
      });
    });
  };

  return {
    status: 'idle',
    device: null,
    error: null,
    connection: null,
    deviceKind: 'mock', // default to the simulator until hardware is selected

    setDeviceKind: (kind) => set({ deviceKind: kind }),

    connect: async () => {
      const { status, deviceKind } = get();
      if (status === 'connecting' || status === 'scanning' || status === 'connected') return;
      set({ error: null, status: 'connecting' });

      const dev = getSensorDevice(deviceKind);
      try {
        if (dev.requiresBle) {
          const granted = await ensureBlePermissions();
          if (!granted) {
            set({ status: 'unauthorized', error: 'Bluetooth permission denied.' });
            return;
          }
          await waitForPoweredOn();
        }

        const conn = dev.create();
        watchReconnect(conn);

        if (dev.initialStatus === 'connected') {
          // Streams immediately (mock): mark connected right away.
          set({ connection: conn, device: conn.info, status: 'connected' });
          conn.start?.();
          return;
        }

        // Broadcast/GATT: show scanning/connecting; the device (MAC/battery) is
        // populated and status flips to connected on the first parsed sample.
        set({ connection: conn, status: dev.initialStatus });
        const off = conn.onSample(() => {
          off();
          if (get().connection === conn) set({ device: conn.info, status: 'connected' });
        });
        conn.start?.();
      } catch (e) {
        set({
          status: 'error',
          error: e instanceof Error ? e.message : 'Failed to connect to sensor.',
        });
      }
    },

    disconnect: async () => {
      const { connection } = get();
      await connection?.disconnect().catch(() => undefined);
      set({ connection: null, device: null, status: 'idle', error: null });
    },
  };
});
