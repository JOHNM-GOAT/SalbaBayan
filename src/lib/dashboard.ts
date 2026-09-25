import type { AdvisorySnapshot } from "./advisory";
import { allOpenHazards, resolvedHazards, type Hazard } from "./hazards";
import { byMostRecentlyCleared, clearedAt } from "./fixedOrder";
import { namesFor, type NamedPerson } from "./profile";
import { activeQueue, type RescueRequest } from "./sos";
import { allWaterReports, clearedWaterReports, type WaterReport } from "./water";

/**
 * The official's map dashboard: every open SOS, open hazard and recent water
 * report as one list, each with a place on the map.
 *
 * A report with no GPS fix is placed at its area's point and marked `approx`,
 * rather than dropped: "somewhere on Asuncion Street" is still worth a pin, as
 * long as the pin says it is not exact. A water report has a point only when
 * an official pinned it on the map (0047).
 */

export type ItemKind = "sos" | "hazard" | "water";

type Base = {
  id: string;
  lat: number | null;
  lng: number | null;
  /** True when the point is the area's, not the reporter's. */
  approx: boolean;
  ts: string;
  purokId: string | null;
  person: NamedPerson | undefined;
  /**
   * Who cleared it, on the rows where that is a question with an answer.
   *
   * Only hazards have one — water is cleared by an official and goes down on
   * its own, so "who" is the wrong question for it — and only reports resolved
   * since migration 0060, because before that the column did not exist and the
   * honest answer for older rows is "not recorded".
   */
  resolver?: NamedPerson | undefined;
  /**
   * When this was dealt with, for the rows that have been.
   *
   * A separate field rather than overwriting `ts`, because both times are real
   * and the FIXED tab is the only place the second one is the interesting one:
   * everywhere else the question is how long a thing has been waiting, and
   * that is measured from when it was reported.
   */
  doneAt?: string;
};

export type DashItem =
  | (Base & { kind: "sos"; sos: RescueRequest })
  | (Base & { kind: "hazard"; hazard: Hazard })
  | (Base & { kind: "water"; water: WaterReport });

export type Dashboard = {
  sos: DashItem[];
  hazards: DashItem[];
  water: DashItem[];
  /*
   * Reports that are done with: hazards marked fixed, and flood readings an
   * official has cleared. They are deliberately NOT on the map — a pin for a
   * tree that has been cut up is a tree in the road, as far as anyone glancing
   * at the screen is concerned. They are a list, so that "we dealt with that"
   * is something the barangay can point at afterwards.
   */
  fixed: DashItem[];
};

function place(
  snapshot: AdvisorySnapshot | null,
  purokId: string | null,
  lat: number | null,
  lng: number | null,
): { lat: number | null; lng: number | null; approx: boolean } {
  if (lat != null && lng != null) return { lat, lng, approx: false };
  const area = snapshot?.puroks.find((p) => p.id === purokId);
  if (area?.lat != null && area.lng != null) return { lat: area.lat, lng: area.lng, approx: true };
  return { lat: null, lng: null, approx: true };
}

export async function loadDashboard(snapshot: AdvisorySnapshot | null): Promise<Dashboard> {
  /* One timestamp for the whole load, so two rows resolved offline keep a
     stable order between themselves instead of shuffling per map callback. */
  const loadedAt = new Date().toISOString();
  const [sos, hazards, water, doneHazards, doneWater] = await Promise.all([
    activeQueue(),
    allOpenHazards(100),
    allWaterReports(40),
    resolvedHazards(30),
    clearedWaterReports(30),
  ]);
  const people = await namesFor([
    ...sos.map((r) => r.requested_by ?? ""),
    ...hazards.map((h) => h.reported_by ?? ""),
    ...water.map((w) => w.reported_by ?? ""),
    ...doneHazards.map((h) => h.reported_by ?? ""),
    ...doneWater.map((w) => w.reported_by ?? ""),
    // Who cleared each fixed hazard, so the FIXED tab can name them (0060).
    ...doneHazards.map((h) => h.resolved_by ?? ""),
  ]);

  return {
    // Waiting before on-the-way, and within each the longest wait first: the
    // one most at risk is the one easiest to lose in a long list.
    sos: sos
      .map((r): DashItem => ({
        kind: "sos",
        id: r.id,
        ts: r.ts,
        purokId: r.purok_id,
        person: people.get(r.requested_by ?? ""),
        sos: r,
        ...place(snapshot, r.purok_id, r.lat, r.lng),
      }))
      .sort((a, b) => {
        const rank = (i: DashItem) => (i.kind === "sos" && i.sos.status === "pending" ? 0 : 1);
        return rank(a) - rank(b) || a.ts.localeCompare(b.ts);
      }),
    hazards: hazards
      .map((h): DashItem => ({
        kind: "hazard",
        id: h.id,
        ts: h.ts,
        purokId: h.purok_id,
        person: people.get(h.reported_by ?? ""),
        hazard: h,
        ...place(snapshot, h.purok_id, h.lat, h.lng),
      }))
      .sort((a, b) => b.ts.localeCompare(a.ts)),
    water: water
      .map((w): DashItem => ({
        kind: "water",
        id: w.id,
        ts: w.ts,
        purokId: w.purok_id,
        person: people.get(w.reported_by ?? ""),
        water: w,
        ...place(snapshot, w.purok_id, w.lat ?? null, w.lng ?? null),
      }))
      .sort((a, b) => b.ts.localeCompare(a.ts)),
    /*
     * Both kinds together, most recently DEALT WITH first (migration 0061).
     *
     * This used to sort by report time, because hazards recorded no resolution
     * time and water did — so the list was ordered by one clock for one half
     * and would have been ordered by another for the other. The result was
     * that a tree reported on Monday and cut up this morning sat below a
     * puddle reported an hour ago, and an official looking for "what have we
     * just finished" was reading a list ordered by something else entirely.
     *
     * `doneAt` is now one clock for both. Its fallbacks are in `clearedAt`
     * below, and they matter: a row cleared before 0061 has no resolution time
     * and must not invent one.
     */
    fixed: [
      ...doneHazards.map((h): DashItem => ({
        kind: "hazard",
        id: h.id,
        ts: h.ts,
        purokId: h.purok_id,
        person: people.get(h.reported_by ?? ""),
        /* Undefined two different ways, and the screen tells them apart: no
           `resolved_by` at all means the row predates migration 0060, while a
           uid with no name means that device never entered one. */
        resolver: h.resolved_by ? people.get(h.resolved_by) : undefined,
        doneAt: clearedAt(h, loadedAt),
        hazard: h,
        ...place(snapshot, h.purok_id, h.lat, h.lng),
      })),
      ...doneWater.map((w): DashItem => ({
        kind: "water",
        id: w.id,
        ts: w.ts,
        purokId: w.purok_id,
        person: people.get(w.reported_by ?? ""),
        doneAt: w.cleared_at,
        water: w,
        ...place(snapshot, w.purok_id, w.lat ?? null, w.lng ?? null),
      })),
    ].sort(byMostRecentlyCleared),
  };
}

/** Google Maps directions to a point. Only coordinates leave the app — never a name. */
export function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}`;
}
