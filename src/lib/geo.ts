/**
 * Small-area geometry for the evacuation map (PRD §7.5).
 *
 * Everything here is flat-earth arithmetic over a barangay roughly a kilometre
 * across. At that scale the error from ignoring curvature is centimetres —
 * two orders of magnitude below GPS accuracy — so a projection library would
 * add weight to the offline bundle and buy nothing.
 */

export type Point = [number, number]; // [lng, lat]

const M_PER_DEG_LAT = 110_574;

/** Metres per degree of longitude shrinks with latitude; this is ~14°N. */
function mPerDegLng(lat: number): number {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

export function metresBetween(a: Point, b: Point): number {
  const dx = (a[0] - b[0]) * mPerDegLng((a[1] + b[1]) / 2);
  const dy = (a[1] - b[1]) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** Total walking distance along a route. */
export function lineLength(line: Point[]): number {
  return line
    .slice(1)
    .reduce((sum, point, i) => sum + metresBetween(line[i], point), 0);
}

/**
 * Shortest distance from a point to a line segment, in metres.
 *
 * This is what makes "is the path blocked?" answerable: a hazard 8 metres from
 * the route is on it, a hazard 200 metres away is somebody else's problem.
 * Comparing against route *vertices* alone would miss a hazard sitting in the
 * middle of a long straight, which is the most likely place for one.
 */
export function metresToSegment(p: Point, a: Point, b: Point): number {
  const scaleX = mPerDegLng(p[1]);
  const px = p[0] * scaleX;
  const py = p[1] * M_PER_DEG_LAT;
  const ax = a[0] * scaleX;
  const ay = a[1] * M_PER_DEG_LAT;
  const bx = b[0] * scaleX;
  const by = b[1] * M_PER_DEG_LAT;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;

  // A degenerate segment is a point. Guarding avoids a divide-by-zero that
  // would silently produce NaN and make every hazard "not on the route".
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function metresToLine(p: Point, line: Point[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return metresBetween(p, line[0]);

  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    best = Math.min(best, metresToSegment(p, line[i - 1], line[i]));
  }
  return best;
}

/**
 * How close a hazard must be to count as blocking the route.
 *
 * 30m is deliberately generous. Both the hazard's reported position and the
 * resident's GPS carry tens of metres of error, and the two failure modes are
 * not equal: warning about a hazard that turns out to be one street over costs
 * a moment's caution, while missing a flooded road on the actual route costs
 * more than that.
 */
export const BLOCKED_RADIUS_M = 30;

/**
 * Coordinates are nullable here on purpose: a hazard reported without a GPS
 * fix is a real row that simply cannot be placed. Requiring non-null would
 * force every caller to pre-filter, and the natural way to do that is a cast,
 * which is how a null slips through and becomes a silent NaN comparison.
 */
export type PlacedHazard = { lat: number | null; lng: number | null };

/** Hazards sitting on the route, nearest first. Unplaceable ones are skipped. */
export function hazardsOnRoute<T extends PlacedHazard>(
  hazards: T[],
  route: Point[],
): T[] {
  return hazards
    .filter((h): h is T & { lat: number; lng: number } =>
      h.lat != null && h.lng != null,
    )
    .map((h) => ({ h, d: metresToLine([h.lng, h.lat], route) }))
    .filter(({ d }) => d <= BLOCKED_RADIUS_M)
    .sort((a, b) => a.d - b.d)
    .map(({ h }) => h);
}

/**
 * Compass bearing a to b, in degrees from north.
 * Used to turn the next route leg into "straight on" or "turn left".
 */
export function bearing(a: Point, b: Point): number {
  const dx = (b[0] - a[0]) * mPerDegLng((a[1] + b[1]) / 2);
  const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

export type Turn = "straight" | "left" | "right" | "arrive";

/**
 * The next instruction along a route.
 *
 * Deliberately coarse — this is a walking route through a barangay someone
 * already knows, in a storm. "Turn left at the next corner" is what helps;
 * a heading in degrees is not.
 */
export function nextTurn(route: Point[], from: Point): {
  turn: Turn;
  metres: number;
  legIndex: number;
} {
  if (route.length < 2) return { turn: "arrive", metres: 0, legIndex: 0 };

  // Which leg the resident is nearest to; everything ahead of it is remaining.
  let legIndex = 0;
  let best = Infinity;
  for (let i = 1; i < route.length; i++) {
    const d = metresToSegment(from, route[i - 1], route[i]);
    if (d < best) {
      best = d;
      legIndex = i;
    }
  }

  const toEndOfLeg = metresBetween(from, route[legIndex]);

  // On the last leg there is no turn left to describe.
  if (legIndex >= route.length - 1) {
    return { turn: "arrive", metres: Math.round(toEndOfLeg), legIndex };
  }

  const current = bearing(route[legIndex - 1], route[legIndex]);
  const next = bearing(route[legIndex], route[legIndex + 1]);
  let delta = next - current;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;

  const turn: Turn =
    Math.abs(delta) < 30 ? "straight" : delta > 0 ? "right" : "left";

  return { turn, metres: Math.round(toEndOfLeg), legIndex };
}

/** Walking time at 1.2 m/s, the usual figure for an adult on level ground. */
export function walkMinutes(metres: number): number {
  return Math.max(1, Math.round(metres / 1.2 / 60));
}
