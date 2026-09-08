import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";

/**
 * Which base map the evacuation view draws on (PRD §7.5).
 *
 * There are two, and the difference is not cosmetic:
 *
 *   `sketch`  — the synthetic street grid from `public/geo/streets.json`, in a
 *               style with no tile source, no `glyphs` and no `sprite`. Nothing
 *               in it can fail, and it is complete for the whole barangay with
 *               the connection gone. It is what the map is BUILT with, always.
 *
 *   `streets` — the same OpenFreeMap dark basemap the rescue map already uses
 *               (`/responder`), so the two map screens read as one product.
 *
 * The order matters more than the choice. The map is constructed on the sketch,
 * which is guaranteed to load, and only then is the real basemap fetched and
 * swapped in. Handing MapLibre a style URL directly would invert that: with no
 * signal the style fetch fails, `load` never fires, and the layers that carry
 * the actual evacuation instruction — route, boundary, hazards, destination —
 * are never added to anything. The screen a resident opens when the network is
 * gone would be the one screen that needs the network to draw.
 *
 * So the fetch happens here, in our own code, where a failure is a `null` we
 * can ignore rather than a map that never starts.
 */
export type Basemap = "sketch" | "streets";

/** Same basemap as the rescue map. No API key, no billing account (Q3). */
export const STREET_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

/**
 * Bounded so a tower that accepts the connection and then stalls cannot leave
 * the upgrade pending for the length of the storm. The sketch is already on
 * screen throughout, so this timeout costs nothing but the upgrade.
 */
const FETCH_TIMEOUT_MS = 8000;

/** The ground colour, matching `--color-ink-900`, for the sketch's background. */
const GROUND = "#0b0e12";

/**
 * The style that cannot fail.
 *
 * No `glyphs` key AT ALL — not `glyphs: undefined`. MapLibre validates the
 * style and rejects "glyphs: string expected, undefined found", which
 * invalidates the whole style and renders nothing. There are no text layers
 * here, so no glyph server is needed, which is also what keeps it offline.
 */
export function sketchStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      { id: "ground", type: "background", paint: { "background-color": GROUND } },
    ],
  };
}

let cached: StyleSpecification | null = null;
let inflight: Promise<StyleSpecification | null> | null = null;

/**
 * Fetch the street style, or resolve `null` if it cannot be had.
 *
 * Never rejects. A caller that has to remember to catch is a caller that will
 * one day forget, and the cost of forgetting here is a blank evacuation map.
 */
export async function loadStreetStyle(): Promise<StyleSpecification | null> {
  if (cached) return cached;
  inflight ??= fetchStreetStyle().finally(() => {
    inflight = null;
  });
  const style = await inflight;
  // Only a success is memoised. A failure is usually "no signal right now",
  // which is a statement about this minute and not about the session.
  if (style) cached = style;
  return style;
}

async function fetchStreetStyle(): Promise<StyleSpecification | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(STREET_STYLE_URL, { signal: abort.signal });
    if (!response.ok) return null;
    const style: unknown = await response.json();
    return isUsableStyle(style) ? style : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A 200 is not the same as a style. A captive portal — the hotel-wifi login
 * page, and the sort of thing a barangay hall's shared connection does — answers
 * every request with cheerful HTML, and handing that to `setStyle` throws
 * inside MapLibre where this module can no longer catch it.
 */
function isUsableStyle(value: unknown): value is StyleSpecification {
  if (typeof value !== "object" || value === null) return false;
  const style = value as Partial<StyleSpecification>;
  return (
    style.version === 8 &&
    typeof style.sources === "object" &&
    Array.isArray(style.layers) &&
    style.layers.length > 0
  );
}

/**
 * Run `callback` once the map's style is ready to take `addLayer`, now or as
 * soon as it becomes so. Returns an unsubscribe.
 *
 * `setStyle` has no completion callback and MapLibre exposes no `style.load` in
 * its typed event map, so this listens to `styledata` — which also fires for
 * source updates — and defers to `isStyleLoaded()` for the actual answer.
 *
 * Every effect that touches layers goes through this rather than testing
 * `isStyleLoaded()` inline. An inline test can only answer "not yet" by giving
 * up, and an effect that gives up is never re-run unless one of its
 * dependencies happens to change again — which is how the map ended up framed
 * on its fallback centre with every layer missing: the style was mid-swap on
 * the one pass that had the data.
 */
export function onStyleReady(map: MapLibreMap, callback: () => void): () => void {
  if (map.isStyleLoaded()) {
    callback();
    return () => {};
  }

  const detach = () => {
    map.off("styledata", handler);
    map.off("sourcedata", handler);
    map.off("idle", handler);
  };

  const handler = () => {
    if (!map.isStyleLoaded()) return;
    detach();
    callback();
  };

  /*
   * Three events, and `styledata` alone is not enough — which cost an hour.
   *
   * `isStyleLoaded()` is stricter than its name suggests: MapLibre only reports
   * true once the style has parsed AND every source cache has settled. But
   * `styledata` fires at the parse, while sources are still in flight, and
   * tiles arriving afterwards announce themselves as `sourcedata`. Waiting on
   * `styledata` alone means the one notification arrives while the answer is
   * still false, and the map is never told it may draw: a real basemap with no
   * route, no boundary and no destination on it, and no error anywhere.
   *
   * `idle` is the backstop for a style with no sources at all to report.
   */
  map.on("styledata", handler);
  map.on("sourcedata", handler);
  map.on("idle", handler);
  return detach;
}
