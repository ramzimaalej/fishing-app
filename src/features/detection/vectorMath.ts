/**
 * Vector helpers for direction-agnostic detection.
 *
 * DIRECTION-AGNOSTICISM IS MANDATORY, and it lives here. A slack-line bite — a
 * fish swimming toward shore, the rod unloading and springing straight — is
 * common and produces the same angular deviation as a loading bite, in the
 * opposite sense. Every comparison in this service is therefore the ANGLE
 * BETWEEN two vectors, which is unsigned by construction.
 *
 * There is deliberately no signed per-axis delta in this module. Anything that
 * means "more bend" would miss half the takes.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function magnitude(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(v: Vec3, k: number): Vec3 {
  return { x: v.x * k, y: v.y * k, z: v.z * k };
}

/** Unit vector, or null for a zero-length vector (which has no direction). */
export function normalise(v: Vec3): Vec3 | null {
  const m = magnitude(v);
  if (!Number.isFinite(m) || m === 0) return null;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

const RAD_TO_DEG = 180 / Math.PI;

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * Angle between two vectors in degrees, always in [0, 180].
 *
 * The dot product is clamped to [-1, 1] before acos: floating-point error on
 * two nearly-parallel unit vectors can produce 1.0000000000000002, and acos of
 * that is NaN — which would then poison every downstream feature silently.
 *
 * Returns 0 when either vector has no direction, so a dropout cannot be read as
 * a large deflection.
 */
export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const ua = normalise(a);
  const ub = normalise(b);
  if (!ua || !ub) return 0;
  return Math.acos(clamp(dot(ua, ub), -1, 1)) * RAD_TO_DEG;
}

/** Mean of a set of vectors; null when empty. */
export function meanVector(vs: readonly Vec3[]): Vec3 | null {
  if (vs.length === 0) return null;
  let acc: Vec3 = { x: 0, y: 0, z: 0 };
  for (const v of vs) acc = add(acc, v);
  return scale(acc, 1 / vs.length);
}

/**
 * Coefficient of variation (σ/μ) of a set of intervals, or null when there are
 * too few to characterise regularity.
 *
 * Fewer than two intervals cannot distinguish periodic from irregular — a single
 * gap is equally consistent with both — so this returns null rather than 0,
 * which would read as "perfectly periodic" and wrongly veto Path B.
 */
export function coefficientOfVariation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return null;
  const variance =
    values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(variance) / mean;
}
