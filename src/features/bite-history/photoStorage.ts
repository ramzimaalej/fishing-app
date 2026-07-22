import * as FileSystem from 'expo-file-system';

/**
 * On-device catch-photo storage (free tier). Photos picked from the library are
 * copied into the app's persistent document directory so they survive cache
 * eviction and app restarts. Premium users additionally get a cloud copy in
 * Firebase Storage (see biteRepository).
 *
 * IMPORTANT: we persist a RELATIVE path (`bite-photos/<id>.jpg`), never the
 * absolute `file://…` URI — on iOS the app-container UUID can change between
 * installs/restores, so the absolute path is not stable. The full URI is
 * rebuilt at read time from the current documentDirectory.
 */

const PHOTO_DIR = 'bite-photos';

function dirUri(): string {
  // documentDirectory is null only on web (unsupported here); guard anyway.
  return `${FileSystem.documentDirectory ?? ''}${PHOTO_DIR}`;
}

async function ensureDir(): Promise<void> {
  const dir = dirUri();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

/** Relative path stored in Firestore for a given bite. */
export function localPhotoPath(biteId: string): string {
  return `${PHOTO_DIR}/${biteId}.jpg`;
}

/** Rebuild the absolute file:// URI for a stored relative path (for <Image>). */
export function resolveLocalPhoto(relativePath: string): string {
  return `${FileSystem.documentDirectory ?? ''}${relativePath}`;
}

/**
 * Copy a picked image into persistent local storage.
 * @returns the relative path to store (e.g. "bite-photos/abc.jpg")
 */
export async function persistLocalPhoto(biteId: string, sourceUri: string): Promise<string> {
  await ensureDir();
  const relativePath = localPhotoPath(biteId);
  const dest = resolveLocalPhoto(relativePath);
  // Overwrite any previous copy for this bite.
  const existing = await FileSystem.getInfoAsync(dest);
  if (existing.exists) await FileSystem.deleteAsync(dest, { idempotent: true });
  await FileSystem.copyAsync({ from: sourceUri, to: dest });
  return relativePath;
}

/** Best-effort deletion of a local photo (e.g. when a bite is removed). */
export async function deleteLocalPhoto(relativePath: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(resolveLocalPhoto(relativePath), { idempotent: true });
  } catch {
    /* already gone */
  }
}
