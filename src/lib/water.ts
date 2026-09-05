/**
 * Community water-level reporting (PRD §7.6, FR-6.x).
 *
 * The design constraint that drives everything here: **no numeric entry**.
 * Someone standing in rising water cannot measure it, and asking them to
 * estimate centimetres produces numbers that are confident and wrong. A
 * body-referenced scale is answerable by anyone, needs no calibration, and is
 * comparable between reporters — a stranger's "waist-deep" means something,
 * their "60cm" does not.
 */

import { enqueueWrite, newClientId, queuedWrites } from "./offlineQueue";
import { getSupabase } from "./supabase";

/**
 * The scale, in order. Stored as text rather than a number so the database
 * carries the same meaning the reporter chose, not an interpretation of it.
 */
export const DEPTHS = ["knee", "waist", "chest", "above_head"] as const;
export type Depth = (typeof DEPTHS)[number];

export type WaterReport = {
  id: string;
  purok_id: string;
  location_label: string | null;
  level_category: Depth;
  ts: string;
  reported_by: string | null;
};

/**
 * Severity of a depth, for colouring.
 *
 * This deliberately does NOT use the signal ramp — that means storm severity
 * and nothing else. Water depth gets the state colours, so a chest-deep report
 * can never be mistaken for a signal level.
 */
export const DEPTH_TONE: Record<Depth, string> = {
  knee: "text-clear",
  waist: "text-caution",
  chest: "text-alarm",
  above_head: "text-alarm",
};

/**
 * File a report. Goes through the offline queue like every other write, so a
 * report made while wading through a dead zone is kept and sent later.
 *
 * `ts` is set from the client for the same reason as an SOS: it is when the
 * water was actually seen. A report queued for an hour and stamped on arrival
 * would tell responders the flood is current when it is an hour stale — worse
 * than useless for deciding where to send a boat.
 */
export async function submitWaterReport(input: {
  purokId: string;
  depth: Depth;
  locationLabel?: string;
}) {
  return enqueueWrite("water_reports", {
    id: newClientId(),
    purok_id: input.purokId,
    level_category: input.depth,
    location_label: input.locationLabel?.trim() || null,
    ts: new Date().toISOString(),
  });
}

/** Most recent reports first. RLS allows any signed-in resident to read. */
export async function recentWaterReports(limit = 12): Promise<WaterReport[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("water_reports")
    .select("id,purok_id,location_label,level_category,ts,reported_by")
    .order("ts", { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as WaterReport[];
}

/**
 * Reports still in the local write queue, shaped like rows.
 *
 * Without this a reporter does not see their own report. The submit returns as
 * soon as the write is durable on the device, so a re-read immediately after
 * races the flush and comes back stale; and the originating tab cannot rely on
 * its own Realtime echo to fill the gap. Offline it is worse still — the report
 * would not appear at all.
 *
 * That matters more than it sounds: someone who files a report, sees nothing
 * in the list, and concludes it failed will file it again. Duplicate flood
 * reports from the same street are exactly the noise responders cannot afford.
 */
export async function queuedWaterReports(): Promise<WaterReport[]> {
  const rows = await queuedWrites();
  return rows
    .filter((row) => row.table === "water_reports" && !row.blocked)
    .map((row) => {
      const p = row.payload as Partial<WaterReport>;
      return {
        id: row.id,
        purok_id: p.purok_id ?? "",
        location_label: p.location_label ?? null,
        level_category: (p.level_category ?? "knee") as Depth,
        ts: p.ts ?? new Date(row.createdAt).toISOString(),
        reported_by: p.reported_by ?? null,
      };
    });
}

/**
 * Server rows and still-queued ones together, newest first. Server wins on id
 * collision — once a report has landed, that copy is authoritative.
 */
export async function allWaterReports(limit = 12): Promise<WaterReport[]> {
  const [remote, local] = await Promise.all([
    recentWaterReports(limit),
    queuedWaterReports(),
  ]);

  const byId = new Map<string, WaterReport>();
  for (const row of local) byId.set(row.id, row);
  for (const row of remote) byId.set(row.id, row);

  return [...byId.values()]
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, limit);
}

/**
 * Live updates (FR-6.3, and the §7.6 acceptance criterion: a report reaches a
 * second connected device within five seconds, with no refresh).
 */
export function subscribeWaterReports(onChange: () => void): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};

  const channel = supabase
    .channel("water-live")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "water_reports" },
      () => onChange(),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

/** "4 MIN" / "2 ORAS" — coarse on purpose; exact seconds are noise here. */
export function agoLabel(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "NGAYON";
  if (minutes < 60) return `${minutes} MIN`;
  return `${Math.floor(minutes / 60)} ORAS`;
}
