/**
 * Whether this device holds an advisory change that has not reached residents.
 *
 * The honesty rule the whole app follows, applied to the one write that is a
 * broadcast: a local intention must never look like a fact other people can
 * see. When an official changes the signal offline, their placard keeps showing
 * the server's level, and this is what drives the banner saying what has NOT
 * gone out — so they know to use the megaphone until it clears.
 *
 * No imports, so it can be tested in Node. The row shape is declared here rather
 * than imported from offlineQueue.ts, the same arrangement as hazardMerge.ts.
 */

/** The fields this needs from a queue row; the real one carries more. */
export type QueueRowLike = {
  id: string;
  table: string;
  /** Absent on rows queued before updates were supported — those are inserts. */
  op?: "insert" | "update";
  payload: Record<string, unknown>;
  createdAt: number;
  lastError?: string;
  blocked?: boolean;
};

export type PendingAdvisory =
  | { state: "none" }
  | { state: "queued"; level: number; tappedAt: string }
  | {
      state: "blocked";
      level: number;
      tappedAt: string;
      /** The queue row's own id, for `retryBlocked`. */
      queueId: string;
      reason: string;
    };

/**
 * `enqueueUpdate` keys a row's update as `<id>:update`, so a second change to the
 * same barangay replaces the first. There is at most one row to find.
 */
export function pendingAdvisory(
  rows: QueueRowLike[],
  barangayId: string,
): PendingAdvisory {
  const row = rows.find(
    (r) =>
      r.table === "barangays" &&
      r.op === "update" &&
      r.payload.id === barangayId &&
      // A row with no numeric level is not one setAdvisory wrote. Ignoring it is
      // safer than guessing, because a guessed 0 would announce that the signal
      // was lifted.
      typeof r.payload.current_signal_level === "number",
  );

  if (!row) return { state: "none" };

  const level = row.payload.current_signal_level as number;
  const tappedAt =
    typeof row.payload.signal_set_at === "string"
      ? row.payload.signal_set_at
      : new Date(row.createdAt).toISOString();

  if (row.blocked) {
    return {
      state: "blocked",
      level,
      tappedAt,
      queueId: row.id,
      reason: row.lastError ?? "",
    };
  }

  return { state: "queued", level, tappedAt };
}
