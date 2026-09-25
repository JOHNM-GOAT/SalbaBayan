import type { Blocker } from "./walkRoute";
import type { Depth } from "./water";
import type { PlacedWater } from "./waterMap";

/**
 * What stops a person walking, and therefore what a route goes round.
 *
 * This is a safety judgement, not a geometry problem, so it is one small file
 * on its own rather than a condition buried in the router. Two things decide
 * it: what was reported, and how sure we are of where it is.
 *
 * Type-only imports, so the test can load this in plain Node.
 */

/**
 * How wide a berth a report is given.
 *
 * The same 30 m as `BLOCKED_RADIUS_M` in lib/geo.ts, which decides whether a
 * hazard counts as sitting ON a route — the two answers have to agree, or the
 * map would route round something it does not warn about, or warn about
 * something it did not route round. scripts/walkroute-test.mjs checks that.
 *
 * Generous on purpose. The reported position carries tens of metres of error,
 * and a tree across a road blocks more than the square metre it fell on.
 */
export const BLOCK_RADIUS_M = 30;

/**
 * Depths that stop a person on foot.
 *
 * Knee-deep water is passable, and treating it as a wall would send people the
 * long way round — sometimes into worse — for water they can walk through.
 * From the waist up it is not passable in a current, which is the situation
 * these readings are filed in. The scale is the body-referenced one residents
 * report against (lib/water.ts), so this needs no conversion and no guessing.
 */
const STOPS_A_PERSON: Depth[] = ["waist", "chest", "above_head"];

/** Enough of a hazard to route round it. */
export type PlacedHazard = { lat: number | null; lng: number | null };

/**
 * Everything the route should avoid, as circles on the ground.
 *
 * Hazards: every open one with a position. A fallen tree, a blocked road and a
 * downed line all stop a family walking, and "other" is reported by someone who
 * thought it was worth reporting — the cost of going round something passable
 * is a longer walk, and the cost of walking into a live wire is not comparable.
 *
 * Water: only readings that are BOTH deep enough and fresh. A stale reading is
 * already drawn faded and dated rather than trusted (lib/waterMap.ts), and
 * water moves — routing a family the long way round this morning's flood is
 * the same mistake as ignoring one that is there now, in the other direction.
 */
export function routeBlockers(hazards: PlacedHazard[], water: PlacedWater[]): Blocker[] {
  const blockers: Blocker[] = [];

  for (const hazard of hazards) {
    if (hazard.lat == null || hazard.lng == null) continue;
    blockers.push({ at: [hazard.lng, hazard.lat], radiusM: BLOCK_RADIUS_M });
  }

  for (const reading of water) {
    if (reading.stale) continue;
    if (!STOPS_A_PERSON.includes(reading.report.level_category)) continue;
    /*
     * A reading placed on its street's point rather than its own is "somewhere
     * on this street". It is still avoided — that is what the radius is for —
     * but it is not given a wider one, because widening it on the least exact
     * reports is how a whole barangay becomes unroutable.
     */
    blockers.push({ at: [reading.lng, reading.lat], radiusM: BLOCK_RADIUS_M });
  }

  return blockers;
}
