import { MAX_RODS } from '@/config/constants';
import type { SensorKind } from '@/features/ble/deviceRegistry';

import {
  activeRods,
  canAddRod,
  defaultRodName,
  isRodArmable,
  normaliseRodName,
  type Rod,
} from '../rod';

function rod(overrides: Partial<Rod> = {}): Rod {
  return {
    id: overrides.id ?? 'r1',
    name: overrides.name ?? 'Rod 1',
    sensorKind: overrides.sensorKind ?? ('mock' as SensorKind),
    deviceId: overrides.deviceId ?? null,
    enabled: overrides.enabled ?? true,
    createdAt: overrides.createdAt ?? 0,
  };
}

const many = (n: number, enabled = true): Rod[] =>
  Array.from({ length: n }, (_, i) => rod({ id: `r${i}`, name: `Rod ${i + 1}`, enabled }));

describe('canAddRod', () => {
  it('allows rods up to the ceiling regardless of subscription', () => {
    // Rod count is deliberately NOT a paid feature — gating it would paywall
    // hardware the customer already bought. See rod.ts.
    for (let n = 0; n < MAX_RODS; n++) {
      expect(canAddRod(n)).toEqual({ allowed: true });
    }
  });

  it('refuses past the practical ceiling', () => {
    expect(canAddRod(MAX_RODS)).toEqual({ allowed: false, reason: 'max-rods' });
    expect(canAddRod(MAX_RODS + 5)).toEqual({ allowed: false, reason: 'max-rods' });
  });

  it('only ever refuses for a reason paying cannot fix', () => {
    // Guards the UI contract: this path must never offer the paywall.
    const verdict = canAddRod(MAX_RODS);
    expect(verdict.reason).toBe('max-rods');
  });
});

describe('activeRods', () => {
  it('arms every enabled rod up to the ceiling', () => {
    expect(activeRods(many(MAX_RODS))).toHaveLength(MAX_RODS);
  });

  it('arms a second rod with no subscription involved', () => {
    expect(activeRods(many(2))).toHaveLength(2);
  });

  it('excludes rods the user switched off', () => {
    const rods = [rod({ id: 'a', enabled: false }), rod({ id: 'b', enabled: true })];
    expect(activeRods(rods).map((r) => r.id)).toEqual(['b']);
  });

  it('caps at the ceiling even if more rods somehow got persisted', () => {
    expect(activeRods(many(MAX_RODS + 3))).toHaveLength(MAX_RODS);
  });

  it('keeps creation order', () => {
    expect(activeRods(many(3)).map((r) => r.id)).toEqual(['r0', 'r1', 'r2']);
  });

  it('never mutates the stored rods', () => {
    const rods = many(MAX_RODS + 2);
    const before = rods.map((r) => r.id);
    activeRods(rods);
    expect(rods.map((r) => r.id)).toEqual(before);
    expect(rods).toHaveLength(MAX_RODS + 2);
  });

  it('handles an empty setup', () => {
    expect(activeRods([])).toEqual([]);
  });

  it('handles every rod being disabled', () => {
    expect(activeRods(many(3, false))).toEqual([]);
  });
});

describe('normaliseRodName', () => {
  it('trims surrounding whitespace', () => {
    expect(normaliseRodName('  Left rod  ', 0)).toBe('Left rod');
  });

  it('falls back for an empty or whitespace-only name', () => {
    expect(normaliseRodName('', 0)).toBe('Rod 1');
    expect(normaliseRodName('   ', 2)).toBe('Rod 3');
  });

  it('matches defaultRodName for the same index', () => {
    for (const i of [0, 1, 5]) {
      expect(normaliseRodName('', i)).toBe(defaultRodName(i));
    }
  });

  it('caps length so a name cannot break the layout', () => {
    expect(normaliseRodName('x'.repeat(200), 0)).toHaveLength(40);
  });
});

describe('isRodArmable', () => {
  it('needs no binding when the sensor generates its own signal', () => {
    expect(isRodArmable(rod({ deviceId: null }), false)).toBe(true);
  });

  it('refuses an unbound rod when the sensor must be bound', () => {
    // This is the guard against two rods locking the same physical tag.
    expect(isRodArmable(rod({ deviceId: null }), true)).toBe(false);
  });

  it('accepts a bound rod', () => {
    expect(isRodArmable(rod({ deviceId: 'AA:BB:CC:DD:EE:FF' }), true)).toBe(true);
  });
});
