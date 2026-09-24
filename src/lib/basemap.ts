import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { resolveColour } from "./signal";

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
 *   `streets` — the same OpenFreeMap basemap the rescue map already uses
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

/**
 * Same basemap as the rescue map. No API key, no billing account (Q3).
 *
 * Liberty, not the grey Positron this used to carry. Positron drew the whole
 * barangay in four shades of grey: quiet, and unreadable as ground truth — a
 * river and a road looked alike on a flood map. Liberty is the OpenStreetMap
 * palette people already know from every other map they open: water and
 * waterways blue, woods and fields green, the highway yellow, the side streets
 * white.
 *
 * The reason for the old choice still stands — everything drawn ON the map has
 * to stay louder than the map — and is met by `calmStyle` below rather than by
 * draining the colour out of the world.
 */
export const STREET_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/**
 * The dark theme gets OpenFreeMap's dark style. A white rectangle in a dark
 * interface is the same mistake as the reverse, and worse at night: it is the
 * largest lit area on the screen, on the one screen read in the dark.
 *
 * That style ships in pure greyscale, so `calmStyle` tints it: the same blue,
 * green and amber as the day map, at night levels. Without that the dark map
 * cannot tell a river from a field, which is the distinction this app exists
 * to draw.
 */
export const STREET_STYLE_URL_DARK = "https://tiles.openfreemap.org/styles/dark";

/* ---------------------------------------------------------------------------
 * Making someone else's style fit this one
 * ------------------------------------------------------------------------ */

/** Night colours for the greyscale dark style — readable, not lit up. */
const NIGHT = {
  water: "#14293f",
  waterway: "#1d3c58",
  green: "#17301c",
  roadCasing: "#4a3a1c",
  road: "#6b5222",
};

const isWater = (id: string) => /water|river|stream|canal|dock|bay|ocean/i.test(id);
const isGreen = (id: string) =>
  /wood|forest|grass|park|scrub|garden|pitch|golf|cemetery|farmland/i.test(id);
/* "major" as well as the named classes: the dark style groups trunk, primary
   and secondary into `highway_major_*` rather than naming them. */
const isMajorRoad = (id: string) => /motorway|trunk|primary|major/i.test(id);

/**
 * Someone else's style, made to sit under this app's own drawing.
 *
 * Two changes, and deliberately no more. A basemap this app rewrites layer by
 * layer is a basemap that breaks quietly the next time OpenFreeMap ships a new
 * one, and the whole point of using theirs is not maintaining one.
 *
 *   1. The points of interest come off. Restaurant, shop and ATM markers are
 *      the one part of a street map that competes directly with the pins this
 *      app draws — same size, same shape, same place on the screen — and a
 *      hazard that reads as a cafe is a failure of the entire map.
 *
 *   2. The dark style gets colour, because it ships with none.
 *
 * Everything else — the road hierarchy, the street names, the buildings, the
 * coastline — is left exactly as it arrived.
 */
export function calmStyle(
  style: StyleSpecification,
  theme: "light" | "dark",
): StyleSpecification {
  const layers = style.layers
    .filter((layer) => {
      // By source layer rather than by name: layer ids differ between styles,
      // the vector tile schema underneath them does not.
      const source = "source-layer" in layer ? layer["source-layer"] : undefined;
      return source !== "poi" && !/^poi[_-]/i.test(layer.id);
    })
    .map((layer) => (theme === "dark" ? tint(layer) : layer));

  return { ...style, layers };
}

type Layer = StyleSpecification["layers"][number];

/** One layer, recoloured for night — and only recoloured. */
function tint(layer: Layer): Layer {
  if (layer.type !== "fill" && layer.type !== "line") return layer;

  const id = layer.id;
  const colour = isWater(id)
    ? layer.type === "line"
      ? NIGHT.waterway
      : NIGHT.water
    : isGreen(id)
      ? NIGHT.green
      : isMajorRoad(id)
        ? /casing|outline/i.test(id)
          ? NIGHT.roadCasing
          : NIGHT.road
        : null;

  if (!colour) return layer;

  /* The paint is replaced one key deep, so widths, dashes and the zoom curves
     that drive them survive untouched: the colour is this app's business and
     nothing else here is. */
  const key = layer.type === "fill" ? "fill-color" : "line-color";
  return { ...layer, paint: { ...layer.paint, [key]: colour } } as Layer;
}

/**
 * Bounded so a tower that accepts the connection and then stalls cannot leave
 * the upgrade pending for the length of the storm. The sketch is already on
 * screen throughout, so this timeout costs nothing but the upgrade.
 */
const FETCH_TIMEOUT_MS = 8000;

/**
 * The sketch's ground, read from the theme's own token at build time, so the
 * drawn map matches the screen around it in either theme.
 *
 * Through resolveColour, never the raw token: the tokens are authored in
 * oklch and the browser hands back `lab(...)`, which MapLibre rejects with
 * "color expected" — taking the whole style, and the map, with it.
 */
function ground(): string {
  return typeof document === "undefined" ? "#ffffff" : resolveColour("var(--color-ink-900)");
}

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
      { id: "ground", type: "background", paint: { "background-color": ground() } },
    ],
  };
}

const cached = new Map<string, StyleSpecification>();
const inflight = new Map<string, Promise<StyleSpecification | null>>();

/**
 * Fetch the street style, or resolve `null` if it cannot be had.
 *
 * Never rejects. A caller that has to remember to catch is a caller that will
 * one day forget, and the cost of forgetting here is a blank evacuation map.
 */
export async function loadStreetStyle(theme: "light" | "dark" = "light"): Promise<StyleSpecification | null> {
  const url = theme === "dark" ? STREET_STYLE_URL_DARK : STREET_STYLE_URL;
  const hit = cached.get(url);
  if (hit) return hit;

  let pending = inflight.get(url);
  if (!pending) {
    pending = fetchStreetStyle(url)
      .then((style) => (style ? calmStyle(style, theme) : null))
      .finally(() => inflight.delete(url));
    inflight.set(url, pending);
  }
  const style = await pending;
  // Only a success is memoised. A failure is usually "no signal right now",
  // which is a statement about this minute and not about the session.
  if (style) cached.set(url, style);
  return style;
}

async function fetchStreetStyle(url: string): Promise<StyleSpecification | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: abort.signal });
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
