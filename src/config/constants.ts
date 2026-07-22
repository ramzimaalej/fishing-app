import type { AppSettings } from '@/types';

/** Default user settings applied on first launch. */
export const DEFAULT_SETTINGS: AppSettings = {
  liveBaitMode: false,
  sensitivity: 0.5,
  vibrationEnabled: true,
  soundEnabled: true,
  soundKey: 'classic-reel',
  pushEnabled: true,
};

/** Selectable notification sounds. `asset` resolved via require() in the player. */
export const NOTIFICATION_SOUNDS: readonly { key: string; label: string }[] = [
  { key: 'classic-reel', label: 'Classic Reel Click' },
  { key: 'splash', label: 'Splash' },
  { key: 'bell', label: 'Bite Bell' },
  { key: 'sonar', label: 'Sonar Ping' },
];

/** Premium subscription product identifiers (App Store / Play Console). */
export const IAP_PRODUCT_IDS = {
  monthly: 'co.glow.fishon.premium.monthly',
  yearly: 'co.glow.fishon.premium.yearly',
} as const;

/** Firestore collection names. */
export const COLLECTIONS = {
  users: 'users',
  bites: 'bites',
} as const;

/** How many acceleration samples the live graph keeps in its rolling window. */
export const GRAPH_WINDOW_SIZE = 300;

/**
 * Sensor sample rate (Hz) used for filter-window sizing and the mock's cadence.
 *
 * The Minew E8S is a broadcast beacon whose effective rate is its advertising
 * interval (motion-triggered). ~10 Hz assumes the tag is configured to its
 * fastest interval (~100 ms) in Minew BeaconSET+ — the recommended fishing
 * setup. Detection windows are expressed in seconds, so they scale correctly if
 * this changes; but note a coin-cell beacon cannot match a wired 50 Hz IMU, so
 * bite waveforms are coarser than a dedicated sensor would provide.
 */
export const SENSOR_SAMPLE_RATE_HZ = 10;
