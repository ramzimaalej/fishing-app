import { bytesToBase64 } from '../bytes';
import {
  CP27_ACC_LSB_PER_G,
  CP27_CMD_PREFIX,
  CP27_DEFAULT_PASSWORD,
  CP27_NOTIFY_CHAR_UUID,
  CP27_SERVICE_UUID,
  decodeCp27AccFrame,
  encodeCp27AccFrame,
} from '../cp27';

describe('CP27 ACC frame codec (provisional layout)', () => {
  it('round-trips signed little-endian X/Y/Z', () => {
    const r = decodeCp27AccFrame(encodeCp27AccFrame({ x: -1.25, y: 0.5, z: 0.98 }))!;
    expect(r).not.toBeNull();
    expect(r.x).toBeCloseTo(-1.25, 3);
    expect(r.y).toBeCloseTo(0.5, 3);
    expect(r.z).toBeCloseTo(0.98, 3);
  });

  it('decodes with the documented little-endian milli-g scale', () => {
    // 1000 mg on X (0x03E8 LE), 0 on Y, -1000 mg on Z (0xFC18 LE).
    const bytes = new Uint8Array([0xe8, 0x03, 0x00, 0x00, 0x18, 0xfc]);
    const r = decodeCp27AccFrame(bytesToBase64(bytes))!;
    expect(CP27_ACC_LSB_PER_G).toBe(1000);
    expect(r.x).toBeCloseTo(1, 3);
    expect(r.y).toBeCloseTo(0, 3);
    expect(r.z).toBeCloseTo(-1, 3);
  });

  it('rejects payloads too short for an X/Y/Z triplet', () => {
    expect(decodeCp27AccFrame(bytesToBase64(new Uint8Array([0x00, 0x01, 0x02])))).toBeNull();
    expect(decodeCp27AccFrame(bytesToBase64(new Uint8Array([])))).toBeNull();
  });

  it('exposes the reverse-engineered GATT protocol constants', () => {
    expect(CP27_DEFAULT_PASSWORD).toBe('dx1234');
    expect(CP27_CMD_PREFIX).toBe('NO');
    expect(CP27_SERVICE_UUID).toBe('0000ffe0-0000-1000-8000-00805f9b34fb');
    expect(CP27_NOTIFY_CHAR_UUID).toBe('0000ffe1-0000-1000-8000-00805f9b34fb');
  });
});
