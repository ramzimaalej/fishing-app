import { getStorage, ref, putFile, getDownloadURL } from '@react-native-firebase/storage';

const storage = getStorage();

/**
 * Upload a local image for a bite to `bites/{uid}/{biteId}.jpg` and return its
 * public download URL. `localUri` is a file:// path (e.g. from expo-image-picker).
 */
export async function uploadBiteImage(
  uid: string,
  biteId: string,
  localUri: string,
): Promise<string> {
  const path = `bites/${uid}/${biteId}.jpg`;
  const storageRef = ref(storage, path);
  // Strip the file:// scheme if present — putFile expects a filesystem path.
  const filePath = localUri.replace(/^file:\/\//, '');
  await putFile(storageRef, filePath);
  return getDownloadURL(storageRef);
}
