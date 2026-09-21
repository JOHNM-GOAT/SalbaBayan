import { enqueueWrite, newClientId, queuedWrites } from "./offlineQueue";
import { getSupabase } from "./supabase";

/**
 * Counting people in by scanning the QR on a resident's ME tab (migration
 * 0034). The QR holds the bare 8-character device code.
 *
 * The database decides whether a scan counts — a phone counts once per 3 days —
 * because scans queue offline and two volunteers may scan the same phone with
 * no signal between them. What this module adds is telling the volunteer
 * BEFORE they count, whenever this phone or the server already knows.
 */

export const REPEAT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** The device code in a scanned or typed string, or null if it is not one. */
export function deviceCodeIn(raw: string): string | null {
  const code = raw.replace(/[\s-]/g, "").toUpperCase();
  return /^[0-9A-F]{8}$/.test(code) ? code : null;
}

export type Arrival = { ts: string; people: number };

/**
 * The counted arrival for this phone in the last 3 days and since the current
 * evacuation began, if any is known.
 */
export async function recentArrival(
  code: string,
  evacuationStart: string | null,
): Promise<Arrival | null> {
  const since = Math.max(Date.now() - REPEAT_WINDOW_MS, evacuationStart ? Date.parse(evacuationStart) : 0);

  const local = (await queuedWrites())
    .filter((row) => row.table === "device_checkins" && !row.blocked)
    .map((row) => row.payload as { device_code?: string; ts?: string; people?: number })
    .find((p) => p.device_code === code && p.ts && Date.parse(p.ts) > since);
  if (local?.ts && local.people) return { ts: local.ts, people: local.people };

  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from("device_checkins")
      .select("ts,people")
      .eq("device_code", code)
      .eq("counted", true)
      .gte("ts", new Date(since).toISOString())
      .order("ts", { ascending: false })
      .limit(1);
    const row = data?.[0];
    return row ? { ts: row.ts as string, people: row.people as number } : null;
  } catch {
    // Offline: the database still refuses a double count when the scan syncs.
    return null;
  }
}

/** Count this phone's group in at the centre. Queued, so it works offline. */
export function countDeviceIn(code: string, evacCenterId: string, people: number) {
  return enqueueWrite("device_checkins", {
    id: newClientId(),
    device_code: code,
    evac_center_id: evacCenterId,
    people,
    ts: new Date().toISOString(),
  });
}
