import type { Map as MapLibreMap } from "maplibre-gl";
import { resolveColour } from "./signal";

/**
 * The buildings under everything else.
 *
 * The online base map draws buildings from OpenStreetMap, which is why the
 * previous barangay looked full and this one looked like bare fields: Batac
 * City's centre is densely mapped, and Nilombot has thirteen buildings in OSM,
 * twelve of them the school's own blocks. So the footprints are carried by the
 * app instead (scripts/generate-buildings.mjs, Microsoft's ODbL dataset).
 *
 * Carrying them has a second benefit worth more than the first: the drawn
 * fallback map — the one a phone falls back to with no signal, when the tiles
 * cannot be fetched — never had buildings at all. Now the map a resident sees
 * in a blackout shows the houses on their street, not just the street.
 *
 * They are DECORATION, deliberately. Nothing routes, measures or decides from
 * them; they are drawn beneath the boundary, the route and every pin. A
 * footprint a few metres out, or a roof that has gone up since the imagery,
 * changes nothing the app tells anybody to do.
 */

export type Buildings = {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: unknown; geometry: unknown }[];
};

let load: Promise<Buildings | null> | null = null;

/** The precached footprints, fetched once per page load. */
export function loadBuildings(): Promise<Buildings | null> {
  load ??= fetch("/geo/buildings.json")
    .then((r) => (r.ok ? (r.json() as Promise<Buildings>) : null))
    .catch(() => {
      load = null; // try again next time
      return null;
    });
  return load;
}

/**
 * Draw them, once, underneath whatever the map already has.
 *
 * `beforeId` is the point: every map here adds its own boundary, route and
 * markers, and buildings inserted after those would sit on top of the route a
 * resident is meant to follow. Passing the lowest existing layer keeps them
 * where they belong however the calling screen is built.
 */
export function paintBuildings(
  map: MapLibreMap,
  data: Buildings,
  beforeId?: string,
): void {
  const existing = map.getSource("buildings") as
    | { setData: (d: unknown) => void }
    | undefined;

  if (existing) {
    existing.setData(data);
    return;
  }

  /*
   * The credit travels with the source, so every map that draws these gets it
   * without having to remember. ODbL requires attribution wherever the data is
   * shown, and "wherever" here is four separate screens.
   */
  map.addSource("buildings", {
    type: "geojson",
    data: data as never,
    attribution: "Buildings &copy; Microsoft, ODbL",
  });

  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined;

  /*
   * One flat fill and a hairline, no 3-D extrusion.
   *
   * Extruded buildings look impressive and cost a resident the thing they came
   * for: at the zoom where a street is recognisable they hide the street, and
   * they hide the route drawn along it. Flat shapes read as "houses are here"
   * and stay out of the way.
   */
  map.addLayer(
    {
      id: "buildings-fill",
      type: "fill",
      source: "buildings",
      /*
       * 13.5, not 14: the resident's map opens framed on the whole barangay,
       * which lands around 14. A layer that started at 14 was invisible at
       * exactly the zoom the screen opens on — present in the style, absent
       * from the map, which is the worst of both.
       */
      minzoom: 13.5,
      paint: {
        /*
         * `line`, not `ink-600`, and the difference is the whole layer.
         *
         * The tokens are relative to the app's own surfaces, and the base map
         * underneath is neither: it is cream in light mode. `ink-600` is 0.91
         * there — a near-white shape on a near-white field, which drew
         * perfectly and could not be seen. `line` is the token meant to be
         * visible ON those surfaces, and it reads correctly both ways round:
         * darker than the cream in light mode, lighter than the ground in
         * dark.
         */
        "fill-color": resolveColour("var(--color-line)"),
        /*
         * Strongest when the shapes are SMALLEST, which is the opposite of the
         * obvious ramp and the reason the first one failed.
         *
         * The map opens framed on the whole barangay, around zoom 13.5, where
         * a house is about one pixel. At that size a faint fill is nothing at
         * all — which is exactly the "it looks empty" this layer exists to
         * answer. Full strength there turns fifteen hundred pixels into
         * texture: you can see where people live. Zoomed in the shapes are
         * large enough to speak for themselves, and the fill eases off so it
         * does not compete with the route drawn over it.
         */
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13.5, 0.9, 16, 0.5],
      },
    },
    before,
  );

  map.addLayer(
    {
      id: "buildings-edge",
      type: "line",
      source: "buildings",
      minzoom: 15,
      paint: {
        "line-color": resolveColour("var(--color-line)"),
        "line-width": 0.6,
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 15.5, 0, 17, 0.7],
      },
    },
    before,
  );
}
