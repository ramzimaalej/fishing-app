/**
 * Matching a tag by the code printed on it.
 *
 * The label on a DX-CP27-G reads "CP27-C00C" — the last four hex digits of its
 * MAC. That is what someone holding the tag can actually read, so it is what the
 * app should accept: requiring the full 48:87:2D:9D:C0:0C means squinting at a
 * sticker and typing twelve characters correctly, which is exactly the friction
 * that makes people give up and use the vendor app instead.
 *
 * A short code cannot be turned INTO a MAC — the tags do not share a prefix
 * (48:87:2D:9D:C0:xx and 48:87:2D:9C:FB:xx both appear), so there is nothing to
 * reconstruct. It can only be matched against a tag actually heard on air, which
 * is why pairing by code is a *pending* operation that completes when the tag is
 * seen. See deviceStore.
 */

/** Shortest code accepted. Two hex digits would collide across a shelf of tags. */
export const MIN_CODE_LENGTH = 3;

/**
 * Reduce what is printed on the tag to its hex digits.
 *
 * Strips the "CP27" product prefix and any separators, and NOTHING else. It
 * deliberately does not discard stray letters: "left rod" would otherwise
 * collapse to "EFD" — three valid hex digits — and be accepted as a code that
 * could match a real tag. Anything non-hex surviving here makes the code
 * invalid rather than being quietly filtered away.
 */
export function normaliseCode(raw: string): string {
  return raw
    .trim()
    .replace(/^cp\s*-?\s*27/i, '')
    .replace(/[\s:_.-]/g, '')
    .toUpperCase();
}

/** Whether a typed code could identify a tag at all. */
export function isPlausibleCode(raw: string): boolean {
  const code = normaliseCode(raw);
  return code.length >= MIN_CODE_LENGTH && /^[0-9A-F]+$/.test(code);
}

/**
 * Does a printed code identify this device?
 *
 * Matches as a SUFFIX of the MAC, because that is what the printed code is. A
 * substring match anywhere would let "87" match 48:87:2D:… — a tag it is not
 * printed on — and silently bind the wrong one.
 *
 * The advertised name is checked too, so pasting "CP27-C00C" works whether or
 * not the name happens to embed the MAC.
 */
export function codeMatchesDevice(
  code: string,
  deviceId: string,
  deviceName?: string | null,
): boolean {
  if (!isPlausibleCode(code)) return false;
  const needle = normaliseCode(code);

  // Device ids and names may legitimately contain non-hex (an iOS UUID, a
  // product name), so those ARE reduced to hex digits for comparison — the
  // strictness above applies to what the user typed, not to what is on air.
  const idHex = deviceId.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (idHex.endsWith(needle)) return true;

  // Full MAC typed in any punctuation: an exact match rather than a suffix.
  if (needle.length === idHex.length && needle === idHex) return true;

  if (deviceName) {
    const nameHex = deviceName.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (nameHex.length >= MIN_CODE_LENGTH && nameHex.endsWith(needle)) return true;
  }
  return false;
}

export interface CodeCandidate {
  id: string;
  name?: string | null;
}

/**
 * Every device a code could mean.
 *
 * Returns a LIST, never a single best guess. Two tags can share a printed code —
 * it is only the last four digits of a MAC, and nothing stops two boxes of stock
 * colliding — so binding whichever sorted first would be the wrong tag with no
 * indication anything was ambiguous. Callers ask the user when this returns
 * more than one.
 */
export function matchDevices<T extends CodeCandidate>(
  code: string,
  devices: readonly T[],
): T[] {
  if (!isPlausibleCode(code)) return [];

  return devices
    .filter((d) => codeMatchesDevice(code, d.id, d.name))
    // Longer suffix agreement first: a code that matches a tag exactly should
    // outrank one it merely shares a tail with.
    .sort((a, b) => normaliseCode(a.id).length - normaliseCode(b.id).length);
}

/** The code as printed on the tag, for display. */
export function printedCode(deviceId: string): string {
  return deviceId.replace(/[^0-9a-fA-F]/g, '').toUpperCase().slice(-4);
}
