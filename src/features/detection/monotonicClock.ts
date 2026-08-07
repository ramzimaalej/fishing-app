/**
 * Monotonic time source for packet arrival stamps.
 *
 * WHY NOT Date.now(). Every quantity the detector reasons about is a rate or a
 * duration: Δθ/Δt, an EMA over elapsed time, a 2.5 s dwell, a 5 s loss timeout,
 * and the 150 ms guard the fish/wave discriminator rests on. Wall time is not
 * monotonic — NTP correction, a timezone change, the user setting the clock, or
 * a leap adjustment can move it backwards or forwards mid-session.
 *
 * A backwards step produces a NEGATIVE Δt, which silently poisons the slope
 * calculation and can make a gap look instantaneous. A forwards jump breaks a
 * dwell that was about to fire. Neither is hypothetical over a session that runs
 * for hours on a phone that is also doing other things.
 *
 * `performance.now()` is monotonic and available in Hermes. The fallback exists
 * because this module must never throw in a BLE callback; it anchors to a single
 * Date.now() reading taken once at load, which keeps deltas well-behaved even if
 * the wall clock is later adjusted.
 */

const hasPerformanceNow =
  typeof globalThis.performance?.now === 'function';

/** Anchor for the fallback path, read exactly once. */
const fallbackEpoch = Date.now();

/**
 * Milliseconds from an arbitrary fixed origin. Only differences are meaningful —
 * never compare this to a wall-clock timestamp or persist it as a date.
 */
export function monotonicNowMs(): number {
  if (hasPerformanceNow) return globalThis.performance.now();
  return Date.now() - fallbackEpoch;
}

/** True when a real monotonic source is in use, for the debug screen. */
export function hasMonotonicClock(): boolean {
  return hasPerformanceNow;
}
