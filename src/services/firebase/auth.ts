import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  onAuthStateChanged,
  signOut,
  GoogleAuthProvider,
  AppleAuthProvider,
  FacebookAuthProvider,
  signInWithCredential,
  type FirebaseAuthTypes,
} from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import Constants from 'expo-constants';

import type { AppUser } from '@/types';

import { getUserDoc } from './firestore';

const auth = getAuth();

let googleConfigured = false;

/** Lazily configure Google Sign-In with the web client id from app config. */
function ensureGoogleConfigured(): void {
  if (googleConfigured) return;
  const webClientId = (Constants.expoConfig?.extra as { googleWebClientId?: string } | undefined)
    ?.googleWebClientId;
  GoogleSignin.configure({ webClientId: webClientId ?? '' });
  googleConfigured = true;
}

/** Map a Firebase user to the app's UI-facing projection. */
export function mapFirebaseUser(
  fbUser: FirebaseAuthTypes.User,
  isPremium = false,
): AppUser {
  return {
    uid: fbUser.uid,
    email: fbUser.email,
    displayName: fbUser.displayName,
    emailVerified: fbUser.emailVerified,
    photoURL: fbUser.photoURL,
    isPremium,
  };
}

/** Read the premium flag for a uid, defaulting to false on any miss. */
async function readPremium(uid: string): Promise<boolean> {
  try {
    const docData = await getUserDoc(uid);
    return docData?.isPremium ?? false;
  } catch {
    return false;
  }
}

export async function signUpWithEmail(email: string, password: string): Promise<AppUser> {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  return mapFirebaseUser(cred.user, false);
}

export async function signInWithEmail(email: string, password: string): Promise<AppUser> {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  const isPremium = await readPremium(cred.user.uid);
  return mapFirebaseUser(cred.user, isPremium);
}

/** Send a verification email to the currently signed-in user. */
export async function sendVerificationEmail(): Promise<void> {
  const current = auth.currentUser;
  if (!current) throw new Error('No authenticated user to verify.');
  await sendEmailVerification(current);
}

/** Reload the current user from the server (to pick up email verification). */
export async function reloadCurrentUser(): Promise<AppUser | null> {
  const current = auth.currentUser;
  if (!current) return null;
  await current.reload();
  const refreshed = auth.currentUser;
  if (!refreshed) return null;
  const isPremium = await readPremium(refreshed.uid);
  return mapFirebaseUser(refreshed, isPremium);
}

export async function signInWithGoogle(): Promise<AppUser> {
  ensureGoogleConfigured();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const result = await GoogleSignin.signIn();
  // Support both older and newer google-signin response shapes.
  const idToken =
    (result as { idToken?: string }).idToken ??
    (result as { data?: { idToken?: string } }).data?.idToken;
  if (!idToken) throw new Error('Google sign-in did not return an id token.');
  const credential = GoogleAuthProvider.credential(idToken);
  const cred = await signInWithCredential(auth, credential);
  const isPremium = await readPremium(cred.user.uid);
  return mapFirebaseUser(cred.user, isPremium);
}

export async function signInWithApple(): Promise<AppUser> {
  const appleCredential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });
  const { identityToken } = appleCredential;
  if (!identityToken) throw new Error('Apple sign-in did not return an identity token.');
  const credential = AppleAuthProvider.credential(identityToken);
  const cred = await signInWithCredential(auth, credential);
  const isPremium = await readPremium(cred.user.uid);
  return mapFirebaseUser(cred.user, isPremium);
}

export async function signInWithFacebook(): Promise<AppUser> {
  // Loaded lazily so a build without the FB SDK linked doesn't crash on import.
  const { LoginManager, AccessToken } = require('react-native-fbsdk-next') as typeof import('react-native-fbsdk-next');
  const result = await LoginManager.logInWithPermissions(['public_profile', 'email']);
  if (result.isCancelled) throw new Error('Facebook sign-in was cancelled.');
  const data = await AccessToken.getCurrentAccessToken();
  if (!data?.accessToken) throw new Error('Facebook sign-in did not return an access token.');
  const credential = FacebookAuthProvider.credential(data.accessToken);
  const cred = await signInWithCredential(auth, credential);
  const isPremium = await readPremium(cred.user.uid);
  return mapFirebaseUser(cred.user, isPremium);
}

export async function signOutUser(): Promise<void> {
  try {
    ensureGoogleConfigured();
    await GoogleSignin.signOut();
  } catch {
    // Not signed in with Google — ignore.
  }
  await signOut(auth);
}

/**
 * Subscribe to auth-state changes. Resolves premium status from Firestore on
 * each transition. Returns an unsubscribe function.
 */
export function subscribeToAuth(cb: (user: AppUser | null) => void): () => void {
  return onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) {
      cb(null);
      return;
    }
    const isPremium = await readPremium(fbUser.uid);
    cb(mapFirebaseUser(fbUser, isPremium));
  });
}
