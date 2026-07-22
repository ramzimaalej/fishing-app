import {
  getMessaging,
  requestPermission,
  getToken,
  onMessage,
  AuthorizationStatus,
} from '@react-native-firebase/messaging';

const messaging = getMessaging();

/**
 * Request push-notification permission (iOS prompts; Android 13+ prompts).
 * Returns true when authorized or provisionally authorized.
 */
export async function requestMessagingPermission(): Promise<boolean> {
  const status = await requestPermission(messaging);
  return (
    status === AuthorizationStatus.AUTHORIZED ||
    status === AuthorizationStatus.PROVISIONAL
  );
}

/** Fetch the FCM registration token for this device, or null on failure. */
export async function getFcmToken(): Promise<string | null> {
  try {
    return await getToken(messaging);
  } catch {
    return null;
  }
}

/** Subscribe to foreground push messages. Returns an unsubscribe function. */
export function onForegroundMessage(cb: (msg: unknown) => void): () => void {
  return onMessage(messaging, async (remoteMessage) => {
    cb(remoteMessage);
  });
}

// NOTE: The background/quit-state handler must be registered at the very top of
// the app entrypoint (index.ts), OUTSIDE the React tree, e.g.:
//
//   import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
//   setBackgroundMessageHandler(getMessaging(), async (msg) => { /* handle */ });
