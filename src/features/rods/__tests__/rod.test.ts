import { MAX_RODS } from '@/config/constants';
import { ROD_COLOUR_KEYS, type RodColour } from '@/theme';
import type { SensorKind } from '@/features/ble/deviceRegistry';

import {
  activeRods,
  canAddRod,
  defaultRodName,
  isRodArmable,
  migrateRods,
  nextRodColour,
  normaliseRodName,
  normaliseRods,
  normaliseRodSensorKind,
  retireSimulatorRod,
  type Rod,
} from '../rod';

function rod(overrides: Partial<Rod> = {}): Rod {
  return {
    id: overrides.id ?? 'r1',
    name: overrides.name ?? 'Rod 1',
    sensorKind: overrides.sensorKind ?? ('mock' as SensorKind),
    deviceId: overrides.deviceId ?? null,
    enabled: overrides.enabled ?? true,
    colour: overrides.colour ?? 'teal',
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

describe('normaliseRodSensorKind', () => {
  it('leaves a rod on a current kind untouched', () => {
    const current = rod({ sensorKind: 'castmate-g' as SensorKind, deviceId: 'AA:BB:CC:DD:EE:FF' });
    // Identity, not just equality: the migration must not churn every rod on
    // every launch.
    expect(normaliseRodSensorKind(current)).toBe(current);
    expect(normaliseRodSensorKind(rod({ sensorKind: 'mock' as SensorKind }))).toEqual(
      rod({ sensorKind: 'mock' as SensorKind }),
    );
  });

  it('moves a legacy broadcast rod over and KEEPS its binding', () => {
    // A 'minew' rod was bound to the MAC from inside the tag's advertisement,
    // which is exactly what the Castmate G spec keys on — so the binding still
    // resolves to the same physical tag and the user need not re-pair.
    const migrated = normaliseRodSensorKind(
      rod({ sensorKind: 'minew' as SensorKind, deviceId: '57:05:A0:3F:23:AC' }),
    );
    expect(migrated.sensorKind).toBe('castmate-g');
    expect(migrated.deviceId).toBe('57:05:A0:3F:23:AC');
  });

  it('clears the binding of a legacy GATT rod', () => {
    // 'cp27' and 'generic' bound to a platform peripheral id from a GATT
    // connection. Compared against a MAC that never matches, the rod would look
    // like a dead sensor rather than an unpaired one.
    for (const kind of ['cp27', 'generic']) {
      const migrated = normaliseRodSensorKind(
        rod({ sensorKind: kind as SensorKind, deviceId: 'A1B2C3D4-0000-1111-2222-333344445555' }),
      );
      expect(migrated.sensorKind).toBe('castmate-g');
      expect(migrated.deviceId).toBeNull();
    }
  });

  it('preserves everything else about the rod', () => {
    const legacy = rod({
      id: 'r9',
      name: 'Left rod',
      sensorKind: 'minew' as SensorKind,
      deviceId: '11:22:33:44:55:66',
      enabled: false,
      createdAt: 1234,
    });
    expect(normaliseRodSensorKind(legacy)).toEqual({
      ...legacy,
      sensorKind: 'castmate-g',
    });
  });

  it('is idempotent', () => {
    const once = normaliseRodSensorKind(rod({ sensorKind: 'generic' as SensorKind, deviceId: 'x' }));
    expect(normaliseRodSensorKind(once)).toEqual(once);
  });

  it('rescues a rod with a nonsense kind rather than leaving it unarmable', () => {
    const migrated = normaliseRodSensorKind(rod({ sensorKind: 'wat' as SensorKind }));
    expect(migrated.sensorKind).toBe('castmate-g');
  });
});

describe('normaliseRods', () => {
  it('rescues retired kinds across a persisted list, keeping valid ones', () => {
    const normalised = normaliseRods([
      rod({ id: 'a', sensorKind: 'minew' as SensorKind, deviceId: 'AA:BB' }),
      rod({ id: 'b', sensorKind: 'cp27' as SensorKind, deviceId: 'periph-id' }),
      rod({ id: 'c', sensorKind: 'mock' as SensorKind }),
    ]);

    // 'mock' is still a kind this build defines, so the every-launch pass leaves
    // it be — retiring it belongs to the one-time migration.
    expect(normalised.map((r) => r.sensorKind)).toEqual(['castmate-g', 'castmate-g', 'mock']);
    expect(normalised.map((r) => r.deviceId)).toEqual(['AA:BB', null, null]);
  });

  it('handles an empty list', () => {
    expect(normaliseRods([])).toEqual([]);
    expect(migrateRods([])).toEqual([]);
  });
});

describe('normaliseRodSensorKind — simulator handling', () => {
  it('leaves a simulator rod alone', () => {
    // Retiring the simulator is a ONE-TIME migration. If the every-launch
    // normaliser did it too, a developer picking the simulator in admin mode
    // would have the choice reverted on the next cold start.
    const sim = rod({ sensorKind: 'mock' as SensorKind });
    expect(normaliseRodSensorKind(sim)).toBe(sim);
    expect(normaliseRods([sim])[0]!.sensorKind).toBe('mock');
  });
});

describe('retireSimulatorRod', () => {
  it('moves a simulator rod to the shipping sensor', () => {
    // 'mock' was the default for every rod the old build created, so a stored
    // simulator rod means "never configured". Leaving it would strand existing
    // users on invented data with the picker hidden.
    const migrated = retireSimulatorRod(rod({ sensorKind: 'mock' as SensorKind }));
    expect(migrated.sensorKind).toBe('castmate-g');
    expect(migrated.deviceId).toBeNull();
  });

  it('leaves a rod already on the shipping sensor untouched', () => {
    const real = rod({ sensorKind: 'castmate-g' as SensorKind, deviceId: 'AA:BB' });
    expect(retireSimulatorRod(real)).toBe(real);
  });

  it('is idempotent', () => {
    const once = retireSimulatorRod(rod({ sensorKind: 'mock' as SensorKind }));
    expect(retireSimulatorRod(once)).toEqual(once);
  });
});

describe('migrateRods — the full one-time upgrade', () => {
  it('retires simulators and rewrites retired kinds in one pass', () => {
    const migrated = migrateRods([
      rod({ id: 'a', sensorKind: 'mock' as SensorKind }),
      rod({ id: 'b', sensorKind: 'minew' as SensorKind, deviceId: 'AA:BB' }),
      rod({ id: 'c', sensorKind: 'cp27' as SensorKind, deviceId: 'periph' }),
    ]);

    // Nothing is left on a kind a customer cannot see or change.
    expect(migrated.every((r) => r.sensorKind === 'castmate-g')).toBe(true);
    // Only the binding that still resolves to a physical tag survives.
    expect(migrated.map((r) => r.deviceId)).toEqual([null, 'AA:BB', null]);
  });
});

describe('nextRodColour', () => {
  it('gives the first colour to the first rod', () => {
    expect(nextRodColour([])).toBe(ROD_COLOUR_KEYS[0]);
  });

  it('never repeats while unused colours remain', () => {
    const chosen: RodColour[] = [];
    for (let i = 0; i < ROD_COLOUR_KEYS.length; i += 1) {
      chosen.push(nextRodColour(chosen));
    }
    expect(new Set(chosen).size).toBe(ROD_COLOUR_KEYS.length);
  });

  it('picks the least-used colour once the palette is exhausted', () => {
    const all = [...ROD_COLOUR_KEYS];
    // Every colour used once, plus a second of the first: the next rod must not
    // take that one again.
    expect(nextRodColour([...all, all[0]!])).not.toBe(all[0]);
  });

  it('avoids a colour already on screen after a delete and re-add', () => {
    // Index-based round-robin fails here: delete rod 2 of 3, add a new one, and
    // an index scheme hands back a colour still in use.
    const remaining: RodColour[] = [ROD_COLOUR_KEYS[0]!, ROD_COLOUR_KEYS[2]!];
    expect(remaining).not.toContain(nextRodColour(remaining));
  });
});

describe('colour backfill', () => {
  it('gives a stored rod without a colour one', () => {
    const legacy = { ...rod(), colour: undefined as unknown as RodColour };
    expect(ROD_COLOUR_KEYS).toContain(normaliseRodSensorKind(legacy).colour);
  });

  it('leaves an existing colour alone', () => {
    // Identity must be stable: a rod whose colour changed between launches is
    // worse than one that never had a colour.
    const coloured = rod({ colour: ROD_COLOUR_KEYS[2] });
    expect(normaliseRodSensorKind(coloured).colour).toBe(ROD_COLOUR_KEYS[2]);
  });

  it('replaces a colour this build no longer defines', () => {
    const stale = rod({ colour: 'chartreuse' as unknown as RodColour });
    expect(ROD_COLOUR_KEYS).toContain(normaliseRodSensorKind(stale).colour);
  });
});
