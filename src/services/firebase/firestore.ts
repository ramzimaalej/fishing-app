import {
  collection,
  doc,
  getFirestore,
  getDoc,
  setDoc,
  type FirebaseFirestoreTypes,
} from '@react-native-firebase/firestore';

import { COLLECTIONS } from '@/config/constants';

/** Shared Firestore instance (modular API). */
export const db = getFirestore();

type UserDoc = { isPremium: boolean } & Record<string, unknown>;

/** Reference to a user document at `users/{uid}`. */
function userRef(uid: string): FirebaseFirestoreTypes.DocumentReference {
  return doc(db, COLLECTIONS.users, uid);
}

/** Read a user document, or `null` if it does not exist yet. */
export async function getUserDoc(uid: string): Promise<UserDoc | null> {
  const snap = await getDoc(userRef(uid));
  // RNFirebase exposes `exists` as a boolean property (not a method).
  if (!snap.exists) return null;
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  return { isPremium: Boolean(data.isPremium), ...data };
}

/** Create or merge fields into a user document. */
export async function upsertUserDoc(
  uid: string,
  data: Record<string, unknown>,
): Promise<void> {
  await setDoc(userRef(uid), data, { merge: true });
}

/** Flip the premium flag on a user document. */
export async function setUserPremium(uid: string, isPremium: boolean): Promise<void> {
  await setDoc(userRef(uid), { isPremium }, { merge: true });
}

/** Collection of a user's bite records at `users/{uid}/bites`. */
export function bitesCollection(
  uid: string,
): FirebaseFirestoreTypes.CollectionReference {
  return collection(db, COLLECTIONS.users, uid, COLLECTIONS.bites);
}
