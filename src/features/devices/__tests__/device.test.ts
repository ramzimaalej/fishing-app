import {
  canBindDevice,
  DEVICE_LIVE_WINDOW_MS,
  deviceLabel,
  deviceShortId,
  deviceStatus,
  isRodActive,
  normaliseDeviceId,
  type PairedDevice,
  rodActivity,
} from '../device';

const NOW = 1_700_000_000_000;

const device = (over: Partial<PairedDevice> = {}): PairedDevice => ({
  id: '87:2D:9D:C0:0C',
  connectionId: '48:87:2D:9D:C0:0C',
  name: 'CP27-C00C',
  label: null,
  pairedAt: NOW - 60_000,
  lastSeenAt: NOW - 1_000,
  rssi: -45,
  battery: null,
  batteryReadAt: null,
  batteryUnsupported: false,
  poweredOffAt: null,
  ...over,
});

describe('deviceStatus', () => {
  it('is live when heard within the window', () => {
    expect(deviceStatus(device({ lastSeenAt: NOW - 1_000 }), NOW)).toBe('live');
    expect(deviceStatus(device({ lastSeenAt: NOW - DEVICE_LIVE_WINDOW_MS }), NOW)).toBe('live');
  });

  it('goes stale once the window lapses', () => {
    expect(deviceStatus(device({ lastSeenAt: NOW - DEVICE_LIVE_WINDOW_MS - 1 }), NOW)).toBe(
      'stale',
    );
  });

  it('tolerates a long run of dropped packets before going stale', () => {
    // Advertising runs to 1500 ms with no retries, so the window must absorb
    // several misses or a rod would flicker in and out of "watched".
    expect(DEVICE_LIVE_WINDOW_MS).toBeGreaterThanOrEqual(10 * 1500);
  });

  it('is never-seen when paired but never heard', () => {
    expect(deviceStatus(device({ lastSeenAt: null }), NOW)).toBe('never-seen');
  });

  it('reports a deliberate power-down rather than a fault', () => {
    // Otherwise the user goes hunting for a problem they created on purpose.
    const off = device({ lastSeenAt: NOW - 60_000, poweredOffAt: NOW - 30_000 });
    expect(deviceStatus(off, NOW)).toBe('powered-off');
  });

  it('treats a tag heard AFTER the power-down as simply stale', () => {
    // It is manifestly not off if it is advertising, whatever we asked it to do.
    const woke = device({ lastSeenAt: NOW - 30_000, poweredOffAt: NOW - 60_000 });
    expect(deviceStatus(woke, NOW)).toBe('stale');
  });

  it('prefers live over powered-off when it is currently advertising', () => {
    const woke = device({ lastSeenAt: NOW - 500, poweredOffAt: NOW - 60_000 });
    expect(deviceStatus(woke, NOW)).toBe('live');
  });

  it('reports powered-off for a tag switched off before it was ever heard', () => {
    expect(deviceStatus(device({ lastSeenAt: null, poweredOffAt: NOW }), NOW)).toBe(
      'powered-off',
    );
  });
});

describe('rodActivity', () => {
  it('is active when the rod is on and its tag is live', () => {
    expect(rodActivity({ enabled: true, device: device() }, NOW)).toBe('active');
    expect(isRodActive({ enabled: true, device: device() }, NOW)).toBe(true);
  });

  it('is unpaired when no tag is bound', () => {
    expect(rodActivity({ enabled: true, device: null }, NOW)).toBe('unpaired');
  });

  it('is device-silent when the tag has gone quiet', () => {
    const quiet = device({ lastSeenAt: NOW - 60_000 });
    expect(rodActivity({ enabled: true, device: quiet }, NOW)).toBe('device-silent');
  });

  it('distinguishes a tag switched off from one that merely went quiet', () => {
    const off = device({ lastSeenAt: NOW - 60_000, poweredOffAt: NOW - 30_000 });
    expect(rodActivity({ enabled: true, device: off }, NOW)).toBe('device-off');
  });

  it("lets the user's own switch override a live tag", () => {
    // A rod that came back to life on its own would arm a sensor the user had
    // deliberately stood down.
    expect(rodActivity({ enabled: false, device: device() }, NOW)).toBe('disabled');
    expect(isRodActive({ enabled: false, device: device() }, NOW)).toBe(false);
  });

  it('reports disabled even with no tag, so the reason is the user not the kit', () => {
    expect(rodActivity({ enabled: false, device: null }, NOW)).toBe('disabled');
  });
});

