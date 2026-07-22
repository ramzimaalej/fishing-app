import { useCallback, useEffect, useRef, useState } from 'react';

import { SENSOR_SAMPLE_RATE_HZ } from '@/config/constants';
import { useBleStore } from '@/features/ble/bleStore';
import { useSensorSamples } from '@/features/ble/useBle';
import { biteRepository } from '@/features/bite-history/biteRepository';
import { getCurrentConditions } from '@/features/environment/useEnvironment';
import { notifyBite } from '@/features/notifications/feedback';
import { useSettings } from '@/features/settings/settingsStore';
import { useAuthStore } from '@/features/auth/authStore';
import type { AccelSample, BiteEvent, EnvironmentSnapshot } from '@/types';

import { BiteDetector } from './BiteDetector';
import { useAccelerationBuffer } from '@/features/graph/useAccelerationBuffer';

const CONDITIONS_REFRESH_MS = 15 * 60 * 1000;

export interface UseBiteDetectionResult {
  points: ReturnType<typeof useAccelerationBuffer>['points'];
  bites: BiteEvent[];
  threshold: number;
  isWarmedUp: boolean;
  sessionCount: number;
  clear: () => void;
}

/**
 * Live bite-detection pipeline for the Fishing screen. Feeds the BLE
 * accelerometer stream through a BiteDetector configured from user settings,
 * buffers it for the graph, and on each detected bite fires feedback
 * (haptics/sound/push), persists the record to Firestore (tagged with cached
 * environmental conditions), and pushes fishing mode down to the device.
 */
export function useBiteDetection(
  options: { onBite?: (bite: BiteEvent) => void } = {},
): UseBiteDetectionResult {
  const settings = useSettings();
  const connection = useBleStore((s) => s.connection);
  const uid = useAuthStore((s) => s.user?.uid ?? null);
  const buffer = useAccelerationBuffer();

  const detectorRef = useRef<BiteDetector | null>(null);
  if (detectorRef.current === null) {
    detectorRef.current = new BiteDetector({
      sampleRateHz: SENSOR_SAMPLE_RATE_HZ,
      sensitivity: settings.sensitivity,
      liveBaitMode: settings.liveBaitMode,
    });
  }

  const [sessionCount, setSessionCount] = useState(0);
  const [threshold, setThreshold] = useState(() => detectorRef.current!.threshold);

  // Latest values kept in refs so the hot sample callback never needs new deps.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const uidRef = useRef(uid);
  uidRef.current = uid;
  const onBiteRef = useRef(options.onBite);
  onBiteRef.current = options.onBite;
  const conditionsRef = useRef<EnvironmentSnapshot | null>(null);

  // Retune the detector when sensitivity / live-bait settings change.
  useEffect(() => {
    detectorRef.current?.setConfig({
      sensitivity: settings.sensitivity,
      liveBaitMode: settings.liveBaitMode,
    });
  }, [settings.sensitivity, settings.liveBaitMode]);

  // Mirror live-bait mode to the physical device (best-effort).
  useEffect(() => {
    connection?.setFishingMode(settings.liveBaitMode).catch(() => undefined);
  }, [connection, settings.liveBaitMode]);

  // Cache environmental conditions so we don't hit the network per bite.
  useEffect(() => {
    let active = true;
    const load = async () => {
      const c = await getCurrentConditions();
      if (active && c) conditionsRef.current = c;
    };
    void load();
    const id = setInterval(load, CONDITIONS_REFRESH_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const handleSample = useCallback(
    (sample: AccelSample) => {
      const det = detectorRef.current!;
      const tick = det.process(sample);
      buffer.push({ t: tick.sample.t, dynamic: tick.dynamic, threshold: tick.threshold });

      const bite = tick.bite;
      if (!bite) return;

      buffer.pushBite(bite);
      setSessionCount((c) => c + 1);
      void notifyBite(bite, settingsRef.current);

      const currentUid = uidRef.current;
      if (currentUid) {
        void biteRepository
          .add(currentUid, bite, conditionsRef.current ?? undefined)
          .catch(() => undefined);
      }
      onBiteRef.current?.(bite);
    },
    [buffer],
  );

  useSensorSamples(handleSample);

  // Refresh the displayed threshold a few times a second (not per sample).
  useEffect(() => {
    const id = setInterval(() => setThreshold(detectorRef.current!.threshold), 400);
    return () => clearInterval(id);
  }, []);

  const clear = useCallback(() => {
    detectorRef.current?.reset();
    buffer.clear();
    setSessionCount(0);
  }, [buffer]);

  return {
    points: buffer.points,
    bites: buffer.bites,
    threshold,
    isWarmedUp: detectorRef.current.isWarmedUp,
    sessionCount,
    clear,
  };
}
