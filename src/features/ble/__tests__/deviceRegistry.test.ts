import {
  getSensorDevice,
  listSensorDevices,
  SENSOR_KINDS,
  type SensorKind,
} from '../deviceRegistry';

describe('sensor device registry', () => {
  it('exposes exactly the four supported device kinds in order', () => {
    expect([...SENSOR_KINDS]).toEqual(['mock', 'minew', 'cp27', 'generic']);
    expect(listSensorDevices().map((d) => d.kind)).toEqual([...SENSOR_KINDS]);
  });

  it('describes every kind with UI + connection metadata', () => {
    for (const d of listSensorDevices()) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.short.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(0);
      expect(typeof d.create).toBe('function');
    }
  });

  it('marks the simulator as instant + hardware-free and hardware kinds as BLE', () => {
    const expected: Record<SensorKind, { requiresBle: boolean; initialStatus: string }> = {
      mock: { requiresBle: false, initialStatus: 'connected' },
      minew: { requiresBle: true, initialStatus: 'scanning' },
      cp27: { requiresBle: true, initialStatus: 'connecting' },
      generic: { requiresBle: true, initialStatus: 'connecting' },
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
});
