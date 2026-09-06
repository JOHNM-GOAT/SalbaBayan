/**
 * Offline photo queue (PRD §7.7, FR-7.4 — the photo fail-safe).
 *
 * Photos cannot ride in the row queue. That queue sends JSON to PostgREST;
 * this sends bytes to Storage, and the two fail, retry and succeed
 * independently. Conflating them would mean a 4 MB upload timing out could
 * hold up a rescue request behind it in the same ordered queue.
 *
 * So the report and its photo are decoupled deliberately:
 *
 *   1. The report row is queued and sent on its own. It never waits for a
 *      photo, because a hazard report with no picture is still a hazard report
 *      and the road is still blocked.
 *   2. The photo is stored locally as a Blob and uploaded whenever it can be.
 *   3. Once uploaded, the row is patched with the object path through the
 *      normal row queue.
 *
 * The consequence worth stating: a report can exist without its photo for a
 * while, and that is the intended behaviour rather than a gap. The alternative
 * — holding the report back until its photo lands — loses the urgent half to
 * protect the optional half.
 */

import Dexie, { type Table } from "dexie";
import { enqueueUpdate } from "./offlineQueue";
import { getCurrentUserId, getSupabase } from "./supabase";

const BUCKET = "hazard-photos";

export interface PendingPhoto {
  /** The hazard report this photo belongs to. */
  hazardId: string;
  blob: Blob;
  contentType: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

class PhotoDB extends Dexie {
  photos!: Table<PendingPhoto, string>;

  constructor() {
    // A separate database from the row queue, so a schema change to one never
    // forces a migration of the other's stored binaries.
    super("salbabayan-photos");
    this.version(1).stores({ photos: "hazardId, createdAt" });
  }
}

let db: PhotoDB | null = null;

function getDb(): PhotoDB | null {
  if (typeof window === "undefined") return null;
  if (!db) db = new PhotoDB();
  return db;
}

/**
 * Keep the photo on the device. Returns immediately — IndexedDB stores Blobs
 * natively, so nothing is re-encoded and nothing is read into memory twice.
 */
export async function queuePhoto(hazardId: string, file: Blob): Promise<void> {
  const database = getDb();
  if (!database) return;

  await database.photos.put({
    hazardId,
    blob: file,
    contentType: file.type || "image/jpeg",
    createdAt: Date.now(),
    attempts: 0,
  });

  void flushPhotos();
}

export async function pendingPhotoCount(): Promise<number> {
  const database = getDb();
  if (!database) return 0;
  return database.photos.count();
}

/** A local preview URL for a photo that has not uploaded yet. */
export async function localPhotoUrl(hazardId: string): Promise<string | null> {
  const database = getDb();
  if (!database) return null;
  const row = await database.photos.get(hazardId);
  return row ? URL.createObjectURL(row.blob) : null;
}

let flushing = false;

/**
 * Upload what can be uploaded.
 *
 * Unlike the row queue this does NOT stop at the first failure. Photos have no
 * ordering relationship with each other — one that fails to upload has no
 * bearing on the next, and blocking on it would strand every later photo
 * behind one bad file.
 */
export async function flushPhotos(): Promise<{ sent: number; remaining: number }> {
  const database = getDb();
  if (!database || flushing) {
    return { sent: 0, remaining: await pendingPhotoCount() };
  }

  flushing = true;
  let sent = 0;

  try {
    const supabase = getSupabase();
    if (!supabase) return { sent: 0, remaining: await pendingPhotoCount() };

    // The object path encodes the owner, and the storage policy checks it, so
    // there is nothing to upload until there is an identity to own it.
    const uid = await getCurrentUserId();
    if (!uid) return { sent: 0, remaining: await pendingPhotoCount() };

    for (const photo of await database.photos.orderBy("createdAt").toArray()) {
      const path = `${uid}/${photo.hazardId}`;

      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, photo.blob, {
          contentType: photo.contentType,
          // Retrying after a connection died mid-upload must overwrite the
          // partial object rather than fail on a name collision forever.
          upsert: true,
        });

      if (error) {
        await database.photos.update(photo.hazardId, {
          attempts: photo.attempts + 1,
          lastError: error.message,
        });
        continue; // photos are independent — do not hold up the rest
      }

      /*
       * Attach the photo to its report only after the bytes are safely stored.
       * Patching the row first would leave a path pointing at nothing, and the
       * feed would render a broken image as though the photo were lost.
       */
      await enqueueUpdate("hazard_reports", photo.hazardId, { photo_url: path });
      await database.photos.delete(photo.hazardId);
      sent += 1;
    }
  } finally {
    flushing = false;
  }

  return { sent, remaining: await pendingPhotoCount() };
}

/**
 * Photos are private (see migration 0009), so they are read through a signed
 * URL rather than a public one. An hour is long enough to browse the feed and
 * short enough that a leaked link is not a permanent one.
 */
export async function signedPhotoUrl(path: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600);

  return error ? null : (data?.signedUrl ?? null);
}

let listenerInstalled = false;

/** Retry on reconnect, plus a slow poll for the "online but dead" case. */
export function startPhotoFlushListener(intervalMs = 45_000): () => void {
  if (typeof window === "undefined" || listenerInstalled) return () => {};
  listenerInstalled = true;

  const onOnline = () => void flushPhotos();
  window.addEventListener("online", onOnline);

  const timer = window.setInterval(() => {
    if (navigator.onLine) void flushPhotos();
  }, intervalMs);

  if (navigator.onLine) void flushPhotos();

  return () => {
    window.removeEventListener("online", onOnline);
    window.clearInterval(timer);
    listenerInstalled = false;
  };
}
