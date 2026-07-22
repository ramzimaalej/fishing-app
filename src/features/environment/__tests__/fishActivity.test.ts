import { getMoonPhase } from '../moonPhase';
import { predictFishActivity, type FishActivityInput } from '../fishActivity';

const moon = getMoonPhase(new Date('2024-01-25T17:54:00Z')); // full
const base: FishActivityInput = { pressure: 1013, windSpeed: 3, moon, hour: 12, tide: null };

describe('predictFishActivity', () => {
  it('always returns a value in [0, 1]', () => {
    const combos: FishActivityInput[] = [];
    for (let hour = 0; hour < 24; hour += 3) {
      for (const windSpeed of [0, 3, 8, 15]) {
        for (const trend of [-1, 0, 1]) {
          combos.push({ ...base, hour, windSpeed, pressureTrendHpaPerHr: trend });
        }
      }
    }
    for (const c of combos) {
      const v = predictFishActivity(c);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('rates dawn higher than midday under identical conditions', () => {
    expect(predictFishActivity({ ...base, hour: 6 })).toBeGreaterThan(
      predictFishActivity({ ...base, hour: 12 }),
    );
  });

  it('rates a falling barometer higher than a rising one', () => {
    expect(predictFishActivity({ ...base, pressureTrendHpaPerHr: -0.6 })).toBeGreaterThan(
      predictFishActivity({ ...base, pressureTrendHpaPerHr: 0.6 }),
    );
  });

  it('penalises a gale versus a light breeze', () => {
    expect(predictFishActivity({ ...base, windSpeed: 15 })).toBeLessThan(
      predictFishActivity({ ...base, windSpeed: 3 }),
    );
  });

  it('rewards moving water over slack low tide', () => {
    const rising = predictFishActivity({
      ...base,
      tide: { time: '', height: 1, state: 'rising' },
    });
    const low = predictFishActivity({ ...base, tide: { time: '', height: 0, state: 'low' } });
    expect(rising).toBeGreaterThan(low);
  });
});
