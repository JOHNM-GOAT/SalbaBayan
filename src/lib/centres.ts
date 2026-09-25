import type { AdvisorySnapshot, EvacCenter } from "./advisory";
import { metresBetween, metresToSegment, type Point } from "./geo";
import { enqueueUpdate, enqueueWrite, newClientId } from "./offlineQueue";
import {
  buildWalkGraph,
  routeDescription,
  walkRoute,
  type Blocker,
  type Streets,
  type WalkGraph,
} from "./walkRoute";

/**
 * Evacuation centres: up to three per barangay (migration 0047), each person
 * sent to the nearest one.
 *
 * "Nearest" is walking distance along the streets, not a straight line — a
 * centre across a block or a creek can be close on paper and far on foot. The
 * same street file and router draw every route (lib/walkRoute.ts), on the
 * phone, so it works offline.
 */

export const MAX_CENTRES = 3;

/* ---------------------------------------------------------------------------
 * Streets
 * ------------------------------------------------------------------------ */

let streetsLoad: Promise<Streets | null> | null = null;

/** The precached street file, fetched once per page load. */
export function loadStreets(): Promise<Streets | null> {
  streetsLoad ??= fetch("/geo/streets.json")
    .then((r) => (r.ok ? (r.json() as Promise<Streets>) : null))
    .catch(() => {
      streetsLoad = null; // try again next time
      return null;
    });
  return streetsLoad;
}

const graphs = new WeakMap<Streets, WalkGraph>();

/** The walking graph for a street file, built once. */
export function graphFor(streets: Streets): WalkGraph {
  let graph = graphs.get(streets);
  if (!graph) {
    graph = buildWalkGraph(streets);
    graphs.set(streets, graph);
  }
  return graph;
}

/**
 * The named street closest to a point, if one is within 40 m — what an
 * official means by "I tapped Asuncion Street".
 */
export function nearestStreet(streets: Streets | null, point: Point): string | null {
  let best: string | null = null;
  let bestMetres = 40;
  for (const feature of streets?.features ?? []) {
    const name = feature.properties?.name;
    if (!name || feature.geometry?.type !== "LineString") continue;
    const line = feature.geometry.coordinates;
    for (let i = 1; i < line.length; i++) {
      const d = metresToSegment(point, line[i - 1], line[i]);
      if (d < bestMetres) {
        bestMetres = d;
        best = name;
      }
    }
  }
  return best;
}

/**
 * Which area a pinned point belongs to. Callaguip's areas are its streets, so
 * the tapped street's own area first; otherwise the area whose starting point
 * is closest.
 */
export function areaFor(snapshot: AdvisorySnapshot, street: string | null, point: Point): string | null {
  const byName = street
    ? snapshot.puroks.find((p) => p.name.toLowerCase() === street.toLowerCase())
    : undefined;
  if (byName) return byName.id;

  let best: string | null = null;
  let bestMetres = Infinity;
  for (const area of snapshot.puroks) {
    if (area.lat == null || area.lng == null) continue;
    const d = metresBetween(point, [area.lng, area.lat]);
    if (d < bestMetres) {
      bestMetres = d;
      best = area.id;
    }
  }
  return best ?? snapshot.puroks[0]?.id ?? null;
}

/* ---------------------------------------------------------------------------
 * Nearest centre
 * ------------------------------------------------------------------------ */

export type RankedCentre = {
  centre: EvacCenter;
  /** Walking metres, or straight-line metres when there is no street graph. */
  metres: number;
  /** The walk, from the starting point to the centre. Null without a graph. */
  line: Point[] | null;
  via: string[];
  /**
   * This walk goes the long way round a hazard or deep water. The shorter way
   * exists and is blocked; the resident is being sent round it on purpose, so
   * the screen says so rather than quietly adding four minutes.
   */
  detour: boolean;
  /**
   * Every way there passes something impassable. The route shown is the direct
   * one, because a resident in a storm must never be handed a blank map — but
   * it is marked, and the warning above it names what is in the way.
   */
  unavoidable: boolean;
};

/**
 * Every placed centre, nearest first — and "nearest" means the one this person
 * can actually walk to.
 *
 * With `avoid` given, each centre is routed twice: once round the hazards and
 * once ignoring them. The route round is the one shown. Which is shorter on
 * paper stops being the question the moment a street is under chest-deep water:
 * a clear 600 m beats a blocked 300 m, so an unavoidable centre ranks below
 * every reachable one however close it is.
 */
