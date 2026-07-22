import {
  decodeMinewAccFrame,
  encodeMinewAccFrame,
  MINEW_ACC_FRAME,
  readingToSample,
  type MinewAccReading,
} from '../minew';

/** Base64 of a hex string. */
function b64(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
}

describe('Minew E8S Acc frame codec', () => {
  // Real capture from Minew/reelyActive documentation.
  const CAPTURE = 'a1 03 64 00d7 0087 fffe 5705a03f23ac';

  it('decodes the documented reference frame correctly', () => {
    const r = decodeMinewAccFrame(b64(CAPTURE))!;
    expect(r).not.toBeNull();
    expect(r.batteryPct).toBe(100);
    expect(r.x).toBeCloseTo(0.84, 2); // 0x00D7 / 256
    expect(r.y).toBeCloseTo(0.527, 2); // 0x0087 / 256
    expect(r.z).toBeCloseTo(-0.0078, 3); // 0xFFFE (=-2) / 256
    expect(r.mac).toBe('57:05:A0:3F:23:AC');
  });

  it('reads ~1 g total magnitude at rest (sanity)', () => {
    const r = decodeMinewAccFrame(b64(CAPTURE))!;
    const mag = Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z);
    expect(mag).toBeCloseTo(1, 1);
  });

  it('rejects non-Acc frames and short buffers', () => {
    expect(decodeMinewAccFrame(b64('03 00 64 0000'))).toBeNull(); // wrong frame type
    expect(decodeMinewAccFrame(b64('a1 03'))).toBeNull(); // truncated
    expect(MINEW_ACC_FRAME).toBe(0xa1);
  });

  it('round-trips through encode/decode with signed axes', () => {
    const reading: MinewAccReading = {
      x: -1.5,
      y: 0.25,
      z: 0.98,
      batteryPct: 73,
      mac: 'AA:BB:CC:11:22:33',
    };
    const r = decodeMinewAccFrame(encodeMinewAccFrame(reading))!;
    expect(r.x).toBeCloseTo(-1.5, 2);
    expect(r.y).toBeCloseTo(0.25, 2);
    expect(r.z).toBeCloseTo(0.98, 2);
    expect(r.batteryPct).toBe(73);
    expect(r.mac).toBe('AA:BB:CC:11:22:33');
  });

  it('clamps out-of-range acceleration to the int16 8.8 domain', () => {
    // ±128 g exceeds 8.8 fixed point; encoding must not wrap/overflow.
    const r = decodeMinewAccFrame(
      encodeMinewAccFrame({ x: 999, y: -999, z: 0, batteryPct: 50, mac: '00:00:00:00:00:00' }),
    )!;
    expect(r.x).toBeLessThanOrEqual(128);
    expect(r.x).toBeGreaterThan(0);
    expect(r.y).toBeGreaterThanOrEqual(-128);
    expect(r.y).toBeLessThan(0);
  });

  it('stamps arrival time when building a sample', () => {
    const r = decodeMinewAccFrame(b64(CAPTURE))!;
    const s = readingToSample(r, 1_700_000_000_000);
    expect(s.t).toBe(1_700_000_000_000);
    expect(s.x).toBeCloseTo(0.84, 2);
  });
});
