import { create } from 'zustand';

import { ensureBlePermissions, waitForPoweredOn } from './bleManager';
import { E8sSensorClient } from './E8sSensorClient';
import { MockSensor } from './MockSensor';
import type { BleDeviceInfo, ConnectionStatus, SensorConnection } from './types';

interface BleState {
  status: ConnectionStatus;
  device: BleDeviceInfo | null;
  error: string | null;
  /** The active connection (mock or real). Not reactive on its own. */
  connection: SensorConnection | null;
  /** When true, connect() spins up the in-app simulator instead of real BLE. */
  useMock: boolean;

  setUseMock: (value: boolean) => void;
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
    useMock: true, // default on until real hardware is available

    setUseMock: (value) => set({ useMock: value }),

    connect: async () => {
      const { status, useMock } = get();
      if (status === 'connecting' || status === 'connected') return;
      set({ error: null, status: 'connecting' });

      try {
        if (useMock) {
          const mock = new MockSensor();
          watchReconnect(mock);
          set({ connection: mock, device: mock.info, status: 'connected' });
          return;
        }

        const granted = await ensureBlePermissions();
        if (!granted) {
          set({ status: 'unauthorized', error: 'Bluetooth permission denied.' });
          return;
        }
        await waitForPoweredOn();

        // The E8S is a broadcast beacon: begin scanning and lock onto the first
        // tag whose advertisement we parse. There is no "connect" step —
        // status flips to connected on the first sample, and the device (MAC +
        // battery) is populated from that advertisement.
        const client = new E8sSensorClient();
        watchReconnect(client);
        set({ connection: client, status: 'scanning' });
        const off = client.onSample(() => {
          off();
          if (get().connection === client) set({ device: client.info, status: 'connected' });
        });
        client.start();
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
