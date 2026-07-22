/** Core domain types shared across features. */

/** A single tri-axial accelerometer reading streamed from the sensor. */
export interface AccelSample {
  /** Epoch milliseconds when the sample was produced by the device. */
  t: number;
  x: number;
  y: number;
  z: number;
}

/** Classification of a detected bite. */
export type BiteSize = 'small' | 'big';

/** A bite event emitted by the detection engine. */
export interface BiteEvent {
  id: string;
  /**
   * DEVICE-clock milliseconds of the triggering sample — relative time suited
   * to graph x-axis and detector deltas, NOT a calendar time (the sensor has no
   * real clock; the wire value is a wrapping uint32). Persistence stamps real
   * wall-clock time instead — see BiteRecord.timestamp.
   */
  timestamp: number;
  size: BiteSize;
  /** Peak filtered acceleration magnitude (g) that triggered the bite. */
  peakMagnitude: number;
  /** Detector confidence in [0, 1]. */
  confidence: number;
}

/**
 * A persisted bite record. NOTE: unlike the runtime BiteEvent, its `timestamp`
 * is wall-clock epoch ms (stamped by biteRepository.add at persistence time).
 */
export interface BiteRecord extends BiteEvent {
  userId: string;
  /** Cloud (Firebase Storage) download URL — premium only. */
  imageUrl?: string | null;
  /** Relative on-device path (free tier); resolved via photoStorage. */
  localImage?: string | null;
  note?: string | null;
  /** Denormalised environmental snapshot at time of bite (optional). */
  conditions?: Partial<EnvironmentSnapshot> | null;
}

/** User-tunable detection & feedback settings (persisted). */
export interface AppSettings {
  /** Live bait mode adapts the detector baseline to constant bait motion. */
  liveBaitMode: boolean;
  /** 0..1 — higher = more sensitive (detects smaller bites). */
  sensitivity: number;
  vibrationEnabled: boolean;
  soundEnabled: boolean;
  /** Key of the selected notification sound (see NOTIFICATION_SOUNDS). */
  soundKey: string;
  pushEnabled: boolean;
}

/** Environmental conditions for a location at a point in time. */
export interface EnvironmentSnapshot {
  time: string; // ISO-8601
  /** hPa */
  pressure: number;
  /** °C */
  temperature: number;
  /** m/s */
  windSpeed: number;
  /** degrees */
  windDirection: number;
  /** metres */
  waveHeight: number;
  /** Tide state at this hour. */
  tide: TidePoint | null;
  moon: MoonPhase;
  /** Predicted fish activity in [0, 1]. */
  fishActivity: number;
}

export interface TidePoint {
  time: string;
  /** metres relative to mean sea level */
  height: number;
  state: 'rising' | 'falling' | 'high' | 'low';
}

export interface MoonPhase {
  /** Illuminated fraction of the disc: 0 = new (dark), 1 = full. */
  illuminationFraction: number;
  phase:
    | 'new'
    | 'waxing-crescent'
    | 'first-quarter'
    | 'waxing-gibbous'
    | 'full'
    | 'waning-gibbous'
    | 'last-quarter'
    | 'waning-crescent';
  name: string;
}

export interface GeoCoords {
  latitude: number;
  longitude: number;
}

/** Authenticated user projection used by the UI. */
export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  photoURL: string | null;
  isPremium: boolean;
}
