"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useSync, useT } from "@/components/AppRuntime";
import { barangayCentre, deriveAdvisory, FALLBACK_CENTRE } from "@/lib/advisory";
import { barangayRing, graphFor, rankCentres } from "@/lib/centres";
import { allWaterReports, subscribeWaterReports, type WaterReport } from "@/lib/water";
import { DEPTH_COLOUR, placeWater, waterOpacity } from "@/lib/waterMap";
import { routeBlockers, stopsAPerson } from "@/lib/blockage";
import { MapLegend } from "@/components/MapLegend";
import { CentreDetail, HazardBrief, WaterBrief, YouDetail, type MapSelection } from "@/components/MapDetail";
import { focusHazard, focusWater } from "@/lib/hazardFocus";
import { CENTRE_ICON, HAZARD_ICON, WATER_ICON, hazardColour, pinElement, pinMarker, youElement } from "@/lib/mapMarks";
import { sharedView, trackView } from "@/lib/mapView";
import { CATEGORY_TONE, type Category } from "@/lib/hazards";
import type { Streets } from "@/lib/walkRoute";
import { resolveColour } from "@/lib/signal";
import { startPositionWatch, type Fix } from "@/lib/sos";
import { useTheme } from "@/components/useTheme";
import {
  loadStreetStyle,
  onStyleReady,
  sketchStyle,
  type Basemap,
} from "@/lib/basemap";
import type { Feature, FeatureCollection } from "geojson";
import {
  hazardsOnRoute,
  lineLength,
  metresBetween,
  nextTurn,
  walkMinutes,
  type Point,
} from "@/lib/geo";

/**
 * Offline evacuation map (PRD §7.5).
 *
 * Every layer that carries an instruction is GeoJSON already on the device: the
 * Purok boundary and route ride in the advisory snapshot cached in IndexedDB,
 * and the hazards ride with them. None of them needs a connection, which is
 * what lets this view open, pan and render with the network gone.
 *
 * The base UNDER those layers is the one part that improves with a signal. The
 * map is built on the drawn grid, which cannot fail; if the device is online,
 * the real OpenFreeMap basemap — the same one the rescue map uses
 * (`/responder`) — is fetched and swapped in behind the same overlays, so the
 * two map screens read as one product. See lib/basemap.ts for why the swap runs
 * in that order and not the other.
 */

/*
 * The route to the centre: light green, and thin enough that the street names
 * under it stay readable. A darker edge keeps it visible on the light basemap.
 */
const ROUTE_COLOUR = "#4ade80";
const ROUTE_EDGE = "#15803d";

/** A phone further than this from the barangay is not walking from where it is. */
const NEAR_BARANGAY_M = 2_500;

