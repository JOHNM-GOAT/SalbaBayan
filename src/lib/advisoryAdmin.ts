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

export async function setAdvisory(
  input: AdvisoryInput & { barangayId: string },
): Promise<WriteOutcome> {
  return enqueueUpdate(
    "barangays",
    input.barangayId,
    toBarangayPatch(input, new Date().toISOString()),
  );
}
