/**
 * The official changes the advisory (PRD §4).
 *
 * Through the offline queue like every other write — an official at a barangay
 * hall with a failing connection must still be able to issue a warning, and a
 * change that evaporated would be worse than one that arrives late. What makes
 * a late one safe is that it is never hidden: the NOT SENT banner
 * (lib/pendingAdvisory.ts) says so until it lands.
 *
 * The history row is not written here. The record_signal_history trigger writes
 * it in the same statement as the change, so the change and its record cannot
 * be separated.
 */

import { enqueueUpdate, type WriteOutcome } from "./offlineQueue";
import { toBarangayPatch, type AdvisoryInput } from "./advisoryForm";
import { getSupabase } from "./supabase";

export async function setAdvisory(
  input: AdvisoryInput & { barangayId: string },
): Promise<WriteOutcome> {
  return enqueueUpdate(
    "barangays",
    input.barangayId,
    toBarangayPatch(input, new Date().toISOString()),
  );
}

export type SignalHistoryRow = {
  id: string;
  level: number;
  set_by: string | null;
  set_at: string | null;
  received_at: string;
};

/**
 * The barangay's last ten advisory changes, newest first.
 *
 * `null` means the history could not be READ — offline, most often, since this
 * is not cached. The screen says so instead of rendering an empty list, which
 * would read as "the signal has never been changed".
 *
 * For a non-official, RLS answers with zero rows rather than an error, which is
 * indistinguishable from an empty history. The screen only asks on an official's
 * behalf, so an empty array here genuinely means no changes have been recorded.
 */
export async function recentSignalHistory(
  barangayId: string,
): Promise<SignalHistoryRow[] | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("signal_history")
    .select("id,level,set_by,set_at,received_at")
    .eq("barangay_id", barangayId)
    .order("received_at", { ascending: false })
    .limit(10);

  if (error) return null;
  return (data ?? []) as SignalHistoryRow[];
}