export default function MapPage() {

  const { snapshot, purokId, language, online } = useSync();
  const t = useT();
  const { theme } = useTheme();

  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const meMarker = useRef<maplibregl.Marker | null>(null);
  /** One basemap-upgrade attempt in flight, and one framing per style, per map
      instance. Declared with the map itself because that is what they track. */
  const upgrading = useRef(false);
  const framed = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [selection, setSelection] = useState<MapSelection>(null);
  const [streets, setStreets] = useState<FeatureCollection | null>(null);
  /** The other centres under the nearest one: folded away until asked for. */
  const [showOthers, setShowOthers] = useState(false);
  /** Phone only: the route name and the offline note above the turn. */
  const [topOpen, setTopOpen] = useState(false);
  /** Ticks so "4 MIN" on a tapped pin keeps up without a reload. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  /*
   * Which base is on screen, and a counter that ticks every time a style
   * finishes loading. `setStyle` discards every source and layer the map holds,
   * so the paint effect below has to run again afterwards — and it has no other
   * way to know that it must.
   */
  const [base, setBase] = useState<Basemap>("sketch");
  const [styleEpoch, setStyleEpoch] = useState(0);

  const advisory = useMemo(
    () =>
      snapshot && purokId ? deriveAdvisory(snapshot, purokId, language) : null,
    [snapshot, purokId, language],
  );

  const purok = snapshot?.puroks.find((p) => p.id === purokId) ?? null;
  /* The street's planned route: the fallback when the nearest centre cannot be worked out here. */
  const plannedRoute = useMemo(
    () => (advisory?.routeProtocol?.route_geojson?.coordinates ?? []) as Point[],
    [advisory],
  );

  /*
   * The nearest of the barangay's centres (up to 3), by walking distance along
   * the streets: from where the phone is when it has a fix near the barangay,
   * otherwise from the start of the resident's street. The fix is rounded to
   * about 10 m so a drifting GPS does not re-route on every reading.
   */
  const [water, setWater] = useState<WaterReport[]>([]);
  const [waterNow, setWaterNow] = useState(() => Date.now());
  const placedWater = useMemo(() => placeWater(snapshot, water, waterNow), [snapshot, water, waterNow]);

  /*
   * What the route must keep clear of: every open hazard with a position, and
   * every fresh reading of water deep enough to stop a person (lib/blockage.ts
   * decides which, and why).
   */
  const blockers = useMemo(
    () => routeBlockers(snapshot?.hazards ?? [], placedWater),
    [snapshot, placedWater],
  );

  const graph = useMemo(() => (streets ? graphFor(streets as unknown as Streets) : null), [streets]);
  const home = barangayCentre(snapshot?.barangay);
  const fixKey =
    fix && metresBetween([fix.lng, fix.lat], home) <= NEAR_BARANGAY_M
      ? `${fix.lng.toFixed(4)},${fix.lat.toFixed(4)}`
      : null;
  const areaStart = purok?.lat != null && purok.lng != null ? `${purok.lng},${purok.lat}` : null;
  const startKey = fixKey ?? areaStart ?? (plannedRoute[0] ? plannedRoute[0].join(",") : null);
  const ranked = useMemo(() => {
    if (!startKey || !snapshot) return [];
    return rankCentres(
      graph,
      startKey.split(",").map(Number) as Point,
      snapshot.centers,
      blockers,
      barangayRing(snapshot),
    );
  }, [graph, startKey, snapshot, blockers]);
  const nearest = ranked[0] ?? null;
  const fromYou = fixKey !== null;

  const route = useMemo(
    () => (nearest?.line && nearest.line.length >= 2 ? nearest.line : plannedRoute),
    [nearest, plannedRoute],
  );
  const centre = nearest?.centre ?? advisory?.center ?? null;

  const routeMetres = useMemo(
    () => (nearest?.line ? nearest.metres : route.length ? lineLength(route) : 0),
    [nearest, route],
  );

  /* Hazards sitting on this route, which is the whole point of the overlay. */
  const blocking = useMemo(
    () => (route.length && snapshot ? hazardsOnRoute(snapshot.hazards, route) : []),
    [snapshot, route],
  );

  /*
   * Deep water sitting on it, warned about the same way.
   *
   * It was not, and that was the gap this closes: a chest-deep reading at the
   * door of the evacuation centre stopped the route being drawn round it — the
   * last few metres are the resident's to judge — and then said nothing at all,
   * so the one reading that mattered most was the one the screen was quietest
   * about.
   */
  const deepWater = useMemo(() => {
    if (!route.length) return [];
    const deep = placedWater.filter(
      (w) => !w.stale && stopsAPerson(w.report.level_category),
    );
    return hazardsOnRoute(deep, route);
  }, [placedWater, route]);

  const guidance = useMemo(() => {
    if (!route.length) return null;
    // Only from the phone's own position when it is near the barangay, the
    // same rule as the route: a phone in another town would otherwise be told
    // the next turn is hundreds of kilometres away.
    const from: Point = fromYou && fix ? [fix.lng, fix.lat] : route[0];
    return nextTurn(route, from);
  }, [route, fix, fromYou]);

  /*
   * What the map should frame: the route, the destination AND the Purok
   * boundary.
   *
   * The route alone is not enough, and the failure that caused was not subtle.
   * These routes follow a street grid, so a route with a single straight leg
   * has a bounding box of zero height — `fitBounds` then pins the map's centre
   * onto the route itself and fills the rest of the viewport with whatever lies
   * beyond it, which for Purok 1 is the empty ground north of the barangay.
   * Nearly half the map was blank, and it read as a rendering bug rather than
   * as a framing one. Including the boundary guarantees area in both axes.
   */
  /*
   * The outline to frame and draw: the area's own, or — for areas named after
   * streets, which have none — the whole barangay's. Callaguip's areas are its
   * streets until it supplies a Purok list, so today this is always the
   * barangay outline.
   */
  const outline = purok?.boundary_geojson ?? snapshot?.barangay.boundary_geojson ?? null;

  const frame = useMemo(() => {
    const points: Point[] = [...route];
    if (centre?.lat != null && centre?.lng != null) {
      points.push([centre.lng, centre.lat]);
    }
    for (const ring of outline?.coordinates ?? []) {
      for (const point of ring) points.push(point as Point);
    }
    if (!points.length) return null;

    const lngs = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    return [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ] as [[number, number], [number, number]];
  }, [route, centre, outline]);

  /* The street grid — a static precached file, never fetched from a tile API. */
  useEffect(() => {
    fetch("/geo/streets.json")
      .then((r) => r.json())
      .then(setStreets)
      .catch(() => setStreets(null));
  }, []);

  useEffect(() => {
    const stop = startPositionWatch((next) => setFix(next));
    return stop;
  }, []);

  /* Water readings from everyone, officials included — the last day only (lib/waterMap.ts). */
  /* Declared above the routing that reads them — see `blockers`. */
  useEffect(() => {
    const load = () =>
      void allWaterReports(40).then((rows) => {
        setWater(rows);
        setWaterNow(Date.now());
      });
    queueMicrotask(load);
    const stop = subscribeWaterReports(load);
    const tick = window.setInterval(load, 5 * 60_000);
    return () => {
      stop();
      window.clearInterval(tick);
    };
  }, []);
  /* Build the map once, always on the style that cannot fail. */
  useEffect(() => {
    if (!container.current || map.current || !streets) return;

    /*
     * Reset per instance. `ready` is React state mirroring a mutable map
     * object, and the two drift the moment this effect runs a second time —
     * React's development double-invoke does exactly that: the first map is
     * built, `load` sets `ready` true, the cleanup removes that map, and a
     * second map is built while `ready` is still true from the first. The
     * paint effect then fires against a style that has not loaded and
     * MapLibre throws "Style is not done loading".
     */
    setReady(false);
    setBase("sketch");
    // One upgrade attempt per map instance, and this is a new instance.
    upgrading.current = false;
    framed.current = null;

    map.current = new maplibregl.Map({
      container: container.current,
      // Not a style URL. The style is built in-process from a module that
      // cannot fail, so `load` always fires and the instruction layers always
      // get added — see lib/basemap.ts.
      style: sketchStyle(),
      center: FALLBACK_CENTRE,
      zoom: 14.4,
      // Added only once the real basemap is in. Crediting OpenStreetMap for a
      // grid we drew ourselves would be a false attribution, not a polite one.
      attributionControl: false,
    });

    // Zoom buttons as well as pinch, matching the rescue map. A resident
    // reading this one-handed in the rain should not have to pinch.
    map.current.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right",
    );

    map.current.on("load", () => {
      setReady(true);
      setStyleEpoch((n) => n + 1);
    });

    /*
     * Surface MapLibre's own errors. It reports style and layer problems
     * through this event rather than throwing, so without a listener a
     * rejected layer fails silently and the symptom is an empty map with no
     * explanation — which cost real time to track down once already.
     */
    map.current.on("error", (event) =>
      console.error("[map]", event.error?.message ?? event),
    );

    // Field diagnostics, alongside the write-queue surface in lib/diagnostics.
    // "The map is blank" is otherwise unanswerable from a phone.
    (window as unknown as { salbabayanMap?: maplibregl.Map }).salbabayanMap =
      map.current;

    /*
     * MapLibre measures its container once, at construction, and caches that
     * size. Here the container is a `flex-1` box that is still zero-height on
     * the frame the map is built in, so without this the canvas keeps a 0px
     * viewport and renders nothing at all — a blank rectangle with every layer
     * correctly loaded behind it.
     */
    const observer = new ResizeObserver(() => map.current?.resize());
    observer.observe(container.current);

    return () => {
      observer.disconnect();
      map.current?.remove();
      map.current = null;
      setReady(false);
    };
  }, [streets]);

  /*
   * Upgrade to the real basemap.
   *
   * Gated on `online`, and that gate is the interesting part. The Service
   * Worker caches the style far more readily than it caches every tile around
   * the barangay, so an offline device can easily hold the style and almost no
   * tiles — and swapping to it would trade a grid that covers the whole
   * barangay for a basemap that is mostly empty. Offline, the drawn map is the
   * better map, not merely the safer one.
   *
   * There is deliberately no downgrade when the signal drops later. Tiles for
   * the view already on screen have already been fetched, and pulling the
   * ground out from under someone mid-evacuation is worse than a few unpainted
   * tiles at the edges. The route, boundary, hazards and destination — every
   * layer that carries the instruction — are identical on either base.
   */
  const painted = useRef<string | null>(null);
  /** The map the OpenStreetMap credit has been added to. */
  const credited = useRef<maplibregl.Map | null>(null);
  useEffect(() => {
    if (!ready || !online || upgrading.current) return;
    // A theme change re-runs this: the basemap is the largest area of colour
    // on the screen and cannot stay light under a dark interface.
    if (painted.current === theme) return;
    const m = map.current;
    if (!m) return;
    upgrading.current = true;
    painted.current = theme;

    void loadStreetStyle(theme).then((style) => {
      /*
       * The map instance IS the lifetime here, which is why this checks
       * `map.current !== m` rather than a flag the effect's cleanup would clear.
       *
       * The flag version looked equivalent and was not: `online` settles a
       * moment after boot, the dependency change ran the cleanup while the
       * style fetch was still in flight, and the swap then completed against a
       * closure that had already declared itself dead. The style loaded, our
       * layers were discarded with the old one, and nothing ever put them back
       * — a real map underneath and no route drawn on it.
       */
      if (!style || map.current !== m) {
        // Nothing on screen changed; the sketch is still there. Released so a
        // later attempt can run, because "no signal now" is not "no signal".
        upgrading.current = false;
        painted.current = null;
        return;
      }
      upgrading.current = false;

      /*
       * `diff: false`. Left to itself MapLibre tries to reshape the current
       * style into the new one, and a diff that succeeds leaves
       * `isStyleLoaded()` true throughout — so "wait until the style is ready"
       * answers instantly and describes the style being replaced. A clean swap
       * makes the transition observable, which is the whole basis of the
       * re-paint below.
       */
      m.setStyle(style, { diff: false });

      // Deliberately not unsubscribed on dependency changes: `map.remove()`
      // drops every listener it holds, and the swap has to be allowed to finish
      // even if this effect is torn down while it is in flight.
      onStyleReady(m, () => {
        if (map.current !== m) return;
        /*
         * A licence condition of the OpenStreetMap data, not decoration — and
         * added once per map, not once per style. A theme change swaps the
         * style again, and without this guard each swap stacked another credit
         * box over the legend.
         */
        if (credited.current !== m) {
          credited.current = m;
          m.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
        }
        setBase("streets");
        setStyleEpoch((n) => n + 1);
      });
    });
  }, [ready, online, theme]);

  /*
   * Offline, the drawn sketch is the basemap; redraw it in the other theme.
   *
   * Only on a CHANGE. Running on mount would call setStyle on a map whose
   * first style has not finished loading, which leaves it with no style at
   * all — a blank rectangle where the map should be.
   */
  const sketchTheme = useRef(theme);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || sketchTheme.current === theme) return;
    sketchTheme.current = theme;
    if (base !== "sketch") return;
    m.setStyle(sketchStyle(), { diff: false });
    return onStyleReady(m, () => setStyleEpoch((n) => n + 1));
    // base and ready are read when the theme changes, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, ready]);

  /* Paint every layer from data already on the device. */
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !streets) return;

    /*
     * `isStyleLoaded()` is asked as well as `ready`, because only the map can
     * answer authoritatively — `ready` is a React snapshot of a mutable object,
     * this is the object itself — and `addLayer` against a style mid-load
     * throws "Style is not done loading", which costs the whole screen rather
     * than one layer.
     *
     * But it comes back rather than giving up. The snapshot can land while the
     * basemap is being swapped, and a pass dropped there would only be retried
     * if some other dependency happened to change later. Ticking the epoch once
     * the style settles re-runs this effect with the same data.
     */
    if (!m.isStyleLoaded()) {
      return onStyleReady(m, () => setStyleEpoch((n) => n + 1));
    }

    /*
     * Map colour comes from the design tokens, resolved at paint time, rather
     * than from hexes typed into each layer. That was already true of the route
     * (it follows the severity ramp); it is now true of everything, and the
     * white repaint is why. Every hardcoded value in here was a near-black or a
     * glowing cyan picked for the old ground, and each one had to be found by
     * eye. Reading them from the tokens means the next palette change is one
     * file again.
     */
    const accent = resolveColour("var(--color-hv)");

    const setSource = (id: string, data: Feature | FeatureCollection) => {
      const existing = m.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (existing) existing.setData(data as FeatureCollection);
      else m.addSource(id, { type: "geojson", data });
    };

    /* The drawn grid is the base only when there is no surveyed one under it.
       Both at once would put invented streets over real ones. */
    if (base === "sketch") {
      setSource("streets", streets);
      if (!m.getLayer("roads")) {
        /*
         * Casing under fill, and widths that grow with zoom — the two things
         * that make a set of lines read as streets rather than as a diagram.
         * Worth the extra layer now that these ARE streets: the file holds the
         * surveyed road network of Sta. Cruz rather than an invented grid of
         * identical blocks, and a hierarchy is the only way that much geometry
         * stays legible on a phone.
         */
        const byKind = (
          main: number,
          minor: number,
          path: number,
        ): maplibregl.ExpressionSpecification => [
          "match", ["get", "kind"], "main", main, "path", path, minor,
        ];

        m.addLayer({
          id: "roads-casing",
          type: "line",
          source: "streets",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": resolveColour("var(--color-line)"),
            "line-width": [
              "interpolate", ["linear"], ["zoom"],
              13, byKind(3.5, 2, 1),
              17, byKind(18, 11, 5),
            ],
          },
        });
        m.addLayer({
          id: "roads",
          type: "line",
          source: "streets",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": [
              "match", ["get", "kind"],
              "main", resolveColour("var(--color-ink-600)"),
              "path", resolveColour("var(--color-ink-700)"),
              resolveColour("var(--color-ink-600)"),
            ],
            "line-width": [
              "interpolate", ["linear"], ["zoom"],
              13, byKind(2, 1.2, 0.6),
              17, byKind(14, 8, 3.5),
            ],
          },
        });
      }
    }

    /* Purok boundary — dashed, so it reads as an administrative edge rather
       than a wall or a road. */
    // The area's own outline, or the barangay's for areas named after streets
    // (the same choice as `outline` above, made here so the effect depends only
    // on what it already lists).
    const shape = purok?.boundary_geojson ?? snapshot?.barangay.boundary_geojson ?? null;
    if (shape) {
      setSource("boundary", {
        type: "Feature",
        properties: {},
        geometry: shape,
      } as Feature);

      if (!m.getLayer("boundary-line")) {
        m.addLayer({
          id: "boundary-fill",
          type: "fill",
          source: "boundary",
          paint: { "fill-color": accent, "fill-opacity": 0.07 },
        });
        m.addLayer({
          id: "boundary-line",
          type: "line",
          source: "boundary",
          paint: {
            "line-color": accent,
            "line-width": 2,
            "line-dasharray": [3, 2],
          },
        });
      }
    }

    /* The route to the nearest centre (ROUTE_COLOUR above). */
    if (route.length) {
      setSource("route", {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: route },
      } as Feature);

      if (!m.getLayer("route-line")) {
        m.addLayer({
          id: "route-casing",
          type: "line",
          source: "route",
          paint: {
            "line-color": ROUTE_EDGE,
            "line-opacity": 0.55,
            "line-width": ["interpolate", ["linear"], ["zoom"], 13, 3, 17, 5.5],
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        m.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          paint: {
            "line-color": ROUTE_COLOUR,
            "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1.8, 17, 3.5],
          },
          layout: { "line-cap": "round", "line-join": "round" },
        });
      }
    }

  }, [ready, styleEpoch, base, streets, purok, route, snapshot]);

  /*
   * Hazards and the destination, as pins (lib/mapMarks.ts) — the same marks as
   * the hazard map. HTML markers, so they survive a basemap swap untouched.
   * Hazards on the route are drawn larger: the overlay exists to answer "can I
   * get there", not "what is happening generally".
   */
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;

    const pins: maplibregl.Marker[] = [];
    for (const h of snapshot?.hazards ?? []) {
      // No point of its own: on its street's point, faded (see HazardSheet).
      const area = h.lat == null ? snapshot?.puroks.find((p) => p.id === h.purok_id) : undefined;
      const lat = h.lat ?? area?.lat ?? null;
      const lng = h.lng ?? area?.lng ?? null;
      if (lat == null || lng == null) continue;
      const category = h.category as Category;
      const onRoute = blocking.some((b) => b.id === h.id);
      const el = pinElement({
        colour: hazardColour(CATEGORY_TONE[category] ?? "alarm"),
        icon: HAZARD_ICON[category] ?? HAZARD_ICON.other,
        label: t(`cat.${category}`),
        height: onRoute ? 40 : 30,
        // No point of its own: "somewhere on this street", drawn faded.
        opacity: h.lat == null ? "0.7" : undefined,
        // Tapping says what it is and where, here on the map. The hazard map,
        // one button away in that card, holds the photo and RESOLVE.
        onClick: () => setSelection({ hazard: h.id }),
      });
      pins.push(pinMarker(el, lng, lat).addTo(m));
    }
    for (const w of placedWater) {
      const el = pinElement({
        colour: DEPTH_COLOUR[w.report.level_category],
        icon: WATER_ICON,
        label: `${t(`water.${w.report.level_category}`)} — ${w.report.location_label ?? ""}`,
        height: 28,
        // Faded for a street-only point, and more so for an old reading.
        opacity: waterOpacity(w),
        onClick: () => setSelection({ water: w.report.id }),
      });
      pins.push(pinMarker(el, w.lng, w.lat).addTo(m));
    }
    /* Every centre; the nearest one, where the route goes, drawn larger. */
    for (const c of snapshot?.centers ?? []) {
      if (c.lat == null || c.lng == null) continue;
      const el = pinElement({
        colour: "var(--color-clear)",
        icon: CENTRE_ICON,
        label: c.name,
        height: c.id === centre?.id ? 40 : 30,
        onClick: () => setSelection({ centre: c.id }),
      });
      const marker = pinMarker(el, c.lng, c.lat).addTo(m);
      if (c.id === centre?.id) marker.getElement().style.zIndex = "2";
      pins.push(marker);
    }
    return () => pins.forEach((pin) => pin.remove());
  }, [ready, snapshot, blocking, centre, placedWater, t]);

  /*
   * Framing, and only when the thing being framed changes.
   *
   * This used to sit at the end of the paint effect, which re-runs on every
   * snapshot refresh — so a hazard report arriving mid-walk would silently yank
   * the map back to its default view and undo the resident's pan and zoom. A
   * map that fights the person reading it is worse than one that never moves.
   */
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !frame) return;

    const key = `${purokId}:${styleEpoch}`;
    if (framed.current === key) return;

    return onStyleReady(m, () => {
      // The first framing of this map opens where the hazard map was left
      // (lib/mapView.ts); a later change of area frames that area's route.
      const saved = framed.current === null ? sharedView() : null;
      framed.current = key;
      if (saved) m.jumpTo(saved);
      else m.fitBounds(frame, { padding: 44, duration: 0, maxZoom: 16.5 });
    });
  }, [ready, styleEpoch, frame, purokId]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    return trackView(m, () => framed.current !== null);
  }, [ready]);

  /*
   * The resident's own position. An HTML marker, so it does not wait for the
   * style: gating it on isStyleLoaded dropped the first fix, and a phone
   * standing still may never send a second one — leaving only the centre dot,
   * which every phone draws in the same place.
   */
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !fix) return;

    if (!meMarker.current) {
      meMarker.current = new maplibregl.Marker({
        element: youElement(() => setSelection("you"), t("sos.location")),
      });
    }
    meMarker.current.setLngLat([fix.lng, fix.lat]).addTo(m);
  }, [fix, ready, t]);

  const recentre = useCallback(() => {
    if (fix) map.current?.easeTo({ center: [fix.lng, fix.lat], zoom: 16.5 });
  }, [fix]);

  const turnLabel =
    guidance?.turn === "arrive"
      ? t("map.arrive")
      : guidance?.turn === "left"
        ? t("map.turn_left")
        : guidance?.turn === "right"
          ? t("map.turn_right")
          : t("map.straight");

  /*
   * The base is named, not implied. A drawn schematic and a surveyed street map
   * look similar enough at a glance to be confused, and a resident deciding
   * which corner to turn at is entitled to know which of the two they are
   * reading. Written as two static lookups so `scripts/check-translations.mjs`
   * can see both keys — a key built from a variable is invisible to it.
   */
  const baseLabel =
    base === "streets" ? t("map.base_streets") : t("map.base_sketch");

  const routeColour = ROUTE_COLOUR;
  const selectedCentre =
    selection && selection !== "you" && "centre" in selection
      ? (snapshot?.centers.find((c) => c.id === selection.centre) ?? null)
      : null;
  const selectedHazard =
    selection && selection !== "you" && "hazard" in selection
      ? (snapshot?.hazards.find((h) => h.id === selection.hazard) ?? null)
      : null;
  const selectedWater =
    selection && selection !== "you" && "water" in selection
      ? (placedWater.find((w) => w.report.id === selection.water) ?? null)
      : null;
  const areaName = (id: string) => snapshot?.puroks.find((p) => p.id === id)?.name ?? "";
  const selectedRank = ranked.find((r) => r.centre.id === selectedCentre?.id);
  const others = ranked.slice(1);

  /* The warning names what is in the way: the hazard's note if it has one,
     else its kind; for water, the depth and where it was seen. */
  const inTheWay = blocking.length > 0 || deepWater.length > 0;
  const blockingLabel = blocking[0]
    ? (blocking[0].description ?? t(`cat.${blocking[0].category}`))
    : deepWater[0]
      ? [t(`water.${deepWater[0].report.level_category}`), deepWater[0].report.location_label]
          .filter(Boolean)
          .join(" · ")
      : "";
  const showWhatIsInTheWay = () =>
    setSelection(
      blocking[0] ? { hazard: blocking[0].id } : { water: deepWater[0].report.id },
    );

  /*
   * The route was redrawn to keep clear of something. Worth saying out loud:
   * the walk is longer than the one this resident may have taken all their
   * life, and a detour nobody explains is a detour people cut back across.
   */
  const detoured = nearest?.detour === true && blockers.length > 0;

  return (
    /*
     * The map is the screen: it fills everything between the header and the
     * tab bar, and the instructions float over it — the next turn and any
     * hazard on the way at the top, the destination at the foot. On a wide
     * screen the cards keep a readable width at the left instead of
     * stretching across the map (the shell is full width here, see Shell).
     */
    <main className="relative flex min-h-[28rem] flex-1 flex-col overflow-hidden">
      {/*
        Absolutely positioned, and inline rather than by class. Two separate
        things conspire to collapse this box to zero height, and it needs both
        fixes:

        1. `height: 100%` does not work here. The wrapper is a flex item, and
           a percentage height inside one resolves against an indefinite
           containing block — so it computes to auto, and with the canvas
           absolutely positioned there is no content to give it height.
        2. `absolute` as a utility class does not work either. MapLibre adds
           `.maplibregl-map` to this element after mount, and `maplibre-gl.css`
           sets `position: relative` on it, loading after the utilities and
           winning the cascade.

        Absolute + inset against the sized `relative` wrapper solves (1);
        being an inline style keeps it out of (2). The symptom of getting
        either wrong is a blank rectangle with every layer correctly loaded
        behind it, which reads as a data problem and is not one.
      */}
      <div
        ref={container}
        style={{ position: "absolute", inset: 0 }}
        // Controls and the map credit sit above the legend bar (two lines on a phone).
        className="[&_.maplibregl-ctrl-bottom-left]:bottom-14! [&_.maplibregl-ctrl-bottom-right]:bottom-14! sm:[&_.maplibregl-ctrl-bottom-left]:bottom-9! sm:[&_.maplibregl-ctrl-bottom-right]:bottom-9!"
      />

      {/*
        Top: where this is, the next turn, and anything blocking the way.

        Three stacked cards covered a third of the map on a phone — on the one
        screen where the map is the content. There, the route name and the
        offline note fold away behind the chevron on the turn row; the turn and
        the distance, the two things being walked by, never fold.
      */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 grid gap-1.5 p-2 sm:max-w-md sm:gap-2 sm:p-2.5">
        <div
          className={`pointer-events-auto items-center gap-2.5 rounded-instrument border-[1.5px] border-line-soft bg-ink-900/95 px-3 py-2 shadow-md sm:flex ${
            topOpen ? "flex" : "hidden"
          }`}
        >
          <Link href="/" aria-label="Back" className="shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-paper-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </Link>
          <h1 className="min-w-0 flex-1 truncate font-display text-[14.5px] font-extrabold tracking-[0.4px]">
            {t("map.title")} · {purok?.name ?? ""}
          </h1>
          {/*
            States what the map is running on. Offline this is the reassurance
            that matters; online it is a quiet reminder that it would still work.
          */}
          <span className="mono shrink-0 text-[8.5px] font-bold tracking-[0.7px] text-clear">
            {online ? t("map.offline_ready") : t("map.offline_now")}
          </span>
        </div>

        {guidance && route.length > 0 && (
          <div className="pointer-events-auto flex items-center gap-2.5 rounded-instrument border-[1.5px] border-line-soft bg-ink-900/95 px-3 py-1.5 shadow-md sm:gap-3 sm:px-3.5 sm:py-2.5">
            <Link href="/" aria-label="Back" className="shrink-0 sm:hidden">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--color-paper-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </Link>
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke={ROUTE_EDGE}
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
              style={{
                transform:
                  guidance.turn === "left"
                    ? "rotate(-90deg)"
                    : guidance.turn === "right"
                      ? "rotate(90deg)"
                      : "none",
              }}
              aria-hidden
            >
              <path d="M12 20V5" />
              <path d="M5 12l7-7 7 7" />
            </svg>
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold sm:text-[15px]">{turnLabel}</span>
            <span className="mono shrink-0 text-[15px] font-bold sm:text-[17px]">
              {guidance.metres}
              <span className="text-[11px] text-paper-3"> m</span>
            </span>
            {/* Phone only: opens the row this one stands in for. */}
            <button
              type="button"
              onClick={() => setTopOpen((open) => !open)}
              aria-expanded={topOpen}
              aria-label={t("map.title")}
              className="shrink-0 pl-0.5 sm:hidden"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-paper-3)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className={topOpen ? "rotate-180" : ""} aria-hidden>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>
        )}

        {/*
          The route already goes round what it could. Shown instead of nothing,
          and never at the same time as the warning below: either this walk
          keeps clear, or it does not.
        */}
        {detoured && !inTheWay && (
          <div className="pointer-events-auto flex w-full items-center gap-2 rounded-instrument border-[1.5px] border-clear bg-ink-900/95 px-3 py-1.5 shadow-md sm:gap-2.5 sm:py-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-clear)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
              <path d="M4 20h6a4 4 0 0 0 4-4V8a4 4 0 0 1 4-4h2" />
              <path d="M17 1l3 3-3 3" />
            </svg>
            <span className="min-w-0 flex-1 truncate text-[12px] leading-snug font-semibold sm:text-[12.5px]">
              {t("map.rerouted")}
            </span>
          </div>
        )}

        {/* The blocked-path warning: it changes whether the destination is reachable at all. */}
        {inTheWay && (
          <button
            type="button"
            // Tapping the warning goes to the thing being warned about.
            onClick={showWhatIsInTheWay}
            className="pointer-events-auto flex w-full items-center gap-2 rounded-instrument border-[1.5px] border-alarm bg-ink-900/95 px-3 py-1.5 text-left shadow-md sm:gap-2.5 sm:py-2.5">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--color-alarm)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
              <path d="M12 9v5" /><path d="M12 17h.01" />
              <path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
            <span className="min-w-0 flex-1 truncate text-[12px] leading-snug font-semibold sm:text-[12.5px]">{blockingLabel}</span>
            <span className="mono shrink-0 text-[10px] font-bold tracking-[0.8px] text-alarm">
              {nearest?.unavoidable ? t("map.no_way_round") : t("map.avoid")}
            </span>
          </button>
        )}
      </div>

      {/* Bottom: the destination, or whatever was tapped on the map. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-14 z-10 grid gap-2 p-2.5 pr-14 sm:bottom-9 sm:max-w-md sm:pr-2.5">
        {selectedHazard ? (
          <div className="pointer-events-auto shadow-md">
            <HazardBrief
              hazard={selectedHazard}
              area={areaName(selectedHazard.purok_id)}
              now={now}
              onOpen={() => focusHazard(selectedHazard.id)}
              onClose={() => setSelection(null)}
            />
          </div>
        ) : selectedWater ? (
          <div className="pointer-events-auto shadow-md">
            <WaterBrief
              report={selectedWater.report}
              area={areaName(selectedWater.report.purok_id)}
              approx={selectedWater.approx}
              stale={selectedWater.stale}
              now={now}
              onOpen={() => focusWater(selectedWater.report.id)}
              onClose={() => setSelection(null)}
            />
          </div>
        ) : selectedCentre ? (
          <div className="pointer-events-auto shadow-md">
            <CentreDetail
              centre={selectedCentre}
              metres={selectedRank?.metres}
              minutes={selectedRank ? walkMinutes(selectedRank.metres) : undefined}
              onClose={() => setSelection(null)}
            />
          </div>
        ) : selection === "you" && fix ? (
          <div className="pointer-events-auto shadow-md">
            <YouDetail fix={fix} onClose={() => setSelection(null)} />
          </div>
        ) : centre ? (
          <section className="pointer-events-auto grid gap-1.5 rounded-instrument border-[1.5px] border-line-soft bg-ink-900/95 px-3 py-2 shadow-md sm:px-3.5 sm:py-2.5">
            <button
              type="button"
              onClick={() => setShowOthers((open) => !open)}
              aria-expanded={showOthers}
              disabled={others.length === 0}
              className="flex items-center gap-3 text-left"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-hv)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
                <circle cx="6" cy="19" r="2" />
                <circle cx="18" cy="5" r="2" />
                <path d="M8 19h7a4 4 0 0 0 4-4v-1a4 4 0 0 0-4-4H9a4 4 0 0 1-4-4v-1" />
              </svg>
              <div className="min-w-0 flex-1">
                {/* On a phone the name and the distance are the card until it is opened. */}
                <p className={`lbl text-[9px] sm:block ${showOthers ? "block" : "hidden"}`}>
                  {ranked.length > 1 ? t("evac.nearest") : t("ui.evac_center")}
                </p>
                <h2 className="truncate font-display text-[15px] leading-tight font-extrabold tracking-[0.3px] sm:text-[17px]">
                  {centre.name.toUpperCase()}
                </h2>
                {nearest && (
                  <p className={`mono text-[8.5px] tracking-[0.6px] text-paper-3 sm:block ${showOthers ? "block" : "hidden"}`}>
                    {fromYou ? t("evac.from_you") : t("evac.from_street")}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="mono text-[15px] leading-none font-bold sm:text-[17px]">
                  {Math.round(routeMetres)}
                  <span className="text-[11px] text-paper-3"> M</span>
                </p>
                <p className={`mono mt-1 text-[9.5px] tracking-[0.6px] text-paper-3 sm:block ${showOthers ? "block" : "hidden"}`}>
                  {walkMinutes(routeMetres)} {t("map.walk")}
                </p>
              </div>
              {others.length > 0 && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-paper-3)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${showOthers ? "" : "rotate-180"}`} aria-hidden>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              )}
            </button>

            {/* The other centres, nearest first: somewhere to go if the first is full or cut off. */}
            {showOthers && others.length > 0 && (
              <div className="grid gap-0.5 border-t border-line-soft pt-1.5">
                <p className="lbl text-[9px]">{t("evac.other_centres")}</p>
                {others.map((r) => (
                  <button
                    key={r.centre.id}
                    type="button"
                    onClick={() => setSelection({ centre: r.centre.id })}
                    className="flex min-h-10 items-center gap-2 text-left"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{r.centre.name}</span>
                    <span className="mono shrink-0 text-[12px] font-bold">
                      {r.metres}
                      <span className="text-[10px] text-paper-3">
                        {" "}M · {walkMinutes(r.metres)} {t("map.walk")}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : (
          <p className="pointer-events-auto mono rounded-instrument bg-ink-900/95 px-3 py-2 text-[11px] text-paper-3 shadow-md">
            {t("ui.no_protocol")}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={recentre}
        disabled={!fix}
        aria-label={t("map.recentre")}
        className="tap absolute right-2.5 bottom-[140px] z-10 sm:bottom-[118px] flex size-11 items-center justify-center rounded-[3px] border-[1.5px] border-line bg-ink-800/95 shadow-sm disabled:opacity-40"
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--color-hv)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
      </button>

      {/*
        The legend, as a status bar across the foot of the map rather than a
        floating block on top of it, with room on the right to name the base map.
      */}
      <MapLegend
        water
        routeColour={routeColour}
        right={
          <span className="mono text-[9px] font-semibold tracking-[0.7px] text-paper-3">
            {baseLabel}
          </span>
        }
      />
    </main>
  );
}
