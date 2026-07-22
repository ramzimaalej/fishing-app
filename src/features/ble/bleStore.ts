import { create } from 'zustand';

import { SENSOR_SAMPLE_RATE_HZ } from '@/config/constants';

import { BleSensorClient } from './BleSensorClient';
import { ensureBlePermissions, scanForSensor, waitForPoweredOn } from './bleManager';
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
        set({ status: 'scanning' });
        const found = await scanForSensor();
        set({ status: 'connecting', device: found });
        const client = await BleSensorClient.connect(found.id);
        await client.setSampleRate(SENSOR_SAMPLE_RATE_HZ);
        watchReconnect(client);
        set({ connection: client, device: client.info, status: 'connected' });
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
