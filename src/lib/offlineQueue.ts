/**
 * The offline write queue (PRD §7.3, §12, FR-3.1..3.5).
 *
 * Every write in this application goes through `enqueueWrite`. There are no
 * exceptions — a write path that calls Supabase directly is a bug, because it
 * reintroduces the failure this whole architecture exists to remove.
 *
 * Contract:
 *   - Try a direct Supabase write first. If it lands, nothing is queued.
 *   - On ANY failure (offline, transient 5xx, timeout), persist the payload to
 *     IndexedDB and report success to the caller. The UI confirms regardless of
 *     connectivity — the tap never waits on the network (NFR-3).
 *   - Flush in insertion order on reconnect (FR-3.2).
 *   - Every row carries a stable client-generated id, so a retried flush of a
 *     row that already landed is a no-op rather than a duplicate (PRD §14).
 */

import Dexie, { type Table } from "dexie";
import { getSupabase } from "./supabase";

/** Tables the queue is allowed to write to. Keep in sync with the schema. */
export type QueueTable =
  | "water_reports"
  | "hazard_reports"
  | "rescue_requests"
  | "headcounts"
  | "checkins";

export interface QueuedWrite {
  /** Stable client-generated id — also the row's primary key server-side. */
  id: string;
  table: QueueTable;
  payload: Record<string, unknown>;
  /** When the user actually acted. Not when it reached the server. */
  createdAt: number;
  attempts: number;
  lastError?: string;
}

class SalbaBayanDB extends Dexie {
  queue!: Table<QueuedWrite, string>;

  constructor() {
    super("salbabayan");
    // `createdAt` is indexed so the flush can run in true insertion order.
    this.version(1).stores({ queue: "id, table, createdAt" });
  }
}

let db: SalbaBayanDB | null = null;

/** Dexie touches IndexedDB, which does not exist during SSR. */
function getDb(): SalbaBayanDB | null {
  if (typeof window === "undefined") return null;
  if (!db) db = new SalbaBayanDB();
  return db;
}

export function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export type WriteOutcome = {
  id: string;
  /** true = reached Postgres now; false = durably queued on this device. */
  synced: boolean;
};

/**
 * The only supported way to write. Returns as soon as the write is *durable*,
 * which offline means "safely in IndexedDB" — not "delivered".
 */
export async function enqueueWrite(
  table: QueueTable,
  payload: Record<string, unknown>,
): Promise<WriteOutcome> {
  const id = (payload.id as string) ?? newClientId();
  const row = { ...payload, id };

  try {
    const supabase = getSupabase();
    if (!supabase) throw new Error("supabase client unavailable");

    const { error } = await supabase.from(table).insert(row);
    if (error) throw new Error(error.message);

    return { id, synced: true };
  } catch (err) {
    const database = getDb();
    if (!database) {
      // No IndexedDB (SSR, or a browser with storage disabled). Surface it —
      // silently dropping a rescue request would be the worst possible bug.
      throw err;
    }

    await database.queue.put({
      id,
      table,
      payload: row,
      createdAt: Date.now(),
      attempts: 0,
      lastError: err instanceof Error ? err.message : String(err),
    });

    notifyQueueChanged();
    return { id, synced: false };
  }
}

/** Count of writes still waiting on this device. Shown in the UI at all times. */
export async function queuedCount(): Promise<number> {
  const database = getDb();
  if (!database) return 0;
  return database.queue.count();
}

export async function queuedWrites(): Promise<QueuedWrite[]> {
  const database = getDb();
  if (!database) return [];
  return database.queue.orderBy("createdAt").toArray();
}

let flushing = false;

/**
 * Drain the queue in insertion order. Stops at the first row that fails so a
 * later row can never overtake an earlier one — ordering is part of the
 * contract (FR-3.2). Safe to call concurrently; overlapping calls no-op.
 */
export async function flushQueue(): Promise<{ sent: number; remaining: number }> {
  const database = getDb();
  if (!database || flushing) return { sent: 0, remaining: await queuedCount() };

  flushing = true;
  let sent = 0;

  try {
    const supabase = getSupabase();
    if (!supabase) return { sent: 0, remaining: await queuedCount() };

    const pending = await database.queue.orderBy("createdAt").toArray();

    for (const item of pending) {
      // upsert, not insert: if a previous attempt actually landed before the
      // connection dropped, this collapses to a no-op instead of a duplicate.
      const { error } = await supabase
        .from(item.table)
        .upsert(item.payload, { onConflict: "id", ignoreDuplicates: true });

      if (error) {
        await database.queue.update(item.id, {
          attempts: item.attempts + 1,
          lastError: error.message,
        });
        break; // preserve order — do not skip ahead
      }

      await database.queue.delete(item.id);
      sent += 1;
    }
  } finally {
    flushing = false;
    notifyQueueChanged();
  }

  return { sent, remaining: await queuedCount() };
}

/* ---------------------------------------------------------------------------
 * Change notification — lets any screen show the live queued-write count
 * without polling (PRD §6: sync state is always visible, never a toast).
 * ------------------------------------------------------------------------ */

const listeners = new Set<() => void>();

export function onQueueChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyQueueChanged(): void {
  listeners.forEach((fn) => fn());
}

let listenersInstalled = false;

/**
 * Flush on reconnect, plus a slow periodic retry to cover the case where the
 * browser reports `online` but the connection is actually dead (captive
 * portals, a tower that is up but saturated — both common mid-storm).
 */
export function startQueueFlushListener(intervalMs = 30_000): () => void {
  if (typeof window === "undefined" || listenersInstalled) return () => {};
  listenersInstalled = true;

  const onOnline = () => void flushQueue();
  window.addEventListener("online", onOnline);

  const timer = window.setInterval(() => {
    if (navigator.onLine) void flushQueue();
  }, intervalMs);

  if (navigator.onLine) void flushQueue();

  return () => {
    window.removeEventListener("online", onOnline);
    window.clearInterval(timer);
    listenersInstalled = false;
  };
}
