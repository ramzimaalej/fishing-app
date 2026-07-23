import type { Device } from 'react-native-ble-plx';

import { asciiToBase64 } from './bytes';
import { bleLog } from './debug';
import {
  CP27_CMD_CHAR_UUID,
  CP27_CMD_PREFIX,
  CP27_DEFAULT_PASSWORD,
  CP27_DEVICE_INFO_SD,
  CP27_NAME_PREFIX,
  CP27_NOTIFY_CHAR_UUID,
  CP27_PASSWORD_CHAR_UUID,
  CP27_SERVICE_UUID,
  decodeCp27AccFrame,
} from './cp27';
import { GattSensorClient, type GattSensorConfig } from './GattSensorClient';

/** True when a scan result looks like a DX-CP27MINI beacon. */
function isCp27(device: Device): boolean {
  const name = device.name ?? device.localName ?? '';
  if (name.toUpperCase().startsWith(CP27_NAME_PREFIX)) return true;
  const inServiceData = Object.keys(device.serviceData ?? {}).some((u) =>
    u.toLowerCase().includes(CP27_DEVICE_INFO_SD),
  );
  const inServiceUuids = (device.serviceUUIDs ?? []).some((u) =>
    u.toLowerCase().includes(CP27_DEVICE_INFO_SD),
  );
  return inServiceData || inServiceUuids;
}

/**
 * Unlock the beacon and (best-effort) ask it to start streaming.
 *
 * The password write is the confirmed step. An explicit "start ACC" command is
 * intentionally NOT sent by default: its exact opcode wasn't captured, and
 * writing an unknown "NO"+cmd could reconfigure the beacon. Set
 * CP27_STREAM_COMMAND to the real command once it's known.
 */
async function cp27Setup(device: Device): Promise<void> {
  try {
    await device.writeCharacteristicWithResponseForService(
      CP27_SERVICE_UUID,
      CP27_PASSWORD_CHAR_UUID,
      asciiToBase64(CP27_DEFAULT_PASSWORD),
    );
    bleLog(`CP27: password unlock written ("${CP27_DEFAULT_PASSWORD}" → 0xFFE3)`);
  } catch (e) {
    bleLog('CP27: password unlock FAILED:', e instanceof Error ? e.message : String(e));
  }

  if (CP27_STREAM_COMMAND != null) {
    try {
      await device.writeCharacteristicWithResponseForService(
        CP27_SERVICE_UUID,
        CP27_CMD_CHAR_UUID,
        asciiToBase64(CP27_CMD_PREFIX + CP27_STREAM_COMMAND),
      );
      bleLog(`CP27: stream command written ("${CP27_CMD_PREFIX + CP27_STREAM_COMMAND}" → 0xFFE2)`);
    } catch (e) {
      bleLog('CP27: stream command FAILED:', e instanceof Error ? e.message : String(e));
    }
  }
}

/**
 * Command suffix (after the "NO" prefix) that puts the beacon into continuous
 * ACC streaming. Unknown/unconfirmed → left null so we don't send stray writes.
 */
export const CP27_STREAM_COMMAND: string | null = null;

export const CP27_CONFIG: GattSensorConfig = {
  label: 'DX-CP27MINI',
  scanServiceUUIDs: null, // CP27 advertises vendor UUIDs; scan broadly then match
  match: isCp27,
  setup: cp27Setup,
  notify: { service: CP27_SERVICE_UUID, characteristic: CP27_NOTIFY_CHAR_UUID },
  // 0xFFE1 is Readable — probe it in case the beacon exposes the current accel
  // via read even when it isn't pushing notifications.
  poll: { intervalMs: 300 },
  decode: decodeCp27AccFrame,
};

/**
 * GATT bite-sensor client for the DX-CP27MINI. Experimental: it connects,
 * unlocks with the password and subscribes to the notify characteristic using
 * the reverse-engineered protocol. Live accel depends on the beacon actually
 * streaming ACC frames (see cp27.ts for the provisional payload layout).
 */
export class Cp27SensorClient extends GattSensorClient {
  constructor(targetId: string | null = null, clock?: () => number) {
    super(CP27_CONFIG, targetId, clock);
  }
}
