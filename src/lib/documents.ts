/**
 * The documentation knowledge base, cached on the device (PRD §5.6 F13).
 *
 * F13 exists because "an official at a barangay hall during an event has a
 * phone and no repository" — and until now the screen read the documents
 * straight from Supabase REST with no local copy. The Service Worker
 * deliberately does NOT cache REST (see src/app/sw.ts), so with the connection
 * gone the list came back empty, under a label promising "Readable with no
 * signal." The one document that has to survive a lost connection was the one
 * that did not.
 *
 * So documents are held the same way the advisory is: fetched when there is a
 * network, written to IndexedDB, and read from IndexedDB thereafter. The page
 * renders the cache, so it is not waiting on a round trip either.
 */

import Dexie, { type Table } from "dexie";
import { getSupabase } from "./supabase";

export type DocumentRow = {
  filename: string;
  title: string;
  content: string;
  updated_at: string;
};

export type DocumentsView = {
  rows: DocumentRow[];
  /** When the network last answered, or null if it never has on this device. */
  fetchedAt: number | null;
  /** False when these rows came from cache because the network could not answer. */
  live: boolean;
};

/* ---------------------------------------------------------------------------
 * Cache
 * ------------------------------------------------------------------------ */

type CacheRecord = { key: string; rows: DocumentRow[]; fetchedAt: number };

class DocumentsDB extends Dexie {
  documents!: Table<CacheRecord, string>;

  constructor() {
    super("salbabayan-documents");
    this.version(1).stores({ documents: "key" });
  }
}

let cacheDb: DocumentsDB | null = null;

function getCacheDb(): DocumentsDB | null {
  if (typeof window === "undefined") return null;
  if (!cacheDb) cacheDb = new DocumentsDB();
  return cacheDb;
}

const KEY = "current";

async function readCache(): Promise<CacheRecord | null> {
  const db = getCacheDb();
  if (!db) return null;
  try {
    return (await db.documents.get(KEY)) ?? null;
  } catch {
    return null;
  }
}

async function writeCache(rows: DocumentRow[]): Promise<number> {
  const fetchedAt = Date.now();
  const db = getCacheDb();
  if (!db) return fetchedAt;
  try {
    await db.documents.put({ key: KEY, rows, fetchedAt });
  } catch {
    // Storage full or unavailable. This session still has the rows in memory.
  }
  return fetchedAt;
}

/* ---------------------------------------------------------------------------
 * Load
 * ------------------------------------------------------------------------ */

/**
 * Documents for display: cache-backed, refreshed when the network answers.
 *
 * Content is fetched only for documents whose `updated_at` has changed since
 * the cached copy. The list itself needs three small columns; the bodies are
 * the expensive part, and re-downloading an unchanged runbook on every visit
 * costs a resident's data for nothing.
 */
export async function loadDocuments(): Promise<DocumentsView> {
  const cached = await readCache();
  const fallback: DocumentsView = {
    rows: cached?.rows ?? [],
    fetchedAt: cached?.fetchedAt ?? null,
    live: false,
  };

  const supabase = getSupabase();
  if (!supabase) return fallback;

  const index = await supabase
    .from("documents")
    .select("filename,title,updated_at")
    .order("filename");

  // A genuine failure — offline, or the request was refused. Keep the cache
  // and say it is not current; the caller must not report this as "empty".
  if (index.error) return fallback;

  const meta = (index.data ?? []) as Omit<DocumentRow, "content">[];

  /*
   * An empty result here is a SUCCESSFUL read, not a failure: RLS returns no
   * rows to a non-official rather than an error. Caching that empties the
   * store, which is the behaviour we want — a device that has lost its
   * official role should not keep the documents on disk.
   */
  const byFilename = new Map(cached?.rows.map((r) => [r.filename, r]) ?? []);

  const stale = meta.filter(
    (m) => byFilename.get(m.filename)?.updated_at !== m.updated_at,
  );

  const bodies = new Map<string, string>();
  if (stale.length > 0) {
    const fetched = await supabase
      .from("documents")
      .select("filename,content")
      .in(
        "filename",
        stale.map((m) => m.filename),
      );

    if (fetched.error) return fallback;
    for (const row of fetched.data ?? []) {
      bodies.set(row.filename as string, (row.content as string) ?? "");
    }
  }

  const rows: DocumentRow[] = meta.map((m) => ({
    ...m,
    content: bodies.get(m.filename) ?? byFilename.get(m.filename)?.content ?? "",
  }));

  const fetchedAt = await writeCache(rows);
  return { rows, fetchedAt, live: true };
}
