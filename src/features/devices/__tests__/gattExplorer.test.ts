import {
  asciiIfPrintable,
  type CharacteristicInfo,
  hasDeviceInfo,
  shortenUuid,
  writableTargets,
} from '../gattExplorer';

const b64 = (s: string): string => Buffer.from(s, 'binary').toString('base64');
const bytes = (...n: number[]): string => Buffer.from(n).toString('base64');

describe('shortenUuid', () => {
  it('reduces a standard 128-bit UUID to its 16-bit form', () => {
    expect(shortenUuid('0000ffe0-0000-1000-8000-00805f9b34fb')).toBe('ffe0');
    expect(shortenUuid('0000180F-0000-1000-8000-00805F9B34FB')).toBe('180f');
  });

  it('leaves a genuinely custom UUID alone', () => {
    // Truncating a vendor UUID would collapse distinct services into one label.
    const custom = 'd0611e78-bbb4-4591-a5f8-487910ae4366';
    expect(shortenUuid(custom)).toBe(custom);
  });
});

describe('asciiIfPrintable', () => {
  it('decodes a printable string', () => {
    expect(asciiIfPrintable(b64('CP27-C00C'))).toBe('CP27-C00C');
    expect(asciiIfPrintable(b64('dx1234'))).toBe('dx1234');
  });

  it('strips the trailing NUL padding firmware uses on string fields', () => {
    // A RUN of them, not one: a 20-byte fixed-width field holding "CP27-C00C"
    // carries eleven trailing NULs.
    expect(asciiIfPrintable(b64('v1.2.3\0\0'))).toBe('v1.2.3');
    expect(asciiIfPrintable(b64('CP27-C00C' + '\0'.repeat(11)))).toBe('CP27-C00C');
  });

  it('returns null for a field that is nothing but padding', () => {
    expect(asciiIfPrintable(b64('\0\0\0'))).toBeNull();
  });

  it('returns null for binary, rather than a partial decode', () => {
    // A half-decoded value reads as corruption; hex is the honest rendering.
    expect(asciiIfPrintable(bytes(0x3d, 0x03, 0x12, 0x6f))).toBeNull();
    expect(asciiIfPrintable(bytes(0x01, 0x02))).toBeNull();
  });

  it('rejects a control byte in the middle', () => {
    // Written as an escape on purpose: a literal control character in source is
    // invisible and makes the test look wrong to anyone reading it.
    expect(asciiIfPrintable(b64('ab\x01cd'))).toBeNull();
  });

  it('returns null for an empty or undecodable value', () => {
    expect(asciiIfPrintable('')).toBeNull();
    expect(asciiIfPrintable('!!!not base64!!!')).toBeNull();
  });

  it('does not throw on malformed input', () => {
    expect(() => asciiIfPrintable('%%%%')).not.toThrow();
  });
});

describe('hasDeviceInfo', () => {
  const empty = {
    manufacturer: null,
    model: null,
    serial: null,
    hardwareRevision: null,
    firmwareRevision: null,
    softwareRevision: null,
  };

  it('is false when the tag reported nothing', () => {
    expect(hasDeviceInfo(empty)).toBe(false);
  });

  it('is true when any single field came back', () => {
    // Beacons implement whatever subset they like, so one field is enough to
    // be worth showing.
    expect(hasDeviceInfo({ ...empty, firmwareRevision: 'v1.0.4' })).toBe(true);
  });
});

describe('writableTargets', () => {
  const char = (over: Partial<CharacteristicInfo>): CharacteristicInfo => ({
    uuid: '0000ffe2-0000-1000-8000-00805f9b34fb',
    shortUuid: 'ffe2',
    readable: false,
    writable: false,
    notifiable: false,
    hex: null,
    ascii: null,
    error: null,
    ...over,
  });

  it('lists exactly the writable characteristics across all services', () => {
    // This is the target list for an HCI capture: knowing which handles the
    // vendor app can write is most of the work of finding its opcodes.
    const services = [
      {
        uuid: 'a',
        shortUuid: 'ffe0',
        characteristics: [
          char({ shortUuid: 'ffe1', notifiable: true }),
          char({ shortUuid: 'ffe2', writable: true }),
          char({ shortUuid: 'ffe3', writable: true }),
        ],
      },
      {
        uuid: 'b',
        shortUuid: '180f',
        characteristics: [char({ shortUuid: '2a19', readable: true })],
      },
    ];

    expect(writableTargets(services).map((c) => c.shortUuid)).toEqual(['ffe2', 'ffe3']);
  });

  it('is empty when nothing can be written', () => {
    expect(
      writableTargets([
        { uuid: 'a', shortUuid: '180f', characteristics: [char({ readable: true })] },
      ]),
    ).toEqual([]);
  });
});
