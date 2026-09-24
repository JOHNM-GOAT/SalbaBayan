import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { graphFor, loadStreets } from "./centres";
import { metresBetween, type Point } from "./geo";
import { createPrefStore } from "./prefs";
import { walkRoute } from "./walkRoute";

/**
 * The route a responder is walking to one SOS.
 *
 * It is drawn on that responder's phone and nowhere else. Nothing about it is
 * written to the database: two volunteers heading to the same call each see
 * their own line from where they are, and neither sees the other's. The call
 * itself is shared — everyone sees it, anyone may take it — which is the part
 * that has to be common.
 *
 * The line is computed here, on the phone, from the precached street file, so
 * it survives the storm taking the towers with it (lib/walkRoute.ts).
 */

/** Which call this phone is answering. Survives a reload and a page change. */
export const acceptedSosPref = createPrefStore("salbabayan.sos.accepted");

/** A phone further than this from the call cannot usefully route to it. */
const MAX_ROUTE_M = 20_000;

export type ResponderRoute = { line: Point[]; metres: number };

/**
 * The walk from `from` to the call. Falls back to the straight line between
 * them when the streets cannot be routed — a direction is still better than
 * nothing, and a rescuer reads it as "that way", not as a turn list.
 */
export async function routeToCall(from: Point, to: Point): Promise<ResponderRoute | null> {
  if (metresBetween(from, to) > MAX_ROUTE_M) return null;

  const streets = await loadStreets();
  const route = streets ? walkRoute(graphFor(streets), from, to) : null;
  if (!route || route.line.length < 2) {
    return { line: [from, to], metres: Math.round(metresBetween(from, to)) };
  }

  /* The router starts and ends at street nodes; the steps to and from them
     are part of the walk. */
  const line: Point[] = [...route.line];
  if (metresBetween(from, line[0]) > 3) line.unshift(from);
  if (metresBetween(line[line.length - 1], to) > 3) line.push(to);
  const metres =
    route.metres +
    metresBetween(from, route.line[0]) +
    metresBetween(route.line[route.line.length - 1], to);

  return { line, metres: Math.round(metres) };
}

/**
 * The red-edged line the responder follows, added to a map or updated in
 * place. Thin, with the edge doing the work: it crosses a map that already
 * carries a green evacuation route, and the two must never be confused.
 */
export function drawResponderRoute(map: MapLibreMap, line: Point[]): void {
  const data = {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: line },
  };

  const source = map.getSource("responder-route") as GeoJSONSource | undefined;
  if (source) source.setData(data);
  else map.addSource("responder-route", { type: "geojson", data });

  if (!map.getLayer("responder-route-line")) {
    map.addLayer({
      id: "responder-route-edge",
      type: "line",
      source: "responder-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#b91c1c", "line-width": ["interpolate", ["linear"], ["zoom"], 13, 4, 17, 7] },
    });
    map.addLayer({
      id: "responder-route-line",
      type: "line",
      source: "responder-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#fee2e2", "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1.6, 17, 3] },
    });
  }
}

/** Take the line off the map — the call was rescued, or handed back. */
export function clearResponderRoute(map: MapLibreMap): void {
  for (const id of ["responder-route-line", "responder-route-edge"]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource("responder-route")) map.removeSource("responder-route");
}
