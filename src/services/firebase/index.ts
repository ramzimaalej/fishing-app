/**
 * Firebase service layer barrel.
 *
 * React Native Firebase auto-initializes the default app from the native
 * config files that MUST be present at build time:
 *   - Android: `google-services.json`   (project root)
 *   - iOS:     `GoogleService-Info.plist` (project root)
 * Both are git-ignored — provide your own from the Firebase console. Paths are
 * wired up in `app.config.ts`. No explicit `initializeApp()` call is needed.
 */

export { db } from './firestore';
export {
  getUserDoc,
  upsertUserDoc,
  setUserPremium,
  bitesCollection,
} from './firestore';

export {
  signUpWithEmail,
  signInWithEmail,
  sendVerificationEmail,
  reloadCurrentUser,
  signInWithGoogle,
  signInWithApple,
  signInWithFacebook,
  signOutUser,
  subscribeToAuth,
  mapFirebaseUser,
} from './auth';

export { uploadBiteImage } from './storage';

export {
  requestMessagingPermission,
  getFcmToken,
  onForegroundMessage,
} from './messaging';
