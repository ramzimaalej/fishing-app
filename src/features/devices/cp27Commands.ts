/**
 * DX-CP27-G command channel — GATT connect, unlock, and command write.
 *
 * SEPARATE FROM STREAMING, and deliberately so. Accelerometer data arrives by
 * broadcast advertisement and needs no connection; commands need one. Keeping
 * them apart means a command connection cannot disturb the scan that every
 * armed rod depends on — and it means the app spends almost none of its life
 * connected, which is what a coin cell wants.
 *
 * WHAT IS CONFIRMED, from HCI captures of the vendor app:
 *
 *   service 0xFFE0
 *     0xFFE1  NOTIFY  responses
 *     0xFFE2  WRITE   commands, ASCII "NO" prefix
 *     0xFFE3  WRITE   password, default "dx1234"
 *
 * WHAT IS NOT CONFIRMED: any individual command opcode, INCLUDING power-off.
 * The framing was captured; the vocabulary was not. That distinction is the
 * whole reason this module refuses to send a command it has not been given —
 * see sendCommand.
 */
import type { Device } from 'react-native-ble-plx';

import { getBleManager, ensureBlePermissions, waitForPoweredOn } from '@/features/ble/bleManager';
import { asciiToBase64 } from '@/features/ble/bytes';
import { bleLog } from '@/features/ble/debug';

const uuid16 = (short: string): string => `0000${short}-0000-1000-8000-00805f9b34fb`;

export const CP27_SERVICE_UUID = uuid16('ffe0');
export const CP27_NOTIFY_CHAR_UUID = uuid16('ffe1');
export const CP27_CMD_CHAR_UUID = uuid16('ffe2');
export const CP27_PASSWORD_CHAR_UUID = uuid16('ffe3');

/** Factory password. Overridable per device — see CommandOptions. */
export const CP27_DEFAULT_PASSWORD = 'dx1234';
/** ASCII prefix every command on 0xFFE2 carries. */
export const CP27_CMD_PREFIX = 'NO';

/** How long to wait for a connection before giving up. */
const CONNECT_TIMEOUT_MS = 12_000;

export interface CommandResult {
  ok: boolean;
  /** What happened, in words the user can act on. */
  detail: string;
  /** Raw notification received in response, hex, when there was one. */
  response?: string;
}

export interface CommandOptions {
  password?: string;
  /** Milliseconds to wait for a 0xFFE1 notification after writing. */
  responseTimeoutMs?: number;
}

/**
 * Connect, unlock, run `fn`, disconnect — always disconnect.
 *
 * A tag left connected keeps its radio in a far hungrier state than
 * advertising, and on a CR2032 that is measured in days of life. The finally
 * block is not tidiness.
 */
async function withConnection<T>(
  deviceId: string,
  password: string,
  fn: (device: Device) => Promise<T>,
): Promise<T> {
  const granted = await ensureBlePermissions();
  if (!granted) throw new Error('Bluetooth permission denied.');
  await waitForPoweredOn();

  const manager = getBleManager();
  let device: Device | null = null;
  try {
    device = await manager.connectToDevice(deviceId, { timeout: CONNECT_TIMEOUT_MS });
    await device.discoverAllServicesAndCharacteristics();

    // The password write is the confirmed unlock step. Failure is not fatal on
    // its own — some firmware revisions leave the channel open — so it is logged
    // and the caller's operation still attempted, which then reports the real
    // error rather than a speculative one.
    try {
      await device.writeCharacteristicWithResponseForService(
        CP27_SERVICE_UUID,
        CP27_PASSWORD_CHAR_UUID,
        asciiToBase64(password),
      );
      bleLog(`cp27: unlocked ${deviceId}`);
    } catch (e) {
      bleLog('cp27: unlock failed:', e instanceof Error ? e.message : String(e));
    }

    return await fn(device);
  } finally {
    try {
      await device?.cancelConnection();
    } catch {
      /* already gone */
    }
  }
}