describe('canBindDevice', () => {
  const rods = [
    { id: 'rod_a', name: 'Left rod', deviceId: '48:87:2D:9D:C0:0C' },
    { id: 'rod_b', name: 'Right rod', deviceId: null },
  ];

  it('allows a device no rod holds', () => {
    expect(canBindDevice('48:87:2D:9D:C0:47', 'rod_b', rods).allowed).toBe(true);
  });

  it('refuses a device already held by another rod, and names it', () => {
    // Two rods on one tag would alarm together and report one sensor as two.
    const verdict = canBindDevice('48:87:2D:9D:C0:0C', 'rod_b', rods);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('bound-elsewhere');
    expect(verdict.boundTo).toBe('Left rod');
  });

  it('reports re-binding the same device to the same rod as a no-op', () => {
    const verdict = canBindDevice('48:87:2D:9D:C0:0C', 'rod_a', rods);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('already-paired');
  });
});

describe('normaliseDeviceId', () => {
  it('canonicalises a MAC however it was typed', () => {
    expect(normaliseDeviceId('4887 2d9d c00c')).toBe('48:87:2D:9D:C0:0C');
    expect(normaliseDeviceId('48-87-2d-9d-c0-0c')).toBe('48:87:2D:9D:C0:0C');
    expect(normaliseDeviceId('48:87:2D:9D:C0:0C')).toBe('48:87:2D:9D:C0:0C');
  });

  it('leaves a non-MAC alone rather than mangling it', () => {
    // iOS device ids are opaque UUIDs, not MACs — silently reformatting one
    // would produce an id that matches nothing.
    expect(normaliseDeviceId('A1B2C3D4-0000-1111-2222-333344445555')).toBe(
      'A1B2C3D4-0000-1111-2222-333344445555',
    );
  });
});

describe('labels', () => {
  it('prefers the user label over the advertised name', () => {
    expect(deviceLabel(device({ label: 'Left tag' }))).toBe('Left tag');
  });

  it('falls back through name to id', () => {
    expect(deviceLabel(device({ label: '   ' }))).toBe('CP27-C00C');
    expect(deviceLabel(device({ label: null, name: '' }))).toBe('87:2D:9D:C0:0C');
  });

  it('shortens an id to what is printed on the tag', () => {
    expect(deviceShortId('48:87:2D:9D:C0:0C')).toBe('C00C');
    // The frame carries only five octets, and the printed code still resolves.
    expect(deviceShortId('87:2D:9D:C0:0C')).toBe('C00C');
  });
});

describe('identity vs connection handle', () => {
  it('keeps them as separate fields', () => {
    // Conflating them broke every GATT command: the CP27 frame carries five of
    // six MAC octets, so the identity is not a connectable address — Android
    // rejects it as a malformed BDADDR and iOS needs its own peripheral UUID.
    const d = device();
    expect(d.id).not.toBe(d.connectionId);
    expect(d.id.replace(/[^0-9A-F]/gi, '')).toHaveLength(10);
    expect(d.connectionId!.replace(/[^0-9A-F]/gi, '')).toHaveLength(12);
  });

  it('allows a paired-by-code tag to have no address yet', () => {
    // Typing a code proves nothing about where the tag is, so commands must stay
    // unavailable until it has actually been heard.
    expect(device({ connectionId: null }).connectionId).toBeNull();
  });
});
