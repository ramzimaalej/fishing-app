import {
  CASTMATE_G_SERVICE_UUID_SHORT,
  decodeCastmateGFrame,
  encodeCastmateGFrame,
} from '../castmateGFrame';

/**
 * GOLDEN VECTORS — real 0xFEAB service data captured off tag 48:87:2D:9D:C0:0C
 * with the BLE sniffer, not synthesised.
 *
 * The first four were recorded with the tag AT REST, which is what makes them
 * load-bearing: a decoder with the wrong scale, width, byte order or offset
 * still returns numbers, and only the magnitude gives it away. One gravity is
 * the single piece of ground truth available for an undocumented format.
 */
const AT_REST = [
  '3d03126f000000003f851eb9872d9dc00c000000',
  '3d03126f3c83126f3f851eb9872d9dc00c000000',
  '3d03126f000000003f866666872d9dc00c000000',
  '3d03126f000000003f866666872d9dc00c000000',
];

/** Same tag while being rotated through its axes. */
const IN_MOTION = [
  'bf6978d6bd03126f00000000872d9dc00c000000',
  'be23d70bbc83126fbf866666872d9dc00c000000',
  'bf178d50bf851eb93de56042872d9dc00c000000',
  '3f5d2f1bbf3439593c83126f872d9dc00c000000',
];

const b64 = (hex: string): string => {
  const bytes = hex.match(/../g)!.map((h) => parseInt(h, 16));
  return Buffer.from(bytes).toString('base64');
};

const magnitude = (r: { x: number; y: number; z: number }): number =>
  Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z);

describe('decodeCastmateGFrame', () => {
  it('reads a resting tag as one gravity', () => {
    // THE test. Everything else about the layout could be wrong and still
    // produce plausible-looking numbers; only this pins the scale and byte order.
    for (const hex of AT_REST) {
      const r = decodeCastmateGFrame(b64(hex));
      expect(r).not.toBeNull();
      expect(magnitude(r!)).toBeGreaterThan(0.85);
      expect(magnitude(r!)).toBeLessThan(1.15);
    }
  });

  it('decodes the first captured frame exactly', () => {
    const r = decodeCastmateGFrame(b64(AT_REST[0]!))!;
    expect(r.x).toBeCloseTo(0.032, 3);
    expect(r.y).toBeCloseTo(0, 5);
    expect(r.z).toBeCloseTo(1.04, 3);
    expect(magnitude(r)).toBeCloseTo(1.04, 2);
  });

  it('reads the axes as BIG-endian floats', () => {
    // The vendor app reads them little-endian, which is why it displays ~1e-38.
    // Little-endian on this frame gives 4.5e+28 / -1.5e-4 — nothing like a
    // gravity — so getting this backwards is immediately visible.
    const bytes = Buffer.from(AT_REST[0]!.slice(16, 24), 'hex');
    expect(bytes.readFloatBE(0)).toBeCloseTo(1.04, 3);
    expect(Math.abs(bytes.readFloatLE(0))).toBeLessThan(0.001);
  });

  it('extracts the MAC tail carried in the frame', () => {
    // Identity comes from INSIDE the payload so a rod binding survives an iOS
    // reinstall, where the advertisement id is an opaque per-install UUID.
    expect(decodeCastmateGFrame(b64(AT_REST[0]!))!.macTail).toBe('87:2D:9D:C0:0C');
  });

  it('decodes frames recorded while the tag was moving', () => {
    for (const hex of IN_MOTION) {
      const r = decodeCastmateGFrame(b64(hex));
      expect(r).not.toBeNull();
      // Real linear acceleration, so magnitude departs from 1 g — but stays
      // within the range a hand-held tag can produce.
      expect(magnitude(r!)).toBeGreaterThan(0.1);
      expect(magnitude(r!)).toBeLessThan(4);
    }
  });

  it('reads one axis at a time reaching a full gravity under rotation', () => {
    // Rotating the tag moves gravity between axes; that is the six-orientation
    // signature the layout was worked out from.
    const zDown = decodeCastmateGFrame(b64('be23d70bbc83126fbf866666872d9dc00c000000'))!;
    expect(zDown.z).toBeCloseTo(-1.05, 2);
  });

  it('resolves to 16 mg steps, except at the rail', () => {
    // Across the capture, 29 of 30 distinct magnitudes lie exactly on a 16 mg
    // grid — a coarse quantisation that no amount of filtering can see beneath,
    // and a real limit on how much of a bite waveform is recoverable.
    //
    // The one exception is 1.05 g, which is ALSO the largest value seen on every
    // axis. That reads as a clamp rather than a grid point: the axis rails at
    // ±1.05 g. See the test below.
    for (const hex of [...AT_REST, ...IN_MOTION]) {
      const r = decodeCastmateGFrame(b64(hex))!;
      for (const v of [r.x, r.y, r.z]) {
        const onGrid = Math.abs(v / 0.016 - Math.round(v / 0.016)) < 0.01;
        const atRail = Math.abs(Math.abs(v) - 1.05) < 1e-6;
        expect(onGrid || atRail).toBe(true);
      }
    }
  });

  it('never reports an axis beyond ±1.05 g', () => {
    // CAUTION, and the reason this is asserted rather than assumed: if the axis
    // rails at 1.05 g then a hard strike CLIPS, and neither peak amplitude nor
    // onset rate is trustworthy at the top of the range. Detection leans on
    // angle rather than magnitude, which is largely immune — but the IMPACT
    // path, which does read magnitude, is not.
    //
    // Twenty-one frames is a small sample. Confirm with a hard shake before
    // treating this as a hardware fact.
    for (const hex of [...AT_REST, ...IN_MOTION]) {
      const r = decodeCastmateGFrame(b64(hex))!;
      for (const v of [r.x, r.y, r.z]) {
        expect(Math.abs(v)).toBeLessThanOrEqual(1.05 + 1e-6);
      }
    }
  });

  describe('rejection', () => {
    it('returns null for a payload too short to hold three axes', () => {
      expect(decodeCastmateGFrame(b64('3d03126f00000000'))).toBeNull();
    });

    it('returns null rather than throwing on malformed base64', () => {
      expect(() => decodeCastmateGFrame('!!!not base64!!!')).not.toThrow();
      expect(decodeCastmateGFrame('!!!not base64!!!')).toBeNull();
    });

    it('rejects a payload whose floats are wildly implausible', () => {
      // Any four bytes decode AS a float, so without a sanity bound an
      // unrelated 0xFEAB beacon would be accepted as a reading. This is the
      // little-endian pattern, which yields 4.5e+28.
      expect(decodeCastmateGFrame(b64('6f12033f6f12833c b91e853f'.replace(/ /g, '')))).toBeNull();
    });

    it('rejects NaN and infinity', () => {
      expect(decodeCastmateGFrame(b64('7fc000007fc000007fc00000'))).toBeNull();
      expect(decodeCastmateGFrame(b64('7f8000007f8000007f800000'))).toBeNull();
    });
  });

  it('round-trips through the encoder', () => {
    const original = { x: 0.032, y: -0.064, z: 1.04, macTail: '87:2D:9D:C0:0C' };
    const decoded = decodeCastmateGFrame(encodeCastmateGFrame(original))!;
    expect(decoded.x).toBeCloseTo(original.x, 5);
    expect(decoded.y).toBeCloseTo(original.y, 5);
    expect(decoded.z).toBeCloseTo(original.z, 5);
    expect(decoded.macTail).toBe(original.macTail);
  });

  it('names the service UUID the frame is carried under', () => {
    expect(CASTMATE_G_SERVICE_UUID_SHORT).toBe('feab');
  });
});
