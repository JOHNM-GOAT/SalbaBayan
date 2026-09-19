/**
 * When the write queue gives up on a row.
 *
 * Its own module, with no imports, for the same reason `hazardPermission.ts`
 * and `ledger.ts` are: this is a rule rather than plumbing, it is the kind of
 * rule that is wrong in ways nobody notices, and `offlineQueue.ts` cannot be
 * imported by a test without dragging Dexie and a Supabase client into Node.
 *
 * The specific failure it exists to prevent, stated plainly: a row that is
 * `blocked` is stepped over and never retried automatically again. On a
 * resident's phone the row at the head of the queue is usually their SOS. So
 * the question "may this row be given up on" is a question about whether a
 * distress call is allowed to be quietly set aside, and it is worth being able
 * to test the answer without a browser.
 */

/**
 * Postgres SQLSTATEs that mean "this row will never be accepted, no matter how
 * many times it is retried". Schema and constraint violations only.
 *
 * Deliberately NOT in this list:
 *   - 42501 (insufficient privilege / RLS). It looks permanent but is not: a
 *     write queued before the anonymous session existed carries no owner, and
 *     the same row succeeds once there is an identity to stamp it with.
 *   - PGRST301 and friends (expired JWT). A refresh fixes those.
 *
 * The bias is deliberate: keep retrying unless the row provably cannot land.
 * Retrying a write that will never succeed costs a request; giving up on one
 * that would have succeeded loses a resident's report.
 */
export const PERMANENT_FAILURES = new Set([
  "22003", // numeric value out of range
  "22007", // invalid datetime format
  "22P02", // invalid text representation
  "23502", // not-null violation
  "23503", // foreign key violation
  "23514", // check constraint violation
  "PGRST204", // column not found — client/schema mismatch
]);

/**
 * Retry ceiling for failures the SERVER answered and refused. It exists only so
 * an unforeseen poison row cannot block the queue forever.
 */
export const MAX_ATTEMPTS = 20;

export function isPermanent(code: string | undefined): boolean {
  return code !== undefined && PERMANENT_FAILURES.has(code);
}

/**
 * A failure that never reached Postgres at all.
 *
 * supabase-js reports a dead fetch the same way it reports a rejected row — an
 * `error` object — but with no SQLSTATE, because there was no statement. That
 * distinction is load-bearing, and missing it was a safety bug.
 *
 * The ceiling used to apply to these too. A flush only runs when
 * `navigator.onLine` is true, which the browser reports for a captive portal
 * and for a tower that is up and answering nothing — both named in
 * `startQueueFlushListener` as the expected mid-storm condition. Twenty polls
 * at 30s is ten minutes, after which the head of the queue was blocked and
 * stepped over for good.
 *
 * Nothing is lost by exempting them: a poison row is defined by the server
 * refusing it, and the server cannot refuse a request it never received.
 */
export function isTransportFailure(code: string | undefined): boolean {
  return !code;
}

export type Verdict = {
  /** What to store as the row's attempt count after this failure. */
  attempts: number;
  /** True to mark the row blocked — stepped over, and not retried again. */
  blocked: boolean;
};

/**
 * The decision, in one place.
 *
 * `attempts` counts SERVER REFUSALS, not flush attempts. A row that has been
 * sitting behind a dead connection for two days still reads `attempts: 0`,
 * which is the honest number: nothing has judged it yet.
 */
export function failureVerdict(
  code: string | undefined,
  attempts: number,
): Verdict {
  if (isPermanent(code)) return { attempts: attempts + 1, blocked: true };

  if (isTransportFailure(code)) {
    // Untouched. The row keeps its place in insertion order and retries on the
    // next poll, which is exactly what an outage is supposed to produce.
    return { attempts, blocked: false };
  }

  const next = attempts + 1;
  return { attempts: next, blocked: next >= MAX_ATTEMPTS };
}

/**
 * The payload an UPDATE should carry when another update to the same row is
 * already waiting in the queue.
 *
 * `enqueueUpdate` keys a row's update as `<id>:update`, so a second update to
 * the same row lands in the same slot. It used to REPLACE the first, which was
 * harmless while each row had a single kind of update. It stopped being
 * harmless when the barangay row got two: an official who issued Signal 4
 * offline and then entered the household count would have had the signal
 * change silently discarded — the second write overwrote the first.
 *
 * So the waiting update and the new one are merged field by field, the new
 * value winning where both set the same field. A BLOCKED waiting update is not
 * merged into: it was refused, and folding it into a fresh attempt would resend
 * the refused change under a new write the person did not know carried it.
 */
export function mergeUpdatePayload(
  waiting: { payload: Record<string, unknown>; blocked?: boolean } | undefined,
  patch: Record<string, unknown>,
  id: string,
): Record<string, unknown> {
  if (!waiting || waiting.blocked) return { ...patch, id };
  return { ...waiting.payload, ...patch, id };
}
