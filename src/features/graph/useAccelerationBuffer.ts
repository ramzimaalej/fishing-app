import { useCallback, useRef, useState } from 'react';

import { GRAPH_WINDOW_SIZE } from '@/config/constants';
import type { BiteEvent } from '@/types';

export interface AccelPoint {
  t: number;
  dynamic: number;
  threshold: number;
}

export interface UseAccelerationBufferResult {
  points: AccelPoint[];
  bites: BiteEvent[];
  push: (point: AccelPoint) => void;
  pushBite: (bite: BiteEvent) => void;
  clear: () => void;
}

/**
 * Rolling fixed-size buffer for the live acceleration graph. Writes accumulate
 * in refs (cheap, no re-render per sample); a light coalescing flush publishes
 * the current window to React state so the chart repaints at a sane cadence
 * rather than on every one of the ~50 samples/sec.
 */
export function useAccelerationBuffer(
  maxSize: number = GRAPH_WINDOW_SIZE,
): UseAccelerationBufferResult {
  const pointsRef = useRef<AccelPoint[]>([]);
  const bitesRef = useRef<BiteEvent[]>([]);
  const flushScheduled = useRef(false);

  const [points, setPoints] = useState<AccelPoint[]>([]);
  const [bites, setBites] = useState<BiteEvent[]>([]);

  const scheduleFlush = useCallback(() => {
    if (flushScheduled.current) return;
    flushScheduled.current = true;
    // Coalesce bursts of samples into a single state update next tick.
    setTimeout(() => {
      flushScheduled.current = false;
      setPoints(pointsRef.current.slice());
      setBites(bitesRef.current.slice());
    }, 60);
  }, []);

  const push = useCallback(
    (point: AccelPoint) => {
      const buf = pointsRef.current;
      buf.push(point);
      if (buf.length > maxSize) buf.splice(0, buf.length - maxSize);

      // Drop bite markers that have scrolled out of the visible window.
      const oldestT = buf[0]?.t ?? 0;
      if (bitesRef.current.length && bitesRef.current[0]!.timestamp < oldestT) {
        bitesRef.current = bitesRef.current.filter((b) => b.timestamp >= oldestT);
      }
      scheduleFlush();
    },
    [maxSize, scheduleFlush],
  );

  const pushBite = useCallback(
    (bite: BiteEvent) => {
      bitesRef.current.push(bite);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const clear = useCallback(() => {
    pointsRef.current = [];
    bitesRef.current = [];
    setPoints([]);
    setBites([]);
  }, []);

  return { points, bites, push, pushBite, clear };
}
