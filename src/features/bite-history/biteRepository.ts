import type { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';

import { bitesCollection } from '@/services/firebase/firestore';
import { uploadBiteImage } from '@/services/firebase/storage';
import type { BiteEvent, BiteRecord, BiteSize, EnvironmentSnapshot } from '@/types';

/**
 * Persistence layer for detected bites. One Firestore subcollection per user:
 *   users/{uid}/bites/{biteId}
 * Documents are stored keyed by the runtime BiteEvent id so re-writes are
 * idempotent and image/note updates target a known doc.
 */

type DocData = FirebaseFirestoreTypes.DocumentData;
type QueryDocSnapshot = FirebaseFirestoreTypes.QueryDocumentSnapshot;

const VALID_SIZES: readonly BiteSize[] = ['small', 'big'];

/** Coerce an unknown number-ish value to a finite number with a fallback. */
function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Defensive mapping of a Firestore document to a BiteRecord. */
function toRecord(uid: string, id: string, data: DocData | undefined): BiteRecord {
  const d = data ?? {};
  const size: BiteSize = VALID_SIZES.includes(d.size as BiteSize)
    ? (d.size as BiteSize)
    : 'small';
  return {
    id,
    userId: typeof d.userId === 'string' ? d.userId : uid,
    timestamp: num(d.timestamp, Date.now()),
    size,
    peakMagnitude: num(d.peakMagnitude),
    confidence: num(d.confidence),
    imageUrl: typeof d.imageUrl === 'string' ? d.imageUrl : null,
    note: typeof d.note === 'string' ? d.note : null,
    conditions: (d.conditions as Partial<EnvironmentSnapshot> | undefined) ?? null,
  };
}

function mapSnapshot(uid: string, snapshot: FirebaseFirestoreTypes.QuerySnapshot): BiteRecord[] {
  return snapshot.docs.map((doc: QueryDocSnapshot) => toRecord(uid, doc.id, doc.data()));
}

export const biteRepository = {
  /** Persist a newly detected bite. Returns the stored document id. */
  async add(
    uid: string,
    event: BiteEvent,
    conditions?: Partial<EnvironmentSnapshot> | null,
  ): Promise<string> {
    // Use a Firestore-generated id, not event.id. event.id derives from the
    // device-clock sample time + a per-session counter, both of which reset /
    // wrap — reusing it as the doc id risks a new bite overwriting an older one
    // across sessions.
    const ref = bitesCollection(uid).doc();
    const record: BiteRecord = {
      ...event,
      id: ref.id,
      userId: uid,
      // Wall-clock capture time. event.timestamp is a DEVICE-clock value
      // (uint32 ms, wraps ~every 49 days) meant only for relative graph/detector
      // timing — never a real calendar time. Stamp real time at persistence.
      timestamp: Date.now(),
      imageUrl: null,
      note: null,
      conditions: conditions ?? null,
    };
    await ref.set(record);
    return ref.id;
  },

  /** One-shot fetch of all bites, newest first. */
  async list(uid: string): Promise<BiteRecord[]> {
    const snapshot = await bitesCollection(uid).orderBy('timestamp', 'desc').get();
    return mapSnapshot(uid, snapshot);
  },

  /** Live subscription to a user's bites (newest first). Returns unsubscribe. */
  subscribe(uid: string, cb: (records: BiteRecord[]) => void): () => void {
    return bitesCollection(uid)
      .orderBy('timestamp', 'desc')
      .onSnapshot(
        (snapshot: FirebaseFirestoreTypes.QuerySnapshot | null) => {
          if (snapshot) cb(mapSnapshot(uid, snapshot));
        },
        // Swallow listener errors into an empty update path; callers surface
        // loading/error via the hook layer.
        () => cb([]),
      );
  },

  /** Upload a local image, attach its URL to the bite, and return the URL. */
  async attachImage(uid: string, biteId: string, localUri: string): Promise<string> {
    const url = await uploadBiteImage(uid, biteId, localUri);
    await bitesCollection(uid).doc(biteId).update({ imageUrl: url });
    return url;
  },

  async updateNote(uid: string, biteId: string, note: string): Promise<void> {
    await bitesCollection(uid).doc(biteId).update({ note });
  },

  async remove(uid: string, biteId: string): Promise<void> {
    await bitesCollection(uid).doc(biteId).delete();
  },
};
