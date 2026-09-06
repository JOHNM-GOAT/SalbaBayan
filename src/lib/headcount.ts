/**
 * Evacuation centre headcount (PRD §7.8, FR-8.x).
 *
 * The count is never stored. It is `SUM(delta)` over an append-only ledger,
 * and that is the entire design.
 *
 * The obvious implementation — a `count` column that each tap increments — is
 * wrong here in a way that only shows up under exactly the conditions this app
 * is built for. Two volunteers at the same door, both tapping +1 on their own
 * phones, both having read `68`: one writes 69, the other writes 69, and a
 * person has vanished from a building that may be about to flood. Nothing
 * errors. Nobody notices until the count is reconciled against a roll call,
 * which happens after the storm.
 *
 * Append-only removes the failure rather than mitigating it. Two taps are two
 * INSERTs; there is no shared value to overwrite, so there is no race to lose.
 * It also makes the ledger an audit trail: a wrong entry is corrected by
 * appending its opposite, never by editing history.
 */

import { enqueueWrite, newClientId, queuedWrites } from "./offlineQueue";
import { getSupabase } from "./supabase";

// The pure arithmetic lives in ledger.ts so it can be tested without a
// bundler; re-exported here so callers have one import site.
export { totalFrom, capacityState, deviceLabel, clockLabel } from "./ledger";
export type { Capacity } from "./ledger";

export type LedgerEntry = {
  id: string;
  evac_center_id: string;
  delta: number;
  ts: string;
  recorded_by: string | null;
};

export type VulnerabilityBreakdown = {
  medical: number;
  elderly: number;
  infant: number;
};

/**
 * Record a change. `delta` may be any non-zero integer — a family of five
 * arriving together is one `+5`, not five taps, because a volunteer counting
 * people through a door should not have to keep pace with them.
 */
export async function recordDelta(evacCenterId: string, delta: number) {
  if (delta === 0) return null;

  return enqueueWrite("headcounts", {
    id: newClientId(),
    evac_center_id: evacCenterId,
    delta,
    // The moment of counting, not of arrival at the server — a ledger assembled
    // offline must replay in the order it happened.
    ts: new Date().toISOString(),
  });
}

/** The ledger for one centre, newest first. */
export async function ledger(evacCenterId: string, limit = 40): Promise<LedgerEntry[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("headcounts")
    .select("id,evac_center_id,delta,ts,recorded_by")
    .eq("evac_center_id", evacCenterId)
    .order("ts", { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as LedgerEntry[];
}

/** Ledger rows still in the local write queue, shaped like rows. */
export async function queuedLedger(evacCenterId: string): Promise<LedgerEntry[]> {
  const rows = await queuedWrites();
  return rows
    .filter(
      (row) =>
        row.table === "headcounts" &&
        !row.blocked &&
        row.op !== "update" &&
        (row.payload as { evac_center_id?: string }).evac_center_id === evacCenterId,
    )
    .map((row) => {
      const p = row.payload as Partial<LedgerEntry>;
      return {
        id: row.id,
        evac_center_id: p.evac_center_id ?? evacCenterId,
        delta: p.delta ?? 0,
        ts: p.ts ?? new Date(row.createdAt).toISOString(),
        recorded_by: p.recorded_by ?? null,
      };
    });
}

/**
 * Server rows plus anything still queued on this device.
 *
 * A volunteer's own taps must count immediately in the number they are
 * reading. If a `+1` made offline did not move the total, they would tap
 * again — and unlike a duplicate report, a duplicate headcount silently
 * corrupts the figure a rescue decision is made from.
 */
export async function fullLedger(evacCenterId: string): Promise<LedgerEntry[]> {
  const [remote, local] = await Promise.all([
    ledger(evacCenterId),
    queuedLedger(evacCenterId),
  ]);

  const byId = new Map<string, LedgerEntry>();
  for (const row of local) byId.set(row.id, row);
  for (const row of remote) byId.set(row.id, row);

  return [...byId.values()].sort((a, b) => b.ts.localeCompare(a.ts));
}


/**
 * Vulnerability breakdown (FR-8.2).
 *
 * Derived from check-ins rather than the ledger, because a `+1` is
 * deliberately anonymous — a volunteer counting people through a door has no
 * time to ask each one who they are. Staff-only by RLS, which is the point:
 * §9 treats these tags as the most sensitive field in the system.
 *
 * Returns zeros rather than throwing for a resident, so the panel simply shows
 * nothing to someone not entitled to it instead of erroring.
 */
export async function vulnerabilityBreakdown(): Promise<VulnerabilityBreakdown> {
  const empty = { medical: 0, elderly: 0, infant: 0 };

  const supabase = getSupabase();
  if (!supabase) return empty;

  const { data, error } = await supabase
    .from("checkins")
    .select("status, residents(vulnerability_tags)")
    .eq("status", "checked_in");

  if (error || !data) return empty;

  const counts = { ...empty };
  for (const row of data as unknown as {
    residents: { vulnerability_tags: string[] } | null;
  }[]) {
    for (const tag of row.residents?.vulnerability_tags ?? []) {
      if (tag === "medical") counts.medical += 1;
      else if (tag === "elderly") counts.elderly += 1;
      else if (tag === "infant") counts.infant += 1;
    }
  }
  return counts;
}

/** Live ledger updates — another volunteer's tap must land on this screen. */
export function subscribeHeadcounts(onChange: () => void): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};

  const channel = supabase
    .channel("headcount-live")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "headcounts" },
      () => onChange(),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}



