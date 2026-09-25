/**
 * The order of the FIXED tab.
 *
 * Its own module, type-only imports, for the reason `hazardPermission.ts` and
 * `rescueArrivals.ts` are: a list in the wrong order looks exactly like a list
 * in the right order. Nobody reviewing a screenshot can tell, and the official
 * reading it will simply believe whatever is at the top is the most recent
 * thing the barangay finished.
 *
 * One clock for both kinds. Hazards record `resolved_at` (migration 0061) and
 * water records `cleared_at`, and before those existed the list sorted by when
 * things were REPORTED — so a tree reported on Monday and cut up this morning
 * sat below a puddle reported an hour ago.
 */

import type { Hazard } from "./hazards";

/**
 * When a hazard was cleared. Three cases, two of them the honest handling of a
 * missing value:
 *
 *   - Stamped by Postgres. The answer.
 *   - Still in this device's write queue (`pending`). The resolve happened on
 *     this device moments ago and the server has not stamped it yet, so it
 *     belongs at the TOP — which is where an official who just tapped MARK
 *     FIXED looks for it. Falling back to the report time would bury a report
 *     filed last week halfway down the list they are watching.
 *   - Cleared before the column existed. Nothing knows when, so the report
 *     time stands in: it is the only time those rows carry, and it keeps them
 *     in a stable order rather than a random one.
 */
export function clearedAt(
  hazard: Pick<Hazard, "ts" | "resolved_at" | "pending">,
  /** One timestamp for the whole load, so queued rows do not shuffle. */
  loadedAt: string,
): string {
  if (hazard.resolved_at) return hazard.resolved_at;
  return hazard.pending ? loadedAt : hazard.ts;
}

/** Most recently dealt with first. `doneAt` falls back to the report time. */
export function byMostRecentlyCleared<T extends { ts: string; doneAt?: string }>(
  a: T,
  b: T,
): number {
  return (b.doneAt ?? b.ts).localeCompare(a.doneAt ?? a.ts);
}
