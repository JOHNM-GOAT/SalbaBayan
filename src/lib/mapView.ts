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
