import type { AdvisorySnapshot } from "./advisory";
import type { Depth, WaterReport } from "./water";

/**
 * Water readings on the residents' and volunteers' maps.
 *
 * A reading pinned by an official carries its own point (0047). One filed from
 * the report screen has a point only if the reporter chose to attach their
 * location; otherwise it sits on its street's point and is drawn faded, the
 * same rule the official dashboard uses.
 *
 * Every reading is shown, the old ones included — an official watching the
 * dashboard and a resident reading the map should not be looking at different
 * floods. What age changes is how it is drawn: water moves, so a reading past
 * FRESH_WATER_MS is faded and carries its age, rather than standing on the map
 * as though it were current.
 */
export const FRESH_WATER_MS = 3 * 60 * 60 * 1000;

export const DEPTH_COLOUR: Record<Depth, string> = {
  knee: "var(--color-clear)",
  waist: "var(--color-caution)",
  chest: "var(--color-alarm)",
  above_head: "var(--color-alarm)",
};

export type PlacedWater = {
  report: WaterReport;
  lat: number;
  lng: number;
  /** The point is its street's, not the reporter's. */
  approx: boolean;
  /** Older than FRESH_WATER_MS: still shown, drawn faded, age stated. */
  stale: boolean;
};

/** How a reading is drawn for its age and how exact its point is. */
export function waterOpacity(placed: PlacedWater): string {
  if (placed.stale) return "0.45";
  return placed.approx ? "0.7" : "1";
}

export function placeWater(
  snapshot: AdvisorySnapshot | null,
  reports: WaterReport[],
  now: number,
): PlacedWater[] {
  const placed: PlacedWater[] = [];
  for (const report of reports) {
    const stale = now - Date.parse(report.ts) > FRESH_WATER_MS;
    if (report.lat != null && report.lng != null) {
      placed.push({ report, lat: report.lat, lng: report.lng, approx: false, stale });
      continue;
    }
    const area = snapshot?.puroks.find((p) => p.id === report.purok_id);
    if (area?.lat != null && area.lng != null) {
      placed.push({ report, lat: area.lat, lng: area.lng, approx: true, stale });
    }
  }
  return placed;
}
