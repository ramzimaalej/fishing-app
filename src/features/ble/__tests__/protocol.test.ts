import type { AccelSample } from '@/types';

import {
  ControlCommand,
  encodeAccelPacket,
  encodeControlCommand,
  parseAccelPacket,
} from '../protocol';

describe('BLE accelerometer packet codec', () => {
  it('round-trips samples through base64 within milli-g precision', () => {
    const samples: AccelSample[] = [
      { t: 1_000, x: 0.012, y: -0.5, z: 1.0 },
      { t: 1_020, x: 1.234, y: 0.0, z: -2.001 },
    ];
    const decoded = parseAccelPacket(encodeAccelPacket(samples));
    expect(decoded).toHaveLength(2);
    decoded.forEach((d, i) => {
      const s = samples[i]!;
      expect(d.t).toBe(s.t);
      expect(d.x).toBeCloseTo(s.x, 3);
      expect(d.y).toBeCloseTo(s.y, 3);
      expect(d.z).toBeCloseTo(s.z, 3);
    });
  });

  it('handles an empty packet', () => {
    expect(parseAccelPacket(encodeAccelPacket([]))).toEqual([]);
  });

  it('clamps out-of-range acceleration to int16 bounds', () => {
    const [decoded] = parseAccelPacket(encodeAccelPacket([{ t: 1, x: 999, y: -999, z: 0 }]));
    expect(decoded!.x).toBeCloseTo(32.767, 3);
    expect(decoded!.y).toBeCloseTo(-32.768, 3);
  });

  it('tolerates a truncated packet without throwing', () => {
    const good = encodeAccelPacket([
      { t: 1, x: 0, y: 0, z: 1 },
      { t: 2, x: 0, y: 0, z: 1 },
    ]);
    // Corrupt: claim 2 samples but chop bytes by re-decoding a shortened buffer.
    const bytes = Buffer.from(good, 'base64').subarray(0, 6); // header + partial sample
    const truncated = bytes.toString('base64');
    expect(() => parseAccelPacket(truncated)).not.toThrow();
    expect(parseAccelPacket(truncated).length).toBeLessThanOrEqual(1);
  });

  it('encodes a 2-byte control command', () => {
    const b64 = encodeControlCommand(ControlCommand.SET_SAMPLE_RATE, 50);
    const bytes = Buffer.from(b64, 'base64');
    expect(bytes[0]).toBe(ControlCommand.SET_SAMPLE_RATE);
    expect(bytes[1]).toBe(50);
  });
});
