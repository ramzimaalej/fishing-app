import type { Device } from 'react-native-ble-plx';

import { decodeGenericAccel } from './generic';
import { GattSensorClient, type GattSensorConfig } from './GattSensorClient';

/**
 * Any named, connectable BLE peripheral is a candidate. Without a device-
 * specific signature the safest default is: lock onto the first advertised,
 * connectable device that has a name. Users targeting a specific unit should
 * construct GenericSensorClient with its id (the store can pass a remembered
 * one), which bypasses this heuristic entirely.
 */
function looksConnectable(device: Device): boolean {
  const named = Boolean(device.name ?? device.localName);
  return named && device.isConnectable !== false;
}

export const GENERIC_CONFIG: GattSensorConfig = {
  label: 'BLE sensor',
  scanServiceUUIDs: null,
  match: looksConnectable,
  // No known layout → let the base client auto-pick the first notifiable
  // characteristic after discovery.
  notify: null,
  decode: decodeGenericAccel,
};

/**
 * Generic GATT bite-sensor client. Connects to a chosen peripheral, subscribes
 * to its first notifiable characteristic, and decodes notifications as
 * 3×int16-LE milli-g (see generic.ts). The fallback for any sensor that streams
 * acceleration over a standard notify characteristic.
 */
export class GenericSensorClient extends GattSensorClient {
  constructor(targetId: string | null = null, clock?: () => number) {
    super(GENERIC_CONFIG, targetId, clock);
  }
}
