/**
 * Read-only GATT explorer — how to find out what a tag can be configured to do
 * WITHOUT writing anything to it.
 *
 * The DX-SMART app can change advertising interval, transmit power, the seven
 * frame slots, the device name and the password. All of that goes through the
 * "NO"+opcode channel on 0xFFE2, and no opcode was ever captured — so the app
 * cannot write those settings without guessing, and guessing on that channel can
 * change the password or stop the tag advertising, with no factory reset outside
 * the vendor app.
 *
 * What IS safe is looking. Enumerating services and characteristics, reading
 * their capability flags, and reading the ones marked readable cannot alter a
 * device. That is genuinely useful in three ways:
 *
 *   1. It reports what the tag actually implements (does it have 0x180F for
 *      battery? a Device Information Service? a writable name?).
 *   2. It shows which characteristics are WRITABLE, which is the map of what is
 *      configurable at all — the target list for an HCI capture session.
 *   3. Firmware revision matters here specifically: this app already decodes two
 *      different frame layouts, so knowing which firmware a tag runs is how a
 *      future format change gets attributed rather than mistaken for a fault.
 *
 * Everything here is a read. Nothing in this module writes to a device.
 */
import type { Device } from 'react-native-ble-plx';

const uuid16 = (short: string): string => `0000${short}-0000-1000-8000-00805f9b34fb`;

/** Standard Device Information Service and the fields worth showing. */
export const DEVICE_INFO_SERVICE_UUID = uuid16('180a');

export const DEVICE_INFO_CHARS: { uuid: string; label: string }[] = [
  { uuid: uuid16('2a29'), label: 'Manufacturer' },
  { uuid: uuid16('2a24'), label: 'Model' },
  { uuid: uuid16('2a25'), label: 'Serial' },
  { uuid: uuid16('2a27'), label: 'Hardware rev' },
  { uuid: uuid16('2a26'), label: 'Firmware rev' },
  { uuid: uuid16('2a28'), label: 'Software rev' },
];

/** Standard GAP name, which some firmware exposes as writable. */
export const GAP_SERVICE_UUID = uuid16('1800');
export const GAP_DEVICE_NAME_CHAR_UUID = uuid16('2a00');

export interface CharacteristicInfo {
  uuid: string;
  /** Short 16-bit form when this is a standard UUID, else the full one. */
  shortUuid: string;
  readable: boolean;
  writable: boolean;
  notifiable: boolean;
  /** Value as hex, when readable and successfully read. */
  hex: string | null;
  /** Value as ASCII when it looks like text — many config fields are strings. */
  ascii: string | null;
  /** Why a read failed, when it did. */
  error: string | null;
}

export interface ServiceInfo {
  uuid: string;
  shortUuid: string;
  characteristics: CharacteristicInfo[];
}

/** 0000ffe0-0000-1000-8000-00805f9b34fb → ffe0. Leaves custom UUIDs alone. */
export function shortenUuid(uuid: string): string {
  const lower = uuid.toLowerCase();
  const m = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/.exec(lower);
  return m ? m[1]! : lower;
}

