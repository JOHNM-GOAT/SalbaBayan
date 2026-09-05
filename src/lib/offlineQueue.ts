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
import { getCurrentUserId, getSupabase } from "./supabase";

/** Tables the queue is allowed to write to. Keep in sync with the schema. */
export type QueueTable =
  | "water_reports"
  | "hazard_reports"
  | "rescue_requests"
  | "headcounts"
  | "checkins";

/**
 * The column on each table that records who performed the action.
 *
 * Stamping this is not cosmetic attribution — it is what lets a resident read
 * their OWN row back. `read_rescue` is scoped to
 * `requested_by = auth.uid() or is_staff()`, so an SOS written with a null
 * owner inserts successfully and then becomes invisible to the person who
 * raised it, breaking the pending -> acknowledged -> rescued display (FR-4.3).
 * Caught by scripts/rls-test.mjs.
 */
const OWNER_COLUMN: Record<QueueTable, string> = {
  water_reports: "reported_by",
  hazard_reports: "reported_by",
  rescue_requests: "requested_by",
  headcounts: "recorded_by",
  checkins: "scanned_by",
};

/**
 * Fill in the owner column if it is not already set and we have an identity.
 *
 * Offline on a first-ever load there may be no session yet, so this is applied
 * again at flush time rather than only at enqueue time.
 */
async function stampOwner(
  table: QueueTable,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const column = OWNER_COLUMN[table];
  if (payload[column]) return payload;

  const uid = await getCurrentUserId();
  return uid ? { ...payload, [column]: uid } : payload;
}

export interface QueuedWrite {
  /** Stable client-generated id — also the row's primary key server-side. */
  id: string;
  table: QueueTable;
  payload: Record<string, unknown>;
  /** When the user actually acted. Not when it reached the server. */
  createdAt: number;
  attempts: number;
  lastError?: string;
  /**
   * Set when the queue has given up on this row — either it provably cannot be
   * accepted, or it has failed far past any plausible outage. Blocked rows are
   * stepped over so they cannot hold up the writes behind them, and are kept
   * (never deleted) so the failure stays visible and inspectable.
   */
  blocked?: boolean;
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
  /**
   * Always false on return: the write is durable on this device, not yet
   * delivered. Delivery is deliberately not reported here, because waiting to
   * find out is the network wait NFR-3.2 forbids. Callers that need to show
   * delivery subscribe via `onQueueChanged` and watch the count fall — which
   * is the same signal the always-visible sync strip already uses.
   */
  synced: boolean;
};

/**
 * The only supported way to write. Returns as soon as the write is *durable*,
 * meaning "safely in IndexedDB" — never "delivered".
 */
export async function enqueueWrite(
  table: QueueTable,
  payload: Record<string, unknown>,
): Promise<WriteOutcome> {
  const id = (payload.id as string) ?? newClientId();
  const row = await stampOwner(table, { ...payload, id });

  const database = getDb();
  if (!database) {
    // No IndexedDB (SSR, or a browser with storage disabled). Surface it —
    // silently dropping a rescue request would be the worst possible bug.
    throw new Error("no local storage available for the write queue");
  }

  /*
   * Persist locally FIRST, then return. The network attempt happens after.
   *
   * The original order was the reverse — try Supabase, fall back to the queue
   * on failure — and it violated NFR-3.2 ("enqueued in < 200ms from tap,
   * independent of network"), measured at 270ms offline. The reason is
   * structural rather than a matter of tuning: awaiting the network means the
   * tap waits for it to FAIL before the write is safe. Offline that is a lost
   * timeout; on a saturated tower that is still answering slowly — the
   * expected mid-storm condition — it is several seconds of a resident staring
   * at an unconfirmed SOS button, with nothing yet written down anywhere.
   *
   * Writing to IndexedDB first makes acceptance genuinely independent of the
   * network, which is what the contract above promises and what the flush
   * loop is already built to finish.
   */
  await database.queue.put({
    id,
    table,
    payload: row,
    createdAt: Date.now(),
    attempts: 0,
  });

  notifyQueueChanged();

  /*
   * Deliberately not awaited. The row is durable; delivery is the queue's job
   * from here, and it retries on reconnect and on the poll. Awaiting this
   * would reintroduce exactly the latency removed above.
   */
  void flushQueue();

  return { id, synced: false };
}

/**
 * Writes still waiting to be sent. Shown in the UI at all times.
 *
 * Excludes blocked rows deliberately: they are not "waiting", and counting
 * them here would leave a number that never falls, which reads as the queue
 * being broken rather than as specific writes having failed. They get their
 * own, differently-worded indicator.
 */
export async function queuedCount(): Promise<number> {
  const database = getDb();
  if (!database) return 0;
  return database.queue.filter((row) => row.blocked !== true).count();
}

export async function queuedWrites(): Promise<QueuedWrite[]> {
  const database = getDb();
  if (!database) return [];
  return database.queue.orderBy("createdAt").toArray();
}

let flushing = false;

