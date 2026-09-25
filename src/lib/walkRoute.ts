/**
 * Walking routes over the barangay's streets, and the barangay's outline.
 *
 * Two callers compute the same routes, and they must agree:
 *
 *   - scripts/generate-callaguip.mjs, which lays the first routes down from the
 *     OpenStreetMap extract when the geography is built; and
 *   - the official's evacuation-centre editor on /map, which recomputes every
 *     route on the phone the moment the centre is moved.
 *
 * If the editor could move the centre without re-routing, every resident's map
 * would keep drawing a path to where the hall used to be — a confident wrong
 * instruction. Sharing one module is what keeps the two answers identical.
 *
 * No value imports, so a Node test and the generator can load this file as it
 * ships — the same arrangement as queuePolicy.ts and advisoryForm.ts. The graph
 * is built from public/geo/streets.json, which the app already precaches, so
 * routing works with no connection.
 */

import type { Point } from "./geo";

export type StreetFeature = {
  properties?: { name?: string | null } | null;
  geometry: { type: "LineString"; coordinates: Point[] };
};

export type Streets = { features: StreetFeature[] };

type Edge = { to: string; metres: number; name: string | null };

export type WalkGraph = {
  coords: Map<string, Point>;
  adj: Map<string, Edge[]>;
  /** The largest connected component — the only nodes routes may use. */
  nodes: string[];
};

/**
 * Something on the ground a route should go round: a fallen tree, a blocked
 * road, a downed line, water deep enough to stop a person walking.
 *
 * A radius rather than a point, because none of this is precise. The report's
 * own position carries tens of metres of error, and a tree across a road blocks
 * more than the square metre it fell on.
 */
export type Blocker = { at: Point; radiusM: number };

export type RouteOptions = {
  /** Streets passing within a blocker's radius are not walked. */
  avoid?: Blocker[];
  /**
   * Keep the walk inside the barangay where there is a way.
   *
   * The street extract reaches a kilometre past the barangay in every
   * direction — it has to, or a route to a centre near the edge would have no
   * streets to use — and the shortest line between two points inside it can
   * still leave and come back. That is a bad instruction in a storm: the
   * barangay's own streets are the ones its people know, the ones its
   * volunteers are walking, and the ones its hazards are reported on.
   *
   * A cost, not a wall. Outside streets are walked when they are the only way,
   * which is what keeps a centre near the boundary reachable at all.
   */
  prefer?: { ring: Point[]; penalty: number };
};

/** How much further an outside street is treated as being. */
export const OUTSIDE_PENALTY = 3;

export type Route = {
  /** From the node nearest the start to the node nearest the destination. */
  line: Point[];
  metres: number;
  /** Named streets walked, in order, without repeats, shortened, at most 3. */
  via: string[];
};

const M_PER_DEG_LAT = 110_574;

/**
 * Flat-earth distance, corrected for latitude on every call. Over a barangay
 * this is accurate to centimetres. The same formula as `metresBetween` in
 * lib/geo.ts, repeated here because this module must not import values.
 */
export function metres(a: Point, b: Point): number {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (a[0] - b[0]) * 111_320 * Math.cos(lat);
  const dy = (a[1] - b[1]) * M_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

/*
 * Nodes are keyed by their coordinates. OpenStreetMap ways that meet share a
 * node, and the extract writes every coordinate at the same precision, so two
 * streets meeting at a junction produce the identical key — which is exactly
 * what makes them connected here.
 */
const keyOf = (p: Point) => `${p[0]},${p[1]}`;

export function buildWalkGraph(streets: Streets): WalkGraph {
  const coords = new Map<string, Point>();
  const adj = new Map<string, Edge[]>();

  const link = (a: string, b: string, name: string | null) => {
    const m = metres(coords.get(a)!, coords.get(b)!);
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ to: b, metres: m, name });
  };

  for (const feature of streets.features) {
    if (feature.geometry?.type !== "LineString") continue;
    const name = feature.properties?.name ?? null;
    const line = feature.geometry.coordinates;
    for (let i = 0; i < line.length; i++) coords.set(keyOf(line[i]), line[i]);
    for (let i = 1; i < line.length; i++) {
      const a = keyOf(line[i - 1]);
      const b = keyOf(line[i]);
      if (a === b) continue;
      // Both directions: this is a walking graph, and one-way rules are for
      // vehicles. Nobody should be sent the long way round on foot in a storm.
      link(a, b, name);
      link(b, a, name);
    }
  }

  /*
   * Only the largest connected component is routable. An extract clipped to a
   * box always has orphans — a driveway whose junction fell outside — and
   * snapping a start point onto one of those would produce no path at all.
   */
  const seen = new Set<string>();
  let best: string[] = [];
  for (const start of coords.keys()) {
    if (seen.has(start)) continue;
    const group = [start];
    seen.add(start);
    for (let i = 0; i < group.length; i++) {
      for (const edge of adj.get(group[i]) ?? []) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        group.push(edge.to);
      }
    }
    if (group.length > best.length) best = group;
  }

  return { coords, adj, nodes: best };
}

export function nearestNode(graph: WalkGraph, point: Point): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const id of graph.nodes) {
    const d = metres(point, graph.coords.get(id)!);
    if (d < bestDistance) {
      bestDistance = d;
      best = id;
    }
  }
  return best;
}

/** A small binary min-heap of [distance, node], enough for Dijkstra. */
class Heap {
  private items: [number, string][] = [];

  get size() {
    return this.items.length;
  }

