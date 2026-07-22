import { useEffect, useRef } from 'react';

import type { AccelSample } from '@/types';

import { useBleStore } from './bleStore';

/**
 * Subscribe to the live accelerometer stream from the active connection.
 * The listener is kept in a ref so re-renders don't churn the subscription.
 */
export function useSensorSamples(listener: (sample: AccelSample) => void): void {
  const connection = useBleStore((s) => s.connection);
  const ref = useRef(listener);
  ref.current = listener;

  useEffect(() => {
    if (!connection) return;
    const off = connection.onSample((s) => ref.current(s));
    return off;
  }, [connection]);
}

export const useBleStatus = () => useBleStore((s) => s.status);
export const useBleDevice = () => useBleStore((s) => s.device);
export const useIsConnected = () => useBleStore((s) => s.status === 'connected');
