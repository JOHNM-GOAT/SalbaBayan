import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * The camera both maps share. Whatever the resident last looked at on one map
 * is where the other opens, so switching between them never loses their place.
 * Kept for the session in memory only: a fresh launch frames the route again.
 */
export type SharedView = { center: [number, number]; zoom: number };

let view: SharedView | null = null;

export function sharedView(): SharedView | null {
  return view;
}

/**
 * Remember this map's camera whenever it settles, once it has been framed.
 * `resize()` also fires `moveend`, at the default camera, before the first
 * framing — saving that would overwrite the other map's view with nothing.
 */
/**
 * Put the whole barangay back on the screen.
 *
 * Every map in the app can be panned anywhere — they are built on a street
 * extract that runs a kilometre past the boundary in every direction, and a
 * person searching for their own street in the rain can end up two barangays
 * away with nothing on screen they recognise. This is the way back, and it is
 * the same gesture on every map.
 *
 * The outline when there is one, the barangay's point when there is not. Both
 * are framed rather than zoomed to a fixed level: the boundary is what "the
 * barangay" means here, and a zoom that fits one barangay crops another.
 */
export function fitBarangay(
  map: MapLibreMap,
  ring: [number, number][] | null,
  centre: [number, number],
): void {
  if (!ring || ring.length < 3) {
    map.easeTo({ center: centre, zoom: 15, duration: 500 });
    return;
  }

  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  map.fitBounds(
    [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ],
    // Padding, so the outline is not flush against the chrome around it.
    { padding: 48, maxZoom: 16.5, duration: 500 },
  );
}

export function trackView(map: MapLibreMap, framed: () => boolean): () => void {
  const save = () => {
    if (!framed()) return;
    const c = map.getCenter();
    view = { center: [c.lng, c.lat], zoom: map.getZoom() };
  };
  map.on("moveend", save);
  return () => {
    map.off("moveend", save);
  };
}
