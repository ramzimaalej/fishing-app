/**
 * Advertisement payload analysis, for reverse-engineering an unknown sensor.
 *
 * Pure and clock-free so the inference rules can be tested against synthetic
 * frames — which matters more here than usual, because the whole point is to
 * make claims about someone else's undocumented wire format.
 *
 * THE CENTRAL TRICK: a BLE tag emits many advertisements, and only some bytes
 * change between them. Identity frames (Eddystone, iBeacon, a serial number) are
 * constant; a live accelerometer reading is not. So tracking per-offset variance
 * across frames, while the tag is being moved, separates payload from packaging
 * without knowing anything about the vendor's format. Adjacent pairs of varying
 * bytes are then almost always the int16 axes.
 */

export interface ByteStats {
  min: number;
  max: number;
  /** How many distinct values seen at this offset (capped, see DISTINCT_CAP). */
  distinct: number;
}

export interface PayloadProfile {
  /** Byte length of the frames seen. Frames of a different length reset it. */
  length: number;
  frames: number;
  bytes: ByteStats[];
  /** Most recent frame, for display. */
  last: Uint8Array;
}

/**
 * Distinct-value counting stops here. An accelerometer axis saturates this
 * almost immediately, and the cap keeps the per-offset set from growing without
 * bound over a long scan.
 */
const DISTINCT_CAP = 16;

/** Offsets tracked per payload. Long payloads are truncated rather than refused. */
const MAX_TRACKED_BYTES = 64;

export function emptyProfile(): PayloadProfile {
  return { length: 0, frames: 0, bytes: [], last: new Uint8Array() };
}

/** Per-offset distinct value sets, kept beside the profile (not serialised). */
const distinctSets = new WeakMap<PayloadProfile, Set<number>[]>();

/**
 * Fold one frame into a profile, in place.
 *
 * A payload whose LENGTH changes starts the profile over: two different frame
 * types under one service UUID would otherwise be averaged into a single
 * meaningless variance map. Length is the cheapest available discriminator.
 */
export function observe(profile: PayloadProfile, frame: Uint8Array): PayloadProfile {
  const len = Math.min(frame.length, MAX_TRACKED_BYTES);

  if (profile.length !== len) {
    profile.length = len;
    profile.frames = 0;
    profile.bytes = Array.from({ length: len }, () => ({ min: 255, max: 0, distinct: 0 }));
    distinctSets.set(
      profile,
      Array.from({ length: len }, () => new Set<number>()),
    );
  }

  const sets = distinctSets.get(profile);
  profile.frames += 1;
  profile.last = frame;

  for (let i = 0; i < len; i += 1) {
    const v = frame[i] ?? 0;
    const stat = profile.bytes[i]!;
    if (v < stat.min) stat.min = v;
    if (v > stat.max) stat.max = v;
    const set = sets?.[i];
    if (set && set.size < DISTINCT_CAP) {
      set.add(v);
      stat.distinct = set.size;
    }
  }

  return profile;
}

/** Offsets whose value has changed at least once. */
export function varyingOffsets(profile: PayloadProfile): number[] {
  const out: number[] = [];
  profile.bytes.forEach((b, i) => {
    if (b.max > b.min) out.push(i);
  });
  return out;
}

/**
 * Whether this payload plausibly carries live sensor data.
 *
 * Requires several frames before judging: one frame has no variance by
 * definition, and calling every newly-seen beacon a sensor would defeat the
 * filter this feeds.
 */
export function looksLikeSensor(profile: PayloadProfile): boolean {
  return profile.frames >= 3 && varyingOffsets(profile).length >= 2;
}

export interface Int16Candidate {
  /** Offset of the first byte of the pair. */
  offset: number;
  /**
   * Heuristic guess only. A high-byte that varies less than its low-byte
   * suggests big-endian (the magnitude sits in the low byte for small values,
   * near zero g); the reverse suggests little-endian. Confirm against a known
   * resting orientation before trusting it.
   */
  likelyEndian: 'big' | 'little';
}

/**
 * Adjacent varying byte pairs — the candidate int16 axis positions.
 *
 * Returned as overlapping candidates on purpose: with three consecutive varying
 * bytes it is genuinely ambiguous whether the axis starts at the first or the
 * second, and guessing one would hide the alternative.
 */
export function int16Candidates(profile: PayloadProfile): Int16Candidate[] {
  const varying = new Set(varyingOffsets(profile));
  const out: Int16Candidate[] = [];
  for (let i = 0; i + 1 < profile.length; i += 1) {
    if (!varying.has(i) || !varying.has(i + 1)) continue;
    const a = profile.bytes[i]!;
    const b = profile.bytes[i + 1]!;
    const spreadA = a.max - a.min;
    const spreadB = b.max - b.min;
    out.push({ offset: i, likelyEndian: spreadA <= spreadB ? 'big' : 'little' });
  }
  return out;
}

/** Lowercase hex of a frame, space-separated in byte pairs. */
export function hexBytes(frame: Uint8Array): string[] {
  return Array.from(frame, (b) => b.toString(16).padStart(2, '0'));
}

/**
 * Interpret a candidate offset as a signed 16-bit value at several common
 * scales, so the right one can be recognised by eye against a known
 * orientation: an axis pointing at the ground reads ≈ ±1 g.
 */
export interface ScaleGuess {
  label: string;
  value: number;
}

export function decodeCandidate(
  frame: Uint8Array,
  offset: number,
  endian: 'big' | 'little',
): ScaleGuess[] {
  if (offset + 1 >= frame.length) return [];
  const hi = frame[endian === 'big' ? offset : offset + 1] ?? 0;
  const lo = frame[endian === 'big' ? offset + 1 : offset] ?? 0;
  const raw = ((hi << 8) | lo) << 16 >> 16; // sign-extend to int16

  return [
    { label: 'raw', value: raw },
    // The scales actually met in the wild: Minew uses 8.8 fixed-point, most
    // LIS3DH/LIS2DH firmwares report milli-g, and 1024 shows up on 12-bit parts.
    { label: '÷256 (8.8)', value: raw / 256 },
    { label: '÷1000 (mg)', value: raw / 1000 },
    { label: '÷1024', value: raw / 1024 },
  ];
}