export function rankCentres(
  graph: WalkGraph | null,
  from: Point,
  centres: EvacCenter[],
  avoid: Blocker[] = [],
): RankedCentre[] {
  const ranked: RankedCentre[] = [];
  for (const centre of centres) {
    if (centre.lat == null || centre.lng == null) continue;
    const to: Point = [centre.lng, centre.lat];

    /*
     * The direct walk, and the walk that keeps clear. Both are needed to say
     * anything true: the direct one alone cannot tell a detour from a route
     * that was always this long, and the clear one alone cannot tell "there was
     * nothing in the way" from "there was no way round".
     */
    const direct = graph ? walkRoute(graph, from, to) : null;
    const clear = graph && avoid.length > 0 ? walkRoute(graph, from, to, { avoid }) : direct;

    const route = clear ?? direct;
    const unavoidable = avoid.length > 0 && clear === null && direct !== null;
    const detour = clear !== null && direct !== null && clear.metres > direct.metres;

    if (!route) {
      ranked.push({
        centre,
        metres: Math.round(metresBetween(from, to)),
        line: null,
        via: [],
        detour: false,
        unavoidable: false,
      });
      continue;
    }
    /* The router walks from the street node nearest each end; the steps to
       and from those nodes are part of the walk too. */
    const line: Point[] = [...route.line];
    if (line.length === 0 || metresBetween(from, line[0]) > 3) line.unshift(from);
    if (metresBetween(line[line.length - 1], to) > 3) line.push(to);
    const metres =
      route.metres +
      (route.line.length ? metresBetween(from, route.line[0]) + metresBetween(route.line[route.line.length - 1], to) : 0);
    ranked.push({ centre, metres: Math.round(metres), line, via: route.via, detour, unavoidable });
  }
  /* Reachable before blocked, and within each the nearest first. */
  return ranked.sort(
    (a, b) => Number(a.unavoidable) - Number(b.unavoidable) || a.metres - b.metres,
  );
}

/* ---------------------------------------------------------------------------
 * Adding, editing and removing a centre (officials; RLS enforces it)
 * ------------------------------------------------------------------------ */

/**
 * Point every area's protocols at its nearest centre and redraw the routes.
 * All routes are computed before anything is queued, and only rows that
 * actually change are written.
 */
async function reroute(
  snapshot: AdvisorySnapshot,
  centres: EvacCenter[],
  streets: Streets | null,
  /** A queued write these routes only make sense after — a centre being added. */
  dependsOn?: string,
) {
  const graph = streets ? graphFor(streets) : null;
  const writes: { id: string; patch: Record<string, unknown> }[] = [];

  for (const area of snapshot.puroks) {
    if (area.lat == null || area.lng == null) continue;
    const from: Point = [area.lng, area.lat];
    const best = rankCentres(graph, from, centres)[0];
    if (!best) continue;
    const line = best.line ?? [from, [best.centre.lng as number, best.centre.lat as number]];
    const text = routeDescription(area.name, best.centre.name, { line, metres: best.metres, via: best.via });
    const geojson = { type: "LineString", coordinates: line };

    for (const protocol of snapshot.protocols) {
      if (protocol.purok_id !== area.id) continue;
      const same =
        protocol.evac_center_id === best.centre.id &&
        protocol.route === text &&
        JSON.stringify(protocol.route_geojson?.coordinates ?? null) === JSON.stringify(line);
      if (!same) {
        writes.push({ id: protocol.id, patch: { evac_center_id: best.centre.id, route: text, route_geojson: geojson } });
      }
    }
  }

  for (const write of writes) {
    await enqueueUpdate("protocols", write.id, write.patch, dependsOn ? { dependsOn } : undefined);
  }
}

export type CentreInput = { name: string; capacity: number | null };

export async function addCentre(
  snapshot: AdvisorySnapshot,
  streets: Streets | null,
  input: CentreInput & { lat: number; lng: number; purokId: string },
): Promise<void> {
  const centre: EvacCenter = {
    id: newClientId(),
    purok_id: input.purokId,
    name: input.name.trim(),
    capacity: input.capacity,
    lat: input.lat,
    lng: input.lng,
  };
  await enqueueWrite("evac_centers", { ...centre });
  // If the database refuses the centre — a third one added from two phones at
  // once — these routes would point at a row that does not exist, so they are
  // dropped with it rather than failing one by one on the foreign key.
  await reroute(snapshot, [...snapshot.centers, centre], streets, centre.id);
}

export async function updateCentre(
  snapshot: AdvisorySnapshot,
  streets: Streets | null,
  id: string,
  input: CentreInput,
): Promise<void> {
  const patch = { name: input.name.trim(), capacity: input.capacity };
  await enqueueUpdate("evac_centers", id, patch);
  await reroute(
    snapshot,
    snapshot.centers.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    streets,
  );
}

/** Archived, never deleted: its headcount history stays (0047). */
export async function removeCentre(
  snapshot: AdvisorySnapshot,
  streets: Streets | null,
  id: string,
): Promise<void> {
  await enqueueUpdate("evac_centers", id, { archived_at: new Date().toISOString() });
  await reroute(
    snapshot,
    snapshot.centers.filter((c) => c.id !== id),
    streets,
  );
}

/** A capacity field: "" is "not set", a whole number ≥ 1 is a capacity, anything else is invalid. */
export function parseCapacity(raw: string): number | null | undefined {
  const value = raw.trim();
  if (value === "") return null;
  return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 100_000 ? Number(value) : undefined;
}
