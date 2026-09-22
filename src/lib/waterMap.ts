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
 * Only the last 24 hours: water moves, and a day-old "chest deep" on a map
 * someone is deciding a route from is worse than nothing.
 */
export const WATER_ON_MAP_MS = 24 * 60 * 60 * 1000;

export const DEPTH_COLOUR: Record<Depth, string> = {
  knee: "var(--color-clear)",
  waist: "var(--color-caution)",
  chest: "var(--color-alarm)",
  above_head: "var(--color-alarm)",
};

export type PlacedWater = { report: WaterReport; lat: number; lng: number; approx: boolean };

export function placeWater(
  snapshot: AdvisorySnapshot | null,
  reports: WaterReport[],
  now: number,
): PlacedWater[] {
  const placed: PlacedWater[] = [];
  for (const report of reports) {
    if (now - Date.parse(report.ts) > WATER_ON_MAP_MS) continue;
    if (report.lat != null && report.lng != null) {
      placed.push({ report, lat: report.lat, lng: report.lng, approx: false });
      continue;
    }
    const area = snapshot?.puroks.find((p) => p.id === report.purok_id);
    if (area?.lat != null && area.lng != null) {
      placed.push({ report, lat: area.lat, lng: area.lng, approx: true });
    }
  }
  return placed;
}
