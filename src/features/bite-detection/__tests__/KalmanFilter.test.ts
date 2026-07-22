import { KalmanFilter } from '../filters/KalmanFilter';

describe('KalmanFilter', () => {
  it('seeds to the first measurement (no convergence ramp)', () => {
    const kf = new KalmanFilter();
    expect(kf.filter(5)).toBe(5);
  });

  it('smooths a noisy constant signal toward its mean', () => {
    const kf = new KalmanFilter({ q: 0.001, r: 1 });
    const truth = 10;
    const noisy = [10.8, 9.1, 10.5, 9.4, 10.9, 9.2, 10.6, 9.3];
    let out = kf.filter(truth);
    for (const z of noisy) out = kf.filter(z);
    // Filtered estimate stays far tighter than the raw swings (±0.9).
    expect(Math.abs(out - truth)).toBeLessThan(0.4);
  });

  it('tracks a step change (does not get stuck)', () => {
    const kf = new KalmanFilter({ q: 0.05, r: 0.1 });
    for (let i = 0; i < 20; i++) kf.filter(0);
    for (let i = 0; i < 40; i++) kf.filter(10);
    expect(kf.value).toBeGreaterThan(9);
  });

  it('holds its estimate on non-finite input', () => {
    const kf = new KalmanFilter();
    kf.filter(3);
    expect(kf.filter(NaN)).toBe(3);
    expect(kf.filter(Infinity)).toBe(3);
  });

  it('resets to initial state', () => {
    const kf = new KalmanFilter({ initialValue: 0 });
    kf.filter(100);
    kf.reset();
    expect(kf.value).toBe(0);
  });
});