  push(item: [number, string]) {
    const a = this.items;
    a.push(item);
    for (let i = a.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (a[parent][0] <= a[i][0]) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }

  pop(): [number, string] | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < a.length && a[l][0] < a[smallest][0]) smallest = l;
        if (r < a.length && a[r][0] < a[smallest][0]) smallest = r;
        if (smallest === i) break;
        [a[smallest], a[i]] = [a[i], a[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

const SUFFIX = /\b(Street|Avenue|Road|Boulevard|Drive|Highway)\b/g;
const SHORT: Record<string, string> = {
  Street: "St.",
  Avenue: "Ave.",
  Road: "Rd.",
  Boulevard: "Blvd.",
  Drive: "Dr.",
  Highway: "Hwy.",
};

/**
 * How far a point lies from a line segment, in metres. Local to this module
 * for the same reason `metres` is: nothing here may import a value.
 */
function metresToSegment(point: Point, a: Point, b: Point): number {
  const ab = metres(a, b);
  if (ab === 0) return metres(point, a);

  /* Project onto the segment in degrees, clamped to its ends, then measure
     that in metres — the segment is short enough for the flat-earth formula. */
  const t =
    ((point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])) /
    ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
  const clamped = Math.max(0, Math.min(1, t));
  const on: Point = [a[0] + clamped * (b[0] - a[0]), a[1] + clamped * (b[1] - a[1])];
  return metres(point, on);
}

/**
 * The shortest walk between two points, each snapped to the nearest street.
 * `null` when the graph is empty, the two are not connected, or every path
 * between them passes something in `avoid`.
 *
 * That last case is a real answer, not a failure: "there is no way round this"
 * is what the caller needs in order to say so. A caller must then decide what
 * to show — lib/centres.ts falls back to the blocked route and marks it, so
 * that a resident is never left with no route at all.
 */
export function walkRoute(
  graph: WalkGraph,
  from: Point,
  to: Point,
  options: RouteOptions = {},
): Route | null {
  const start = nearestNode(graph, from);
  const goal = nearestNode(graph, to);
  if (start === null || goal === null) return null;

  const avoid = options.avoid ?? [];
  const prefer = options.prefer;

  /** Whether the street between two nodes runs past something to be avoided. */
  const blocked = (a: Point, b: Point) =>
    avoid.some((blocker) => metresToSegment(blocker.at, a, b) <= blocker.radiusM);

  /* Inside-ness is asked for the same node many times over; computed once. */
  const insideCache = new Map<string, boolean>();
  const isInside = (id: string) => {
    let hit = insideCache.get(id);
    if (hit === undefined) {
      hit = pointInRing(graph.coords.get(id)!, prefer!.ring);
      insideCache.set(id, hit);
    }
    return hit;
  };

  /** What this step costs the search — metres, or more when it leaves. */
  const cost = (from: string, to: string, edgeMetres: number) =>
    prefer && !(isInside(from) && isInside(to)) ? edgeMetres * prefer.penalty : edgeMetres;

  /*
   * `dist` holds the SEARCH's cost, which the preference above inflates. The
   * distance reported to a resident must be the real walk, so it is summed
   * separately along the path that wins — a route captioned "600 m" that is
   * 200 m of pavement is a lie about how long they have.
   */
  const dist = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, { from: string; name: string | null }>();
  const heap = new Heap();
  heap.push([0, start]);

  while (heap.size > 0) {
    const [d, node] = heap.pop()!;
    if (node === goal) break;
    if (d > (dist.get(node) ?? Infinity)) continue; // a stale heap entry
    for (const edge of graph.adj.get(node) ?? []) {
      if (avoid.length > 0 && blocked(graph.coords.get(node)!, graph.coords.get(edge.to)!)) {
        continue;
      }
      const through = d + cost(node, edge.to, edge.metres);
      if (through < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, through);
        prev.set(edge.to, { from: node, name: edge.name });
        heap.push([through, edge.to]);
      }
    }
  }

  if (!dist.has(goal)) return null;

  const keys = [goal];
  const names: (string | null)[] = [];
  for (let at = goal; prev.has(at); ) {
    const step = prev.get(at)!;
    names.unshift(step.name);
    at = step.from;
    keys.unshift(at);
  }

  const via: string[] = [];
  for (const name of names) {
    if (!name) continue;
    const label = name.replace(SUFFIX, (m) => SHORT[m] ?? m);
    if (via[via.length - 1] !== label) via.push(label);
  }

  const line = keys.map((k) => graph.coords.get(k)!);
  let walked = 0;
  for (let i = 1; i < line.length; i++) walked += metres(line[i - 1], line[i]);

  return {
    line,
    metres: Math.round(walked),
    via: via.slice(0, 3),
  };
}

/**
 * The route as a protocol's `route` text: "Oeste Street → #5 Callaguip Barangay
 * Hall · 391 m · Oeste St.". The generator and the centre editor both write it,
 * so a route redrawn on a phone reads exactly like one built at setup.
 */
export function routeDescription(area: string, centre: string, route: Route): string {
  const via = route.via.length ? ` · ${route.via.join(" → ")}` : "";
  return `${area} → ${centre} · ${route.metres} m${via}`;
}

/**
 * Whether a point lies inside a polygon ring (ray casting). The ring may be
 * closed (first point repeated last) or open. Used to keep the evacuation
 * centre inside the barangay; the database checks the same rule again.
 */
export function pointInRing(point: Point, ring: Point[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}
