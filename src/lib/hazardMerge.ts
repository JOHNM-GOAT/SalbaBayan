/**
 * Merging the local write queue into the hazard reports a device shows.
 *
 * Pure, so it can be tested directly — and it needs to be, because the bug it
 * was extracted to fix is the one a user hit immediately: marking a report
 * fixed left it on screen, still reading UNRESOLVED.
 *
 * The queue holds inserts AND updates. Marking a hazard fixed enqueues an
 * *update* (`{ status: "resolved" }`), and the feed simply filtered those out
 * — `row.op !== "update"` — so a resolve was invisible to the screen that
 * raised it until the write reached the server and a refresh brought the row
 * back as gone. Online and lucky, that is a flicker. Offline, or on a tower
 * that is taking its time, the report sits there contradicting the person who
 * just fixed it, and the only thing they can do about it is tap again.
 *
 * This is the same mistake `rescueMerge.ts` was written for, arrived at from
 * the other side: there, queued updates were materialised as new rows, so a
 * cancelled SOS came back. Here they were discarded, so a resolved hazard never
 * left. Both come from treating "a queued write" as one kind of thing.
 *
 * The rule this file encodes, stated once: a queued INSERT is a row that exists
 * only locally, and a queued UPDATE is a newer local intent about a row that
 * already exists. The second is never a row of its own, and never nothing.
 */

export type HazardStatus = "open" | "resolved";

export type MergeableHazard = {
  id: string;
  status: HazardStatus;
  ts: string;
  /** Set by the merge: this row carries a local change the server has not seen. */
  pending?: boolean;
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

/*
 * `blocked` rows are excluded throughout.
 *
 * A write the server refused is not a local intent worth honouring — it is a
 * write that is never going to happen. Applying a blocked resolve would show
 * the road as clear on the strength of a request RLS threw away, which is the
 * one direction this must never fail in.
 */
const isLive = (row: MergeableWrite) =>
  row.table === "hazard_reports" && !row.blocked;

/**
 * Queued inserts, presented as if they were rows.
 *
 * Without these a reporter who files offline sees nothing appear, assumes it
 * failed, and files again — and duplicate reports for one street are the noise
 * responders can least afford.
 */
export function queuedInserts<T extends MergeableHazard>(
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
 * `enqueueUpdate` stores the real target id inside the payload precisely so the
 * synthetic `<uuid>:update` queue key never has to be parsed back apart. Later
 * patches for the same row win, matching the order they will be applied in when
 * the queue drains.
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
 *   1. Local inserts, so a report filed offline is visible at all.
 *   2. Server rows over them — once a report has landed, the server knows
 *      things the local copy cannot, such as the uploaded photo's path.
 *   3. Queued updates last, because an un-flushed local update is newer than
 *      the server row it targets. A resolve made offline must read as resolved
 *      even while the server still says open; anything else shows the volunteer
 *      their own work being ignored.
 *
 * A patch whose target this device cannot see is DROPPED rather than turned
 * into a row. That is the half `rescueMerge` got wrong in the other direction,
 * and it matters here too: a resolve for a report outside the fetch window must
 * not conjure a phantom resolved report out of a payload holding only an id and
 * a status.
 */
export function mergeHazards<T extends MergeableHazard>(
  remote: T[],
  local: T[],
  patches: Map<string, Record<string, unknown>>,
): T[] {
  const byId = new Map<string, T>();

  for (const row of local) byId.set(row.id, row);
  for (const row of remote) byId.set(row.id, row);

  for (const [id, patch] of patches) {
    const base = byId.get(id);
    if (!base) continue;
    // `pending` is the honesty flag: this row reads as resolved because of a
    // write still sitting in the queue, not because the barangay knows.
    byId.set(id, { ...base, ...patch, pending: true });
  }

  return [...byId.values()].sort((a, b) => b.ts.localeCompare(a.ts));
}