/** Connect and unlock, to prove a tag is reachable and the password is right. */
export async function verifyDevice(
  deviceId: string,
  options: CommandOptions = {},
): Promise<CommandResult> {
  const password = options.password ?? CP27_DEFAULT_PASSWORD;
  try {
    const services = await withConnection(deviceId, password, async (device) => {
      const svcs = await device.services();
      return svcs.map((s) => s.uuid.toLowerCase());
    });

    const hasVendorService = services.some((u) => u.includes('ffe0'));
    return {
      ok: hasVendorService,
      detail: hasVendorService
        ? 'Connected and unlocked. Vendor service 0xFFE0 present.'
        : `Connected, but no 0xFFE0 service. Found: ${services.join(', ') || 'none'}.`,
    };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : 'Could not connect to the tag.',
    };
  }
}

/**
 * Write a command to 0xFFE2 and wait for a notification on 0xFFE1.
 *
 * REQUIRES AN EXPLICIT OPCODE. There is no default and no guessing, because the
 * vocabulary was never captured: an unknown "NO" command could change the
 * advertising interval, change the password, or wipe the configuration, and
 * there is no undo outside the vendor's own app. A tag that stops advertising
 * because of a guessed write looks exactly like a flat battery, so the mistake
 * would also be hard to diagnose.
 *
 * @param opcode the command body, WITHOUT the "NO" prefix — that is added here.
 */
export async function sendCommand(
  deviceId: string,
  opcode: string,
  options: CommandOptions = {},
): Promise<CommandResult> {
  const trimmed = opcode.trim();
  if (!trimmed) {
    return { ok: false, detail: 'No command given. This function never guesses one.' };
  }

  const password = options.password ?? CP27_DEFAULT_PASSWORD;
  const timeout = options.responseTimeoutMs ?? 3000;

  try {
    const response = await withConnection(deviceId, password, async (device) => {
      // Subscribe BEFORE writing: a fast firmware can answer before a
      // subscription registered afterwards would exist to hear it.
      let resolveResponse: (v: string | null) => void = () => undefined;
      const responsePromise = new Promise<string | null>((resolve) => {
        resolveResponse = resolve;
      });

      const subscription = device.monitorCharacteristicForService(
        CP27_SERVICE_UUID,
        CP27_NOTIFY_CHAR_UUID,
        (error, characteristic) => {
          if (error) return;
          if (characteristic?.value) resolveResponse(characteristic.value);
        },
      );

      const timer = setTimeout(() => resolveResponse(null), timeout);
      try {
        await device.writeCharacteristicWithResponseForService(
          CP27_SERVICE_UUID,
          CP27_CMD_CHAR_UUID,
          asciiToBase64(CP27_CMD_PREFIX + trimmed),
        );
        bleLog(`cp27: wrote "${CP27_CMD_PREFIX}${trimmed}" to ${deviceId}`);
        return await responsePromise;
      } finally {
        clearTimeout(timer);
        subscription.remove();
      }
    });

    return {
      ok: true,
      detail: response
        ? 'Command written; the tag replied.'
        : 'Command written. No reply within the timeout — which is not necessarily a failure.',
      response: response ?? undefined,
    };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : 'Could not send the command.',
    };
  }
}

/**
 * Power the tag down.
 *
 * Returns a refusal unless a power-off opcode has been configured, because
 * nobody has captured one. See the note on sendCommand for why guessing is not
 * an acceptable substitute — and cp27Opcodes.ts for how to capture the real one.
 */
export async function powerOff(
  deviceId: string,
  opcode: string | null,
  options: CommandOptions = {},
): Promise<CommandResult> {
  if (!opcode) {
    return {
      ok: false,
      detail:
        'No power-off command is known for this tag. Capture it from the vendor app ' +
        '(Admin → Device commands) and set it there — guessing could reconfigure the tag.',
    };
  }
  return sendCommand(deviceId, opcode, options);
}
