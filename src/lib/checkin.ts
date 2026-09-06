/**
 * Resident check-in (PRD §7.9, FR-9.x).
 *
 * The acceptance criterion is that a manually typed token produces **the same
 * check-in result** as a scanned one. That is not something to verify by
 * comparing two code paths afterwards — it is something to make true by
 * construction. Both the camera and the keyboard produce nothing but a string,
 * and from `normaliseToken` onward there is exactly one path. There is no
 * "scan flow" and no "manual flow" to drift apart.
 *
 * Security here is token uniqueness plus RLS, and is cooperative rather than
 * adversarial (§9). A token is not a secret: it is printed on a card a resident
 * carries. What it protects against is a volunteer mistyping a name at 2am in a
 * crowded hall, not against someone determined to impersonate a neighbour —
 * and the tags it reveals are readable only by staff.
 */

import { enqueueWrite, newClientId, queuedWrites } from "./offlineQueue";
import { getSupabase } from "./supabase";
import { normaliseToken, type CheckinStatus } from "./token";

// Pure token logic lives in token.ts so it can be tested without a bundler.
export { normaliseToken, isPriority, STATUSES, TAG_ORDER } from "./token";
export type { CheckinStatus } from "./token";


export type Resident = {
  id: string;
  name: string;
  purok_id: string;
  qr_token: string;
  vulnerability_tags: string[];
};

export type CheckinRecord = {
  id: string;
  resident_id: string;
  status: CheckinStatus;
  ts: string;
  scanned_by: string | null;
};


export type LookupResult =
  | { found: true; resident: Resident }
  | { found: false; token: string };

/**
 * Resolve a token to a resident. Staff-only by RLS — `read_residents` requires
 * it, so a resident who reaches this screen gets `found: false` rather than a
 * leak.
 */
export async function lookupToken(raw: string): Promise<LookupResult> {
  const token = normaliseToken(raw);

  const supabase = getSupabase();
  if (!supabase) return { found: false, token };

  const { data, error } = await supabase
    .from("residents")
    .select("id,name,purok_id,qr_token,vulnerability_tags")
    .eq("qr_token", token)
    .maybeSingle();

  if (error || !data) return { found: false, token };
  return { found: true, resident: data as Resident };
}

/**
 * Log a status against a resident (FR-9.2).
 *
 * Through the write queue like everything else: a volunteer at the gate of a
 * centre with no signal must still be able to check people in, and the roll
 * they build is the record used to decide who is unaccounted for.
 */
export async function recordCheckin(residentId: string, status: CheckinStatus) {
  return enqueueWrite("checkins", {
    id: newClientId(),
    resident_id: residentId,
    status,
    // When the person was actually seen, not when the row reached the server.
    ts: new Date().toISOString(),
  });
}



export async function recentCheckins(limit = 20): Promise<CheckinRecord[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("checkins")
    .select("id,resident_id,status,ts,scanned_by")
    .order("ts", { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as CheckinRecord[];
}

/** Check-ins still on this device, so a volunteer sees their own roll build. */
export async function queuedCheckins(): Promise<CheckinRecord[]> {
  const rows = await queuedWrites();
  return rows
    .filter((row) => row.table === "checkins" && !row.blocked && row.op !== "update")
    .map((row) => {
      const p = row.payload as Partial<CheckinRecord>;
      return {
        id: row.id,
        resident_id: p.resident_id ?? "",
        status: (p.status ?? "checked_in") as CheckinStatus,
        ts: p.ts ?? new Date(row.createdAt).toISOString(),
        scanned_by: p.scanned_by ?? null,
      };
    });
}

export async function allCheckins(limit = 20): Promise<CheckinRecord[]> {
  const [remote, local] = await Promise.all([recentCheckins(limit), queuedCheckins()]);

  const byId = new Map<string, CheckinRecord>();
  for (const row of local) byId.set(row.id, row);
  for (const row of remote) byId.set(row.id, row);

  return [...byId.values()]
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, limit);
}

/** Names for the recent list. Staff-only, same as the lookup. */
export async function residentsByIds(ids: string[]): Promise<Map<string, Resident>> {
  const map = new Map<string, Resident>();
  if (ids.length === 0) return map;

  const supabase = getSupabase();
  if (!supabase) return map;

  const { data } = await supabase
    .from("residents")
    .select("id,name,purok_id,qr_token,vulnerability_tags")
    .in("id", ids);

  for (const row of (data ?? []) as Resident[]) map.set(row.id, row);
  return map;
}
