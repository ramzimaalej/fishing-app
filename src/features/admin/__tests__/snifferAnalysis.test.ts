import {
  decodeCandidate,
  emptyProfile,
  hexBytes,
  int16Candidates,
  looksLikeSensor,
  observe,
  varyingOffsets,
} from '../snifferAnalysis';

const frame = (...bytes: number[]): Uint8Array => new Uint8Array(bytes);

describe('observe / varyingOffsets', () => {
  it('reports nothing varying from a single frame', () => {
    const p = observe(emptyProfile(), frame(1, 2, 3));
    expect(p.frames).toBe(1);
    expect(varyingOffsets(p)).toEqual([]);
  });

  it('finds the offsets that changed between frames', () => {
    const p = emptyProfile();
    observe(p, frame(0xa1, 0x03, 0x00, 0x10));
    observe(p, frame(0xa1, 0x03, 0x00, 0x40));
    observe(p, frame(0xa1, 0x03, 0x01, 0x80));

    // Bytes 0-1 are constant identity; 2-3 move.
    expect(varyingOffsets(p)).toEqual([2, 3]);
  });

  it('tracks min and max per offset', () => {
    const p = emptyProfile();
    observe(p, frame(0x10));
    observe(p, frame(0x40));
    observe(p, frame(0x20));
    expect(p.bytes[0]).toMatchObject({ min: 0x10, max: 0x40 });
  });

  it('counts distinct values per offset', () => {
    const p = emptyProfile();
    observe(p, frame(5));
    observe(p, frame(5));
    observe(p, frame(7));
    expect(p.bytes[0]!.distinct).toBe(2);
  });

  it('keeps the most recent frame for display', () => {
    const p = emptyProfile();
    observe(p, frame(1, 1));
    observe(p, frame(9, 9));
    expect(Array.from(p.last)).toEqual([9, 9]);
  });

  it('restarts when the frame length changes, rather than blending two formats', () => {
    const p = emptyProfile();
    observe(p, frame(1, 2, 3));
    observe(p, frame(9, 9, 9));
    expect(p.frames).toBe(2);

    observe(p, frame(1, 2));
    expect(p.frames).toBe(1);
    expect(p.length).toBe(2);
    expect(varyingOffsets(p)).toEqual([]);
  });
});

describe('looksLikeSensor', () => {
  it('is false before enough frames to judge', () => {
    const p = emptyProfile();
    observe(p, frame(0, 0, 0, 0));
    observe(p, frame(1, 2, 3, 4));
    // Varies, but two frames is not evidence of a live stream.
    expect(looksLikeSensor(p)).toBe(false);
  });

  it('is false for a static identity beacon', () => {
    const p = emptyProfile();
    for (let i = 0; i < 10; i += 1) observe(p, frame(0x02, 0x15, 0xaa, 0xbb));
    expect(looksLikeSensor(p)).toBe(false);
  });

  it('is true for a payload with several moving bytes', () => {
    const p = emptyProfile();
    observe(p, frame(0xa1, 0x00, 0x10, 0x00, 0x20));
    observe(p, frame(0xa1, 0x00, 0x40, 0x00, 0x50));
    observe(p, frame(0xa1, 0x00, 0x70, 0x00, 0x80));
    expect(looksLikeSensor(p)).toBe(true);
  });

  it('is false when only one byte moves (a counter, not axes)', () => {
    const p = emptyProfile();
    observe(p, frame(0xa1, 0x01, 0xcc));
    observe(p, frame(0xa1, 0x02, 0xcc));
    observe(p, frame(0xa1, 0x03, 0xcc));
    expect(looksLikeSensor(p)).toBe(false);
  });
});

describe('int16Candidates', () => {
  it('finds an adjacent varying pair', () => {
    const p = emptyProfile();
    observe(p, frame(0xa1, 0x00, 0x10, 0xff));
    observe(p, frame(0xa1, 0x01, 0x40, 0x00));
    expect(int16Candidates(p).map((c) => c.offset)).toEqual([1, 2]);
  });

  it('ignores a varying byte with constant neighbours', () => {
    const p = emptyProfile();
    observe(p, frame(0x00, 0x10, 0x00));
    observe(p, frame(0x00, 0x40, 0x00));
    expect(int16Candidates(p)).toEqual([]);
  });

  it('returns overlapping candidates rather than guessing the boundary', () => {
    // Three consecutive varying bytes: the axis could start at 0 or at 1.
    const p = emptyProfile();
    observe(p, frame(0x01, 0x10, 0x20));
    observe(p, frame(0x02, 0x40, 0x50));
    expect(int16Candidates(p).map((c) => c.offset)).toEqual([0, 1]);
  });

  it('guesses big-endian when the first byte moves least', () => {
    // High byte nearly still, low byte swinging = value near zero, big-endian.
    const p = emptyProfile();
    observe(p, frame(0x00, 0x10));
    observe(p, frame(0x00, 0xf0));
    observe(p, frame(0x01, 0x80));
    expect(int16Candidates(p)[0]!.likelyEndian).toBe('big');
  });

  it('guesses little-endian when the second byte moves least', () => {
    const p = emptyProfile();
    observe(p, frame(0x10, 0x00));
    observe(p, frame(0xf0, 0x00));
    observe(p, frame(0x80, 0x01));
    expect(int16Candidates(p)[0]!.likelyEndian).toBe('little');
  });
});

describe('decodeCandidate', () => {
  it('decodes a positive big-endian int16 at the common scales', () => {
    // 0x00d7 = 215; Minew's 8.8 scale gives 0.840 g (its documented capture).
    const guesses = decodeCandidate(frame(0x00, 0xd7), 0, 'big');
    expect(guesses.find((g) => g.label === 'raw')!.value).toBe(215);
    expect(guesses.find((g) => g.label === '÷256 (8.8)')!.value).toBeCloseTo(0.84, 2);
  });

  it('sign-extends a negative value', () => {
    // 0xfffe = -2
    expect(decodeCandidate(frame(0xff, 0xfe), 0, 'big')[0]!.value).toBe(-2);
  });

  it('respects little-endian byte order', () => {
    expect(decodeCandidate(frame(0xd7, 0x00), 0, 'little')[0]!.value).toBe(215);
  });

  it('reads at a non-zero offset', () => {
    expect(decodeCandidate(frame(0xaa, 0xbb, 0x00, 0xd7), 2, 'big')[0]!.value).toBe(215);
  });

  it('returns nothing when the pair runs past the end of the frame', () => {
    expect(decodeCandidate(frame(0x01), 0, 'big')).toEqual([]);
    expect(decodeCandidate(frame(0x01, 0x02), 1, 'big')).toEqual([]);
  });
});

describe('hexBytes', () => {
  it('zero-pads each byte', () => {
    expect(hexBytes(frame(0x00, 0x0a, 0xff))).toEqual(['00', '0a', 'ff']);
  });
});
