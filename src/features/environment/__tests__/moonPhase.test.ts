import { getMoonPhase, moonAgeDays } from '../moonPhase';

describe('getMoonPhase', () => {
  it('identifies a known full moon (2024-01-25) with near-full illumination', () => {
    const m = getMoonPhase(new Date('2024-01-25T17:54:00Z'));
    expect(m.phase).toBe('full');
    expect(m.illuminationFraction).toBeGreaterThan(0.98);
    expect(m.name).toBe('Full Moon');
  });

  it('identifies a known new moon (2024-01-11) with near-zero illumination', () => {
    const m = getMoonPhase(new Date('2024-01-11T11:57:00Z'));
    expect(m.phase).toBe('new');
    expect(m.illuminationFraction).toBeLessThan(0.02);
  });

  it('keeps illuminationFraction within [0, 1] across a full cycle', () => {
    const start = new Date('2024-01-01T00:00:00Z').getTime();
    for (let d = 0; d < 30; d += 0.5) {
      const m = getMoonPhase(new Date(start + d * 86_400_000));
      expect(m.illuminationFraction).toBeGreaterThanOrEqual(0);
      expect(m.illuminationFraction).toBeLessThanOrEqual(1);
    }
  });

  it('reports age in [0, synodic month)', () => {
    const age = moonAgeDays(new Date('2024-06-15T00:00:00Z'));
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThan(29.53058886);
  });
});
