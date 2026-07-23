import { bytesToBase64 } from '../bytes';
import { decodeGenericAccel, encodeGenericAccel, GENERIC_ACC_LSB_PER_G } from '../generic';

describe('Generic BLE accel codec (3×int16-LE milli-g)', () => {
  it('round-trips signed axes', () => {
    const r = decodeGenericAccel(encodeGenericAccel({ x: -2, y: 0.125, z: 1 }))!;
    expect(r.x).toBeCloseTo(-2, 3);
    expect(r.y).toBeCloseTo(0.125, 3);
    expect(r.z).toBeCloseTo(1, 3);
  });

  it('interprets raw counts as milli-g', () => {
    expect(GENERIC_ACC_LSB_PER_G).toBe(1000);
    // 0x03E8 = 1000 → 1.0 g on X.
    const r = decodeGenericAccel(bytesToBase64(new Uint8Array([0xe8, 0x03, 0x00, 0x00, 0x00, 0x00])))!;
    expect(r.x).toBeCloseTo(1, 3);
    expect(r.y).toBeCloseTo(0, 3);
  });

  it('reads only the leading triplet from a longer payload', () => {
    const bytes = new Uint8Array([0xe8, 0x03, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff]);
    const r = decodeGenericAccel(bytesToBase64(bytes))!;
    expect(r.x).toBeCloseTo(1, 3);
  });

  it('rejects payloads shorter than 6 bytes', () => {
    expect(decodeGenericAccel(bytesToBase64(new Uint8Array([0x00, 0x01])))).toBeNull();
  });
});
