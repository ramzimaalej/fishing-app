import type { BroadcastAdvertisement } from '../BroadcastSensorClient';
import {
  CASTMATE_G_KIND,
  CASTMATE_G_SPEC,
  extractCastmateGReading,
} from '../CastmateGSensorClient';
import { getSensorDevice, listSensorDevices, SENSOR_KINDS } from '../deviceRegistry';
import { encodeMinewAccFrame } from '../minew';

/**
 * The extraction seam is a pure function of plain data, so a frame can be fed in
 * without a BLE stack. That is the point of the BroadcastSensorClient refactor:
 * before it, this decode path took a react-native-ble-plx Device and therefore
 * had no tests at all.
 */

const adv = (over: Partial<BroadcastAdvertisement> = {}): BroadcastAdvertisement => ({
  id: 'AA:BB:CC:DD:EE:FF',
  rssi: -55,
  serviceData: null,
  manufacturerData: null,
  ...over,
});

const accFrame = (x: number, y: number, z: number, batteryPct = 88, mac = '57:05:A0:3F:23:AC') =>
  encodeMinewAccFrame({ x, y, z, batteryPct, mac });

describe('extractCastmateGReading', () => {
  it('decodes a frame carried under the 16-bit service UUID', () => {
    const reading = extractCastmateGReading(
      adv({ serviceData: { ffe1: accFrame(0.84, 0.527, -0.008) } }),
    );

    expect(reading).not.toBeNull();
    // Milli-g: the unit the detector works in throughout.
    expect(reading!.xMg).toBeCloseTo(840, -1);
    expect(reading!.yMg).toBeCloseTo(527, -1);
    expect(reading!.zMg).toBeCloseTo(-8, 0);
    expect(reading!.batteryPct).toBe(88);
  });

  it('decodes a frame carried under the full 128-bit UUID expansion', () => {
    const reading = extractCastmateGReading(
      adv({ serviceData: { '0000ffe1-0000-1000-8000-00805f9b34fb': accFrame(0, 0, 1) } }),
    );
    expect(reading!.zMg).toBeCloseTo(1000, -1);
  });

  it('is case-insensitive about the UUID', () => {
    expect(extractCastmateGReading(adv({ serviceData: { FFE1: accFrame(0, 0, 1) } }))).not.toBeNull();
  });

  it('reads a resting tag as approximately 1 g', () => {
    // The property that proves the scale factor. A decoder whose scale is wrong
    // still returns numbers; only the magnitude gives it away.
    const reading = extractCastmateGReading(
      adv({ serviceData: { ffe1: accFrame(0.84, 0.527, -0.008) } }),
    );
    const magnitudeMg = Math.hypot(reading!.xMg, reading!.yMg, reading!.zMg);
    expect(magnitudeMg).toBeGreaterThan(900);
    expect(magnitudeMg).toBeLessThan(1100);
  });

  it('keys the device on the MAC inside the frame, not the advertisement id', () => {
    // Load-bearing: adv.id is an opaque per-install UUID on iOS, so a rod
    // binding keyed on it would break across reinstalls.
    const reading = extractCastmateGReading(
      adv({
        id: 'some-ios-uuid',
        serviceData: { ffe1: accFrame(0, 0, 1, 50, '11:22:33:44:55:66') },
      }),
    );
    expect(reading!.deviceKey).toBe('11:22:33:44:55:66');
  });

  it('ignores service data under an unrelated UUID', () => {
    expect(extractCastmateGReading(adv({ serviceData: { feaa: accFrame(0, 0, 1) } }))).toBeNull();
  });

  it('ignores an advertisement with no payload', () => {
    expect(extractCastmateGReading(adv())).toBeNull();
    expect(extractCastmateGReading(adv({ serviceData: {} }))).toBeNull();
  });

  it('ignores a payload under the right UUID that is not an Acc frame', () => {
    expect(extractCastmateGReading(adv({ serviceData: { ffe1: 'AQIDBAU=' } }))).toBeNull();
  });

  it('returns null rather than throwing on a malformed base64 payload', () => {
    // Advertisements come off the air from whatever is in range, so a corrupt
    // value is an expected input. base64 decoding throws on it.
    expect(() =>
      extractCastmateGReading(adv({ serviceData: { ffe1: '!!!not base64!!!' } })),
    ).not.toThrow();
    expect(extractCastmateGReading(adv({ serviceData: { ffe1: '!!!nope!!!' } }))).toBeNull();
  });

  it('does not yet read manufacturer data', () => {
    // Documents the CURRENT format list, not a permanent guarantee: if a later
    // firmware moves the frame to 0xFF, a decoder is appended and this changes.
    expect(extractCastmateGReading(adv({ manufacturerData: accFrame(0, 0, 1) }))).toBeNull();
  });
});

describe('CASTMATE_G_SPEC', () => {
  it('names a locked tag by the tail of its MAC', () => {
    expect(CASTMATE_G_SPEC.displayName('57:05:A0:3F:23:AC')).toBe('Castmate G 23AC');
  });

  it('has a searching name for before a tag is locked', () => {
    expect(CASTMATE_G_SPEC.searchingName.length).toBeGreaterThan(0);
  });

  it('has a kind matching its registry key', () => {
    expect(CASTMATE_G_SPEC.kind).toBe(CASTMATE_G_KIND);
  });
});

describe('deviceRegistry broadcast specs', () => {
  it('supplies a spec for exactly the discoverable kinds', () => {
    // Pairing drives discovery off `broadcast` and its UI copy off
    // `discoverable`. If they drift, a sensor is either listed but never found,
    // or found but never listed.
    for (const kind of SENSOR_KINDS) {
      const dev = getSensorDevice(kind);
      expect(dev.broadcast !== undefined).toBe(dev.discoverable);
    }
  });

  it('gives every broadcast spec a kind matching its registry entry', () => {
    for (const kind of SENSOR_KINDS) {
      const dev = getSensorDevice(kind);
      if (dev.broadcast) expect(dev.broadcast.kind).toBe(kind);
    }
  });

  it('recognises a real frame through the registry, as pairing does', () => {
    // Pairing reaches the decoder via the registry rather than importing it, so
    // this covers the wiring rather than just the decoder.
    const spec = getSensorDevice(CASTMATE_G_KIND).broadcast;
    expect(spec).toBeDefined();
    expect(spec!.extract(adv({ serviceData: { ffe1: accFrame(0, 0, 1) } }))).not.toBeNull();
  });

  it('offers no dev-only device in the default listing', () => {
    // The guard that keeps the simulator out of the shipping product.
    expect(listSensorDevices().every((d) => !d.devOnly)).toBe(true);
  });
});
