import { MovingAverageFilter } from '../filters/MovingAverageFilter';

describe('MovingAverageFilter', () => {
  it('rejects invalid window sizes', () => {
    expect(() => new MovingAverageFilter(0)).toThrow();
    expect(() => new MovingAverageFilter(1.5)).toThrow();
  });

  it('averages within a partial window', () => {
    const ma = new MovingAverageFilter(4);
    expect(ma.push(2)).toBe(2);
    expect(ma.push(4)).toBe(3);
    expect(ma.samples).toBe(2);
    expect(ma.isFull).toBe(false);
  });

  it('slides the window once full', () => {
    const ma = new MovingAverageFilter(3);
    ma.push(1);
    ma.push(2);
    ma.push(3); // mean 2
    expect(ma.mean).toBeCloseTo(2);
    ma.push(4); // window now [2,3,4] → mean 3
    expect(ma.mean).toBeCloseTo(3);
    expect(ma.isFull).toBe(true);
  });

  it('computes variance and std of the window', () => {
    const ma = new MovingAverageFilter(4);
    [2, 4, 4, 6].forEach((v) => ma.push(v)); // mean 4, popvar 2
    expect(ma.mean).toBeCloseTo(4);
    expect(ma.variance).toBeCloseTo(2, 5);
    expect(ma.std).toBeCloseTo(Math.sqrt(2), 5);
  });

  it('keeps variance non-negative under floating point drift', () => {
    const ma = new MovingAverageFilter(5);
    for (let i = 0; i < 1000; i++) ma.push(1_000_000);
    expect(ma.variance).toBeGreaterThanOrEqual(0);
    expect(ma.std).toBeGreaterThanOrEqual(0);
  });

  it('ignores non-finite input', () => {
    const ma = new MovingAverageFilter(3);
    ma.push(2);
    expect(ma.push(NaN)).toBe(2);
    expect(ma.samples).toBe(1);
  });
});