/**
 * Postgres SQLSTATEs that mean "this row will never be accepted, no matter how
 * many times it is retried". Schema and constraint violations only.
 *
 * Deliberately NOT in this list:
 *   - 42501 (insufficient privilege / RLS). It looks permanent but is not: a
 *     write queued before the anonymous session existed carries no owner, and
 *     the same row succeeds once there is an identity to stamp it with.
 *   - PGRST301 and friends (expired JWT). A refresh fixes those.
 *   - Anything with no code at all — that is a network failure, which is the
 *     normal case this whole queue exists for.
 *
 * The bias is deliberate: keep retrying unless the row provably cannot land.
 * Retrying a write that will never succeed costs a request; giving up on one
 * that would have succeeded loses a resident's report.
 */
const PERMANENT_FAILURES = new Set([
  "22003", // numeric value out of range
  "22007", // invalid datetime format
  "22P02", // invalid text representation
  "23502", // not-null violation
  "23503", // foreign key violation
  "23514", // check constraint violation
  "PGRST204", // column not found — client/schema mismatch
]);

/**
 * Retry ceiling for failures that are not provably permanent.
 *
 * At the 30s poll interval this is roughly ten minutes of continuous failure.
 * It exists only so an unforeseen poison row cannot block the queue forever;
 * an ordinary outage never reaches it, because a device with no connectivity
 * does not attempt a flush at all (see the session check below).
 */
const MAX_ATTEMPTS = 20;

function isPermanent(code: string | undefined): boolean {
  return code !== undefined && PERMANENT_FAILURES.has(code);
}

/**
 * Drain the queue in insertion order (FR-3.2). Safe to call concurrently;
 * overlapping calls no-op.
 *
 * Ordering is preserved by stopping at the first row that fails for a
 * retryable reason — a later row must never overtake an earlier one.
 *
 * But stopping unconditionally, which is what this did originally, means one
 * row that can never succeed blocks every row behind it forever. In this
 * application that is a safety bug, not a performance one: it would leave a
 * rescue request stuck behind a malformed water report, queued and invisible,
 * for the entire storm. So a row that provably cannot land, or that has failed
 * far past any plausible outage, is marked `blocked` and stepped over. Blocked
 * rows are never deleted — they stay on the device for inspection and are
 * surfaced in the UI.
 */
export async function flushQueue(): Promise<{ sent: number; remaining: number }> {
  const database = getDb();
  if (!database || flushing) return { sent: 0, remaining: await queuedCount() };

  flushing = true;
  let sent = 0;

  try {
    const supabase = getSupabase();
    if (!supabase) return { sent: 0, remaining: await queuedCount() };

    /*
     * Without a session every policy denies the write, so flushing would fail
     * every row and burn attempts against the ceiling for a reason that has
     * nothing to do with the rows themselves. Wait for identity instead.
     */
    const uid = await getCurrentUserId();
    if (!uid) return { sent: 0, remaining: await queuedCount() };

    const pending = await database.queue.orderBy("createdAt").toArray();

    for (const item of pending) {
      if (item.blocked) continue; // already stepped over; do not retry or stop

      // Re-stamp: a write queued before the first session existed has no owner
      // yet. Without this it would sync successfully and then be unreadable by
      // the person who made it.
      const payload = await stampOwner(item.table, item.payload);

      // upsert, not insert: if a previous attempt actually landed before the
      // connection dropped, this collapses to a no-op instead of a duplicate.
      const { error } = await supabase
        .from(item.table)
        .upsert(payload, { onConflict: "id", ignoreDuplicates: true });

      if (error) {
        const attempts = item.attempts + 1;
        const givingUp = isPermanent(error.code) || attempts >= MAX_ATTEMPTS;

        await database.queue.update(item.id, {
          attempts,
          lastError: error.message,
          blocked: givingUp,
        });

        if (givingUp) continue; // step over it — do not hold up the queue
        break; // retryable: preserve order, try again next flush
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

/**
 * Writes this device has given up on. Never silently dropped — a resident who
 * believes they filed a report is owed the truth that it did not land.
 */
export async function blockedWrites(): Promise<QueuedWrite[]> {
  const database = getDb();
  if (!database) return [];
  return database.queue.filter((row) => row.blocked === true).toArray();
}

export async function blockedCount(): Promise<number> {
  return (await blockedWrites()).length;
}

/**
 * Clear a blocked row's flag so the queue will try it again.
 *
 * Some "permanent" failures are only permanent until someone fixes the cause —
 * a foreign key that pointed at a Purok not yet synced, a column added in a
 * migration the device had not seen. Retrying is a deliberate act, not
 * automatic, because the alternative is a row that silently cycles forever.
 */
export async function retryBlocked(id: string): Promise<void> {
  const database = getDb();
  if (!database) return;
  await database.queue.update(id, { blocked: false, attempts: 0 });
  notifyQueueChanged();
}

/**
 * Permanently discard blocked rows.
 *
 * Without this the alarm indicator can never be cleared, so a single bad row
 * would leave every screen showing a failure forever and residents learning to
 * ignore it. Discarding is explicit and only ever applies to rows the queue has
 * already given up on — nothing still pending can be dropped this way.
 */
export async function discardBlocked(): Promise<number> {
  const database = getDb();
  if (!database) return 0;
  const stuck = await blockedWrites();
  await database.queue.bulkDelete(stuck.map((row) => row.id));
  notifyQueueChanged();
  return stuck.length;
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
