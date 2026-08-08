import {
  DEFAULT_SENSOR_KIND,
  getSensorDevice,
  isSensorKind,
  listSensorDevices,
  SENSOR_KINDS,
  type SensorKind,
} from '../deviceRegistry';

describe('sensor device registry', () => {
  it('ships exactly one customer-facing device', () => {
    // The product is one sensor. A selector offering four protocols asked the
    // customer a question only the developer could answer.
    const offered = listSensorDevices();
    expect(offered).toHaveLength(1);
    expect(offered[0]!.kind).toBe('castmate-g');
    expect(offered[0]!.label).toBe('Castmate G CP27');
  });

  it('defaults new rods to the shipping sensor', () => {
    expect(DEFAULT_SENSOR_KIND).toBe('castmate-g');
  });

  it('exposes the simulator only when dev-only kinds are requested', () => {
    expect(listSensorDevices().map((d) => d.kind)).not.toContain('mock');
    expect(listSensorDevices(true).map((d) => d.kind)).toContain('mock');
  });

  it('describes every kind with UI + connection metadata', () => {
    for (const d of listSensorDevices(true)) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.short.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(0);
      expect(typeof d.create).toBe('function');
    }
  });

  it('marks the simulator as instant + hardware-free and the tag as a BLE scan', () => {
    const expected: Record<SensorKind, { requiresBle: boolean; initialStatus: string }> = {
      'castmate-g': { requiresBle: true, initialStatus: 'scanning' },
      mock: { requiresBle: false, initialStatus: 'connected' },
    };
    for (const kind of SENSOR_KINDS) {
      const d = getSensorDevice(kind);
      expect(d.requiresBle).toBe(expected[kind].requiresBle);
      expect(d.initialStatus).toBe(expected[kind].initialStatus);
    }
  });

  it('creates a working SensorConnection for the simulator', async () => {
    const sensor = getSensorDevice('mock').create();
    expect(typeof sensor.onSample).toBe('function');
    expect(typeof sensor.disconnect).toBe('function');
    expect(sensor.info.name).toContain('Simulator');
    await sensor.disconnect(); // clears the mock's interval so no timer leaks
  });

  it('requires a bound device for the real sensor, but not the simulator', () => {
    // Multi-rod depends on this: an unbound broadcast client locks onto the
    // first tag it hears, so two of them would read one physical sensor.
    expect(getSensorDevice('mock').requiresDeviceBinding).toBe(false);
    expect(getSensorDevice('castmate-g').requiresDeviceBinding).toBe(true);
  });

  it('gives concurrent simulator rods distinct identities', async () => {
    const a = getSensorDevice('mock').create({ instanceLabel: 'Left rod' });
    const b = getSensorDevice('mock').create({ instanceLabel: 'Right rod' });
    // Rod status, bite attribution and the device list all key off info.id.
    expect(a.info.id).not.toBe(b.info.id);
    expect(a.info.name).toContain('Left rod');
    expect(b.info.name).toContain('Right rod');
    await a.disconnect();
    await b.disconnect();
  });

  describe('isSensorKind', () => {
    it('accepts the kinds this build defines', () => {
      expect(isSensorKind('castmate-g')).toBe(true);
      expect(isSensorKind('mock')).toBe(true);
    });

    it('rejects the kinds removed when the app collapsed to one device', () => {
      // The predicate rod migration keys off — see migrateRodSensorKind.
      expect(isSensorKind('minew')).toBe(false);
      expect(isSensorKind('cp27')).toBe(false);
      expect(isSensorKind('generic')).toBe(false);
    });

    it('rejects non-strings and nonsense', () => {
      expect(isSensorKind(undefined)).toBe(false);
      expect(isSensorKind(null)).toBe(false);
      expect(isSensorKind(7)).toBe(false);
      expect(isSensorKind('')).toBe(false);
    });
  });

  describe('getSensorDevice', () => {
    it('falls back to the shipping sensor for an unknown persisted kind', () => {
      // `kind` comes off disk, so the type signature is a claim about this
      // build, not a guarantee about stored data. Returning undefined here
      // crashes the Fishing tab on the first property access.
      const dev = getSensorDevice('minew' as SensorKind);
      expect(dev).toBeDefined();
      expect(dev.kind).toBe(DEFAULT_SENSOR_KIND);
    });
  });
});
