/**
 * The slider's value mapping, mirrored here as pure functions.
 *
 * SensitivitySlider builds these inline because it is a small component, but the
 * maths is where the bugs were: an Android-only coordinate error that made the
 * thumb flicker, and binary-float noise that leaked into displayed percentages.
 * Both are cheap to pin down and expensive to rediscover.
 */

const STEP = 0.05;
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const snap = (n: number): number => Number((Math.round(n / STEP) * STEP).toFixed(2));

/** Track-relative x → value, exactly as the component computes it. */
const valueAt = (trackX: number, width: number): number => clamp01(snap(trackX / width));

describe('snap', () => {
  it('lands on clean multiples of the step', () => {
    // Math.round(n / 0.05) * 0.05 alone yields 0.35000000000000003, which then
    // renders as "35.00000000000001%" and breaks equality checks.
    for (const v of [0.35, 0.7, 0.15, 0.45, 0.55, 0.95]) {
      expect(snap(v)).toBe(v);
    }
  });

  it('never produces float noise for any position on the track', () => {
    for (let x = 0; x <= 300; x++) {
      const snapped = snap(x / 300);
      // A clean multiple of 0.05 survives a 2-dp round-trip unchanged.
      expect(Number(snapped.toFixed(2))).toBe(snapped);
      expect(Math.round(snapped * 100) % 5).toBe(0);
    }
  });

  it('rounds to the nearest step, not down', () => {
    expect(snap(0.024)).toBe(0);
    expect(snap(0.026)).toBe(0.05);
    expect(snap(0.074)).toBe(0.05);
  });
});

describe('valueAt', () => {
  const W = 300;

  it('maps the track ends to 0 and 1', () => {
    expect(valueAt(0, W)).toBe(0);
    expect(valueAt(W, W)).toBe(1);
  });

  it('maps the midpoint to 0.5', () => {
    expect(valueAt(W / 2, W)).toBe(0.5);
  });

  it('clamps a drag past either end', () => {
    // gestureState.dx is unbounded, so the finger can travel well off-track.
    expect(valueAt(-500, W)).toBe(0);
    expect(valueAt(W + 500, W)).toBe(1);
  });

  it('yields exactly 21 distinct values across the track', () => {
    // This is what makes de-duplicating emissions worthwhile: a full-width drag
    // crosses at most 21 steps, not the ~60 gesture events per second it fires.
    const seen = new Set<number>();
    for (let x = 0; x <= W; x++) seen.add(valueAt(x, W));
    expect(seen.size).toBe(21);
  });

  it('is monotonic left to right', () => {
    let prev = -1;
    for (let x = 0; x <= W; x++) {
      const v = valueAt(x, W);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('is independent of the width used to compute it', () => {
    // The Android flicker came from dividing by the THUMB's 26px width instead
    // of the track's. Proportional positions must agree across widths.
    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      expect(valueAt(frac * 300, 300)).toBe(valueAt(frac * 120, 120));
    }
  });
});
