import type { AdvisorySnapshot } from "./advisory";
import { allOpenHazards, type Hazard } from "./hazards";
import { namesFor, type NamedPerson } from "./profile";
import { activeQueue, type RescueRequest } from "./sos";
import { allWaterReports, type WaterReport } from "./water";

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
};

export type DashItem =
  | (Base & { kind: "sos"; sos: RescueRequest })
  | (Base & { kind: "hazard"; hazard: Hazard })
  | (Base & { kind: "water"; water: WaterReport });

export type Dashboard = { sos: DashItem[]; hazards: DashItem[]; water: DashItem[] };

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
  const [sos, hazards, water] = await Promise.all([
    activeQueue(),
    allOpenHazards(100),
    allWaterReports(40),
  ]);
  const people = await namesFor([
    ...sos.map((r) => r.requested_by ?? ""),
    ...hazards.map((h) => h.reported_by ?? ""),
    ...water.map((w) => w.reported_by ?? ""),
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
  };
}

/** Google Maps directions to a point. Only coordinates leave the app — never a name. */
export function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}`;
}
