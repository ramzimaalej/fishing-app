import type { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';

import { bitesCollection } from '@/services/firebase/firestore';
import { uploadBiteImage } from '@/services/firebase/storage';
import type { BiteEvent, BiteRecord, BiteSize, EnvironmentSnapshot } from '@/types';

import { deleteLocalPhoto, persistLocalPhoto, resolveLocalPhoto } from './photoStorage';

/** What a photo attach resolved to, so the UI can show it immediately. */
export interface AttachResult {
  localImage: string;
  imageUrl: string | null;
}

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
    localImage: typeof d.localImage === 'string' ? d.localImage : null,
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
      localImage: null,
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

  /**
   * Attach a catch photo. ALWAYS saves a persistent on-device copy (free tier);
   * premium users additionally get a Firebase Storage backup that syncs across
   * devices. The cloud step is best-effort — if Storage isn't enabled/reachable
   * the local copy still succeeds, so the feature never hard-fails.
   */
  async attachImage(
    uid: string,
    biteId: string,
    sourceUri: string,
    opts: { premium: boolean },
  ): Promise<AttachResult> {
    const localImage = await persistLocalPhoto(biteId, sourceUri);
    await bitesCollection(uid).doc(biteId).update({ localImage });

    let imageUrl: string | null = null;
    if (opts.premium) {
      try {
        imageUrl = await uploadBiteImage(uid, biteId, resolveLocalPhoto(localImage));
        await bitesCollection(uid).doc(biteId).update({ imageUrl });
      } catch {
        // Storage not enabled/reachable — keep the local copy, no cloud backup.
      }
    }
    return { localImage, imageUrl };
  },

  /**
   * Best-effort: back up any on-device-only photos to the cloud for a premium
   * user (e.g. right after they upgrade). Idempotent — records that already
   * have an imageUrl are skipped.
   */
  async backfillCloudPhotos(uid: string, records: BiteRecord[]): Promise<void> {
    const pending = records.filter((r) => r.localImage && !r.imageUrl);
    for (const r of pending) {
      try {
        const url = await uploadBiteImage(uid, r.id, resolveLocalPhoto(r.localImage as string));
        await bitesCollection(uid).doc(r.id).update({ imageUrl: url });
      } catch {
        // Storage unavailable or a single file missing — skip, try again later.
      }
    }
  },

  async updateNote(uid: string, biteId: string, note: string): Promise<void> {
    await bitesCollection(uid).doc(biteId).update({ note });
  },

  async remove(uid: string, biteId: string, localImage?: string | null): Promise<void> {
    if (localImage) await deleteLocalPhoto(localImage);
    await bitesCollection(uid).doc(biteId).delete();
  },
};
