/**
 * Community hazard reports (PRD §7.7, FR-7.x).
 *
 * No moderation queue, by design (FR-7.1). A report from a resident appears
 * to the barangay immediately, with no official in between. The reasoning is
 * the same one behind the whole product: a blocked road is time-critical
 * information, and a queue that holds it for review turns a five-second
 * warning into a thirty-minute one. Attribution and the ability to resolve are
 * what keep it accountable instead.
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import { enqueueUpdate, enqueueWrite, newClientId, queuedWrites } from "./offlineQueue";
import { queuePhoto } from "./photoQueue";
import { getCurrentUserId, getMyRole, getSupabase, type UserRole } from "./supabase";
import { canResolveHazard as decide } from "./hazardPermission";
import { mergeHazards, queuedInserts, queuedPatches } from "./hazardMerge";
import { currentFix } from "./sos";

/**
 * Order is the on-screen order, and flooding leads deliberately: it is both
 * the most common report in a typhoon and the one that opens the depth scale,
 * so it should be the first thing a thumb lands on. This matches the approved
 * report artboard, where BAHA sits first.
 */
export const CATEGORIES = [
  "flooding",
  "fallen_tree",
  "blocked_road",
  "downed_lines",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type HazardStatus = "open" | "resolved";

export type Hazard = {
  id: string;
  purok_id: string;
  category: Category;
  description: string | null;
  photo_url: string | null;
  status: HazardStatus;
  ts: string;
  lat: number | null;
  lng: number | null;
  reported_by: string | null;
  /** Carries a local change the server has not accepted yet (lib/hazardMerge). */
  pending?: boolean;
};

/**
 * Severity weight per category, for the feed's left rail.
 *
 * State colours, never the signal ramp. Downed lines rank with flooding
 * because both can kill someone who walks into them in the dark; a fallen tree
 * is usually an obstacle rather than a hazard to life.
 */
export const CATEGORY_TONE: Record<Category, "alarm" | "caution"> = {
  downed_lines: "alarm",
  flooding: "alarm",
  blocked_road: "caution",
  fallen_tree: "caution",
  other: "caution",
};

/**
 * File a hazard report.
 *
 * The photo is deliberately NOT awaited into the row. It is handed to the
 * photo queue and uploaded separately (see lib/photoQueue.ts), so a report of
 * a downed power line is not sitting on someone's phone waiting for 4 MB to
 * clear a dying tower.
 */
export async function submitHazard(input: {
  purokId: string;
  category: Category;
  description?: string;
  photo?: Blob | null;
}) {
  const id = newClientId();
  const fix = currentFix();

  const outcome = await enqueueWrite("hazard_reports", {
    id,
    purok_id: input.purokId,
    category: input.category,
    description: input.description?.trim() || null,
    status: "open",
    // A fix if there is one, nothing if there is not. Same rule as the SOS:
    // the report is never blocked on GPS, and a hazard with no coordinates
    // still reaches the feed with its Purok.
    lat: fix?.lat ?? null,
    lng: fix?.lng ?? null,
    ts: new Date().toISOString(),
  });

  if (input.photo) await queuePhoto(id, input.photo);

  return outcome;
}

/**
 * Resolve a report (FR-7.2). Through the queue, because a volunteer clearing a
 * road is exactly the person likely to be standing in a dead zone while doing
 * it — and a resolve that evaporates leaves the barangay avoiding a road that
 * is already clear.
 */
export async function resolveHazard(id: string): Promise<void> {
  await enqueueUpdate("hazard_reports", id, { status: "resolved" });
}

/**
 * Reports from the server, BOTH statuses.
 *
 * This used to filter `status = 'open'` in the query, which made the resolved
 * half of the feed unreachable and — worse — made the merge below unable to do
 * its job: a row the server still calls open but this device has locally
 * resolved has to be moved between the two lists, and you cannot move a row you
 * did not fetch. The status filter now happens after the queue is folded in,
 * which is the only place it can be correct.
 */
export async function fetchHazards(limit = 60): Promise<Hazard[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("hazard_reports")
    .select("id,purok_id,category,description,photo_url,status,ts,lat,lng,reported_by")
    .order("ts", { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as Hazard[];
}

/**
 * Reports still in the local write queue, shaped like rows.
 *
 * Same reasoning as the water feed: a reporter who sees nothing after filing
 * assumes it failed and files again, and duplicate hazard reports for one
 * street are the noise responders can least afford.
 */
const fromQueuePayload = (
  p: Record<string, unknown>,
  id: string,
  ts: string,
): Hazard => ({
  id,
  purok_id: (p.purok_id as string) ?? "",
  category: (p.category as Category) ?? "other",
  description: (p.description as string | null) ?? null,
  photo_url: null,
  status: ((p.status as HazardStatus) ?? "open") as HazardStatus,
  ts,
  lat: (p.lat as number | null) ?? null,
  lng: (p.lng as number | null) ?? null,
  reported_by: (p.reported_by as string | null) ?? null,
  // Still in the queue, so the server has not seen it by definition.
  pending: true,
});

export async function queuedHazards(): Promise<Hazard[]> {
  return queuedInserts<Hazard>(await queuedWrites(), fromQueuePayload);
}

/**
 * Every report this device knows about, newest first, with the local write
 * queue folded in — including the resolves sitting in it.
 *
 * That last part is the fix for "I marked it fixed and it still says
 * UNRESOLVED". See lib/hazardMerge.ts for why a queued update has to be applied
 * as a patch rather than filtered out.
 */
export async function allHazards(limit = 60): Promise<Hazard[]> {
  const [remote, rows] = await Promise.all([fetchHazards(limit), queuedWrites()]);
  const local = queuedInserts<Hazard>(rows, fromQueuePayload);

  return mergeHazards<Hazard>(remote, local, queuedPatches(rows)).slice(0, limit);
}

/** Still unresolved — what the hazard map pins and what the count counts. */
export async function allOpenHazards(limit = 30): Promise<Hazard[]> {
  const all = await allHazards(Math.max(limit * 2, 60));
  return all.filter((h) => h.status === "open").slice(0, limit);
}

/** Marked fixed, including fixes this device has not managed to send yet. */
export async function resolvedHazards(limit = 30): Promise<Hazard[]> {
  const all = await allHazards(Math.max(limit * 2, 60));
  return all.filter((h) => h.status === "resolved").slice(0, limit);
}

/**
 * Realtime, not polling (FR-7.3, and the §7.7 acceptance criterion: a hazard
 * reported offline reaches every connected client within five seconds of the
 * reporter reconnecting).
 *
 * Listens for UPDATE as well as INSERT — a resolve has to disappear from every
 * feed as promptly as a new report appears in it.
 */
let liveChannel: RealtimeChannel | null = null;
const liveListeners = new Set<() => void>();

export function subscribeHazards(onChange: () => void): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};

  /*
   * One channel, many listeners — the same shape `subscribeRescue` uses, and
   * for the same reason it had to grow one.
   *
   * A channel name is global to the client. This used to build a new
   * `hazards-live` per caller, which was fine while exactly one screen watched
   * hazards. The hazard sheet is mounted in the layout, so it now watches on
   * every route — and the moment the report screen subscribed alongside it,
   * supabase-js threw outright:
   *
   *   cannot add `postgres_changes` callbacks for realtime:hazards-live
   *   after `subscribe()`
   *
   * The second caller reaches for a channel that already exists and is already
   * subscribed. Multiplexing here means callers never have to know how many
   * other screens are listening, which is the only version of this that stays
   * correct as screens are added.
   */
  liveListeners.add(onChange);

  if (!liveChannel) {
    liveChannel = supabase
      .channel("hazards-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hazard_reports" },
        () => {
          // Copied before notifying: a listener may unsubscribe in response.
          for (const listener of [...liveListeners]) listener();
        },
      )
      .subscribe();
  }

  return () => {
    liveListeners.delete(onChange);

    // Tear the channel down only when nobody is left, and drop the reference
    // first so a subscriber arriving mid-teardown builds a fresh one.
    if (liveListeners.size === 0 && liveChannel) {
      const channel = liveChannel;
      liveChannel = null;
      void supabase.removeChannel(channel);
    }
  };
}

/*
 * The rule itself lives in lib/hazardPermission.ts — no imports, so it can be
 * tested in Node without dragging Dexie and a Supabase client along. Re-exported
 * here because this is where callers already look for it.
 */
export { canResolveHazard } from "./hazardPermission";

/** Async convenience for callers that hold neither the uid nor the role. */
export async function canResolve(hazard: Hazard): Promise<boolean> {
  const [uid, role] = await Promise.all([
    getCurrentUserId(),
    getMyRole().catch((): UserRole | null => null),
  ]);
  return decide(hazard, uid, role);
}
