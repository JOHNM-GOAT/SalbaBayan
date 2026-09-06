/**
 * Merging the local write queue into the rescue requests a device shows.
 *
 * Pure, so it can be tested directly — and it needs to be, because the bug it
 * was extracted to fix made a cancelled SOS come back:
 *
 *   The queue holds inserts AND updates. Cancelling an SOS enqueues an
 *   *update* (`{ status: "cancelled" }`), and the old merge turned every
 *   queued row for the table into a request with `status: "pending"` hard
 *   coded and `ts` set to the moment it was queued. So the cancel materialised
 *   as a brand-new pending request, dated now, under a different id
 *   (`<uuid>:update`) that the id-based de-duplication could not collapse.
 *   The resident held the control, watched the SOS clear, and immediately saw
 *   it return with the timer restarting from zero — and offline, where the
 *   queue cannot drain, it stayed that way. The one destructive action on the
 *   screen looked like it did nothing.
 *
 * The rule this file encodes: a queued INSERT is a request that exists only
 * locally, and a queued UPDATE is a newer local intent about a request that
 * already exists. The second is never a request of its own.
 */

export type RescueStatus =
  | "pending"
  | "acknowledged"
  | "rescued"
  | "cancelled";

export type MergeableRequest = {
  id: string;
  status: RescueStatus;
  /** When the resident tapped — NOT when the row arrived. Drives the timer. */
  ts: string;
  [key: string]: unknown;
};

/** The shape this needs from a queue row; the real one carries more. */
export type MergeableWrite = {
  id: string;
  table: string;
  op?: "insert" | "update";
  payload: Record<string, unknown>;
  createdAt: number;
  blocked?: boolean;
};

const isLive = (row: MergeableWrite) =>
  row.table === "rescue_requests" && !row.blocked;

/**
 * Queued inserts, presented as if they were rows.
 *
 * Without these the SOS screen is blind to its own request while offline: the
 * server cannot be reached, so the screen has nothing to time and the resident
 * watches a frozen 00:00 on a distress call they just raised. The queued
 * payload already carries the tap time, so the timer runs correctly from the
 * press with or without a network.
 */
export function queuedInserts<T extends MergeableRequest>(
  rows: MergeableWrite[],
  build: (payload: Record<string, unknown>, id: string, ts: string) => T,
): T[] {
  return rows
    // `op` is absent on rows queued before updates existed; those are inserts.
    .filter((row) => isLive(row) && (row.op ?? "insert") === "insert")
    .map((row) => {
      const p = row.payload;
      const ts =
        typeof p.ts === "string" ? p.ts : new Date(row.createdAt).toISOString();
      return build(p, row.id, ts);
    });
}

/**
 * Queued updates, collected against the id they target.
 *
 * `enqueueUpdate` stores the real target id inside the payload precisely so
 * the synthetic `<uuid>:update` queue key never has to be parsed back apart.
 * Later patches for the same request win, matching the order they will be
 * applied in when the queue drains.
 */
export function queuedPatches(
  rows: MergeableWrite[],
): Map<string, Record<string, unknown>> {
  const patches = new Map<string, Record<string, unknown>>();

  for (const row of [...rows].sort((a, b) => a.createdAt - b.createdAt)) {
    if (!isLive(row) || row.op !== "update") continue;

    const targetId = row.payload.id;
    if (typeof targetId !== "string") continue;

    patches.set(targetId, { ...(patches.get(targetId) ?? {}), ...row.payload });
  }

  return patches;
}

/**
 * Server rows plus the queue, reconciled.
 *
 * Order matters and is deliberate:
 *   1. Local inserts, so an offline request is visible at all.
 *   2. Server rows over them — once a request has landed, the server knows
 *      things the local copy cannot, such as who acknowledged it.
 *   3. Queued updates last, because an un-flushed local update is newer than
 *      the server row it targets. A cancel made offline must read as cancelled
 *      even while the server still says pending; anything else shows the
 *      resident their own action being ignored.
 */
export function mergeRequests<T extends MergeableRequest>(
  remote: T[],
  local: T[],
  patches: Map<string, Record<string, unknown>>,
): T[] {
  const byId = new Map<string, T>();

  for (const row of local) byId.set(row.id, row);
  for (const row of remote) byId.set(row.id, row);

  for (const [id, patch] of patches) {
    const base = byId.get(id);
    // A patch for a request this device cannot see is dropped rather than
    // materialised — that is exactly the bug this module exists to prevent.
    if (base) byId.set(id, { ...base, ...patch });
  }

  return [...byId.values()].sort((a, b) => b.ts.localeCompare(a.ts));
}