function base64ToHex(value: string): string | null {
  try {
    const raw = globalThis.atob ? globalThis.atob(value) : '';
    let out = '';
    for (let i = 0; i < raw.length; i += 1) {
      out += raw.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Printable ASCII, or null.
 *
 * Config fields on these beacons are frequently ASCII (the password is, and the
 * command prefix is), so showing text where text exists is what makes a dump
 * readable rather than a wall of hex. Anything with a control byte or a
 * non-ASCII byte is left as hex, because a partial decode reads as corruption.
 */
export function asciiIfPrintable(value: string): string | null {
  let raw: string;
  try {
    raw = globalThis.atob ? globalThis.atob(value) : '';
  } catch {
    return null;
  }
  if (raw.length === 0) return null;

  // Firmware pads fixed-width string fields with a RUN of NULs, not one — a
  // 20-byte name field holding "CP27-C00C" carries eleven of them. Trim the run
  // first, then require everything remaining to be printable.
  const trimmed = raw.replace(/\0+$/, '');
  if (trimmed.length === 0) return null;

  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return null;
  }
  return trimmed;
}

/**
 * Enumerate everything the tag exposes.
 *
 * Readable characteristics are READ; nothing else is touched. A read that fails
 * is recorded against that characteristic rather than aborting the dump — a
 * permission-protected field is exactly the kind of thing worth seeing in the
 * list, and losing the whole enumeration to one of them would be perverse.
 *
 * @param device an already-connected device with services discovered.
 */
export async function exploreDevice(device: Device): Promise<ServiceInfo[]> {
  const services = await device.services();
  const out: ServiceInfo[] = [];

  for (const service of services) {
    const characteristics = await service.characteristics().catch(() => []);
    const infos: CharacteristicInfo[] = [];

    for (const c of characteristics) {
      const info: CharacteristicInfo = {
        uuid: c.uuid,
        shortUuid: shortenUuid(c.uuid),
        readable: c.isReadable,
        writable: c.isWritableWithResponse || c.isWritableWithoutResponse,
        notifiable: c.isNotifiable || c.isIndicatable,
        hex: null,
        ascii: null,
        error: null,
      };

      if (c.isReadable) {
        try {
          const read = await c.read();
          if (read.value) {
            info.hex = base64ToHex(read.value);
            info.ascii = asciiIfPrintable(read.value);
          }
        } catch (e) {
          info.error = e instanceof Error ? e.message : 'read failed';
        }
      }

      infos.push(info);
    }

    out.push({
      uuid: service.uuid,
      shortUuid: shortenUuid(service.uuid),
      characteristics: infos,
    });
  }

  return out;
}

export interface DeviceInfo {
  manufacturer: string | null;
  model: string | null;
  serial: string | null;
  hardwareRevision: string | null;
  firmwareRevision: string | null;
  softwareRevision: string | null;
}

const EMPTY_INFO: DeviceInfo = {
  manufacturer: null,
  model: null,
  serial: null,
  hardwareRevision: null,
  firmwareRevision: null,
  softwareRevision: null,
};

/**
 * Read the standard Device Information Service.
 *
 * Every field is optional — beacons implement whatever subset they feel like —
 * so a missing one is null rather than an error, and a tag with no 0x180F at all
 * returns all-null instead of throwing.
 */
export async function readDeviceInfo(device: Device): Promise<DeviceInfo> {
  const info: DeviceInfo = { ...EMPTY_INFO };
  const keys: (keyof DeviceInfo)[] = [
    'manufacturer',
    'model',
    'serial',
    'hardwareRevision',
    'firmwareRevision',
    'softwareRevision',
  ];

  for (let i = 0; i < DEVICE_INFO_CHARS.length; i += 1) {
    const spec = DEVICE_INFO_CHARS[i]!;
    try {
      const c = await device.readCharacteristicForService(
        DEVICE_INFO_SERVICE_UUID,
        spec.uuid,
      );
      if (c.value) info[keys[i]!] = asciiIfPrintable(c.value) ?? base64ToHex(c.value);
    } catch {
      /* not implemented by this tag — a normal outcome, not an error */
    }
  }
  return info;
}

/** True when the tag reported anything at all about itself. */
export function hasDeviceInfo(info: DeviceInfo): boolean {
  return Object.values(info).some((v) => v !== null);
}

/**
 * Characteristics that can be written — the map of what is configurable.
 *
 * This is the target list for an HCI capture: rather than snooping the whole
 * vendor app, watch these handles specifically and you will see the config
 * writes. Knowing WHERE to look is most of the work.
 */
export function writableTargets(services: readonly ServiceInfo[]): CharacteristicInfo[] {
  return services.flatMap((s) => s.characteristics.filter((c) => c.writable));
}
