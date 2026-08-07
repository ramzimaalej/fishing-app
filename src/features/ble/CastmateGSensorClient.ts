import { monotonicNowMs } from '@/features/detection/monotonicClock';

import {
  type BroadcastAdvertisement,
  type BroadcastReading,
  BroadcastSensorClient,
  type BroadcastSensorSpec,
} from './BroadcastSensorClient';
import { decodeMinewAccFrame, MINEW_SERVICE_UUID_SHORT } from './minew';

/**
 * Castmate G CP27 — the sensor the app supports.
 *
 * A BROADCAST tag: it advertises its accelerometer reading rather than accepting
 * a GATT connection, so all the transport behaviour comes from
 * BroadcastSensorClient and this file contains only what is product-specific.
 *
 * WHY THIS ACCEPTS MORE THAN ONE FRAME FORMAT
 * The hardware is sourced, and sourced hardware ships firmware revisions. The
 * unit currently in hand emits the Minew "Acc Sensor" frame under service
 * 0xFFE1, which is the only broadcast layout verified against a real capture in
 * this codebase (see minew.ts). Newer stock may differ. Rather than pin the
 * product to one vendor's layout — which would mean a firmware change silently
 * turning the app into a device that finds nothing — the spec tries each known
 * decoder and takes the first that yields a well-formed reading.
 *
 * Formats are a list, not an if/else, so adding one is one entry and one decoder.
 * Users never see any of this: the product is one device with one name.
 */

/** Product name, in one place so the UI and the logs cannot disagree. */
export const CASTMATE_G_LABEL = 'Castmate G CP27';
export const CASTMATE_G_SHORT = 'Castmate G';
export const CASTMATE_G_KIND = 'castmate-g';

/**
 * One candidate wire format. Returns a reading, or null when the advertisement
 * is not this format — never throws (BroadcastSensorClient guards anyway, but a
 * decoder that signals "not mine" by throwing makes the ordering below useless).
 */
type FrameDecoder = (adv: BroadcastAdvertisement) => BroadcastReading | null;

/**
 * Minew "Acc Sensor" frame in 0xFFE1 service data.
 *
 * Verified against a real capture — see the byte table in minew.ts. The tag's
 * MAC comes from INSIDE the frame rather than from `adv.id`, which matters: on
 * iOS `adv.id` is an opaque per-install UUID, so a rod binding keyed on it would
 * not survive a reinstall.
 */
const decodeServiceDataFfe1: FrameDecoder = (adv) => {
  const sd = adv.serviceData;
  if (!sd) return null;
  for (const [uuid, value] of Object.entries(sd)) {
    if (!uuid.toLowerCase().includes(MINEW_SERVICE_UUID_SHORT)) continue;
    if (typeof value !== 'string') continue;
    // Guarded because base64 decoding THROWS on a malformed payload, and
    // advertisements come off the air from whatever is in range — a corrupt or
    // truncated value is an expected input, not an exceptional one.
    let reading: ReturnType<typeof decodeMinewAccFrame> = null;
    try {
      reading = decodeMinewAccFrame(value);
    } catch {
      continue;
    }
    if (!reading) continue;
    return {
      // The frame codec reports g; the detector works in milli-g throughout.
      xMg: Math.round(reading.x * 1000),
      yMg: Math.round(reading.y * 1000),
      zMg: Math.round(reading.z * 1000),
      deviceKey: reading.mac,
      batteryPct: reading.batteryPct,
    };
  }
  return null;
};

/**
 * Known formats, tried in order.
 *
 * TO ADD A NEWER FIRMWARE'S LAYOUT: write a FrameDecoder, append it here, and
 * add a golden test built from a real capture (Admin → BLE sniffer → Start
 * capture). Do not guess offsets or scale — an unverified decoder is how the old
 * CP27 GATT path ended up permanently marked PROVISIONAL. A resting frame
 * reading ≈ 1 g is what proves a scale factor is right.
 */
const FRAME_DECODERS: readonly FrameDecoder[] = [decodeServiceDataFfe1];

/** Decode an advertisement using whichever known format matches. */
export function extractCastmateGReading(
  adv: BroadcastAdvertisement,
): BroadcastReading | null {
  for (const decode of FRAME_DECODERS) {
    const reading = decode(adv);
    if (reading) return reading;
  }
  return null;
}

/** Last four hex digits of the MAC — enough to tell two tags apart in the UI. */
function keyTail(deviceKey: string): string {
  return deviceKey.replace(/[^0-9a-fA-F]/g, '').slice(-4).toUpperCase();
}

export const CASTMATE_G_SPEC: BroadcastSensorSpec = {
  kind: CASTMATE_G_KIND,
  searchingName: `Searching for ${CASTMATE_G_SHORT}…`,
  displayName: (key) => `${CASTMATE_G_SHORT} ${keyTail(key)}`,
  extract: extractCastmateGReading,
};

export class CastmateGSensorClient extends BroadcastSensorClient {
  constructor(targetKey: string | null = null, clock: () => number = monotonicNowMs) {
    super(CASTMATE_G_SPEC, targetKey, clock);
  }
}
