"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useSync, useT } from "@/components/AppRuntime";
import { deriveAdvisory } from "@/lib/advisory";
import { resolveColour, signalStyle } from "@/lib/signal";
import { startPositionWatch, type Fix } from "@/lib/sos";
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
 * the real OpenFreeMap dark basemap — the same one the rescue map uses
 * (`/responder`) — is fetched and swapped in behind the same overlays, so the
 * two map screens read as one product. See lib/basemap.ts for why the swap runs
 * in that order and not the other.
 */

/** Fits the whole synthetic barangay; replaced when real bounds land. */
const FALLBACK_CENTRE: [number, number] = [121.4156, 14.2797];

export default function MapPage() {

  const { snapshot, purokId, language, online } = useSync();
  const t = useT();

  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const meMarker = useRef<maplibregl.Marker | null>(null);
  /** One basemap-upgrade attempt in flight, and one framing per style, per map
      instance. Declared with the map itself because that is what they track. */
  const upgrading = useRef(false);
  const framed = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [streets, setStreets] = useState<FeatureCollection | null>(null);

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
  const route = useMemo(
    () => (advisory?.protocol?.route_geojson?.coordinates ?? []) as Point[],
    [advisory],
  );
  const centre = advisory?.center ?? null;

  const routeMetres = useMemo(() => (route.length ? lineLength(route) : 0), [route]);

  /* Hazards sitting on this route, which is the whole point of the overlay. */
  const blocking = useMemo(
    () => (route.length && snapshot ? hazardsOnRoute(snapshot.hazards, route) : []),
    [snapshot, route],
  );

  const guidance = useMemo(() => {
    if (!route.length) return null;
    const from: Point = fix ? [fix.lng, fix.lat] : route[0];
    return nextTurn(route, from);
  }, [route, fix]);

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
  const frame = useMemo(() => {
    const points: Point[] = [...route];
    if (centre?.lat != null && centre?.lng != null) {
      points.push([centre.lng, centre.lat]);
    }
    for (const ring of purok?.boundary_geojson?.coordinates ?? []) {
      for (const point of ring) points.push(point as Point);
    }
    if (!points.length) return null;

    const lngs = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    return [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ] as [[number, number], [number, number]];
  }, [route, centre, purok]);

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
      "top-right",
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
  useEffect(() => {
    if (!ready || !online || upgrading.current) return;
    const m = map.current;
    if (!m) return;
    upgrading.current = true;

    void loadStreetStyle().then((style) => {
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
        return;
      }

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
        // A licence condition of the OpenStreetMap data, not decoration.
        m.addControl(new maplibregl.AttributionControl({ compact: true }), "top-left");
        setBase("streets");
        setStyleEpoch((n) => n + 1);
      });
    });
  }, [ready, online]);

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

    const setSource = (id: string, data: Feature | FeatureCollection) => {
      const existing = m.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (existing) existing.setData(data as FeatureCollection);
      else m.addSource(id, { type: "geojson", data });
    };

    /* The drawn grid is the base only when there is no surveyed one under it.
       Both at once would put invented streets over real ones. */
    if (base === "sketch") {
      setSource("streets", streets);
      if (!m.getLayer("blocks")) {
        m.addLayer({
          id: "blocks",
          type: "fill",
          source: "streets",
          filter: ["==", ["get", "kind"], "block"],
          paint: { "fill-color": "#141922" },
        });
        m.addLayer({
          id: "roads",
          type: "line",
          source: "streets",
          filter: ["!=", ["get", "kind"], "block"],
          paint: {
            "line-color": "#222a36",
            "line-width": ["case", ["==", ["get", "kind"], "main"], 9, 5],
          },
        });
      }
    }

    /* Purok boundary — dashed, so it reads as an administrative edge rather
       than a wall or a road. */
    if (purok?.boundary_geojson) {
      setSource("boundary", {
        type: "Feature",
        properties: {},
        geometry: purok.boundary_geojson,
      } as Feature);

      if (!m.getLayer("boundary-line")) {
        m.addLayer({
          id: "boundary-fill",
          type: "fill",
          source: "boundary",
          paint: { "fill-color": "#5ee7e0", "fill-opacity": 0.05 },
        });
        m.addLayer({
          id: "boundary-line",
          type: "line",
          source: "boundary",
          paint: {
            "line-color": "#5ee7e0",
            "line-width": 2,
            "line-dasharray": [3, 2],
          },
        });
      }
    }

    /* The route, in the severity colour of the current signal — the same ramp
       as the placard, so the map is legibly part of the same advisory. */
    if (route.length) {
      setSource("route", {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: route },
      } as Feature);

      const colour = resolveColour(signalStyle(advisory?.signalLevel ?? 0).cssVar);
      if (!m.getLayer("route-line")) {
        m.addLayer({
          id: "route-casing",
          type: "line",
          source: "route",
          paint: { "line-color": "#0b0e12", "line-width": 11 },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        m.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          paint: { "line-color": colour, "line-width": 6 },
          layout: { "line-cap": "round", "line-join": "round" },
        });
      } else {
        m.setPaintProperty("route-line", "line-color", colour);
      }
    }

    /* Hazards. Ones on the route are drawn larger — the overlay exists to
       answer "can I get there", not "what is happening generally". */
    const placed = (snapshot?.hazards ?? []).filter(
      (h) => h.lat != null && h.lng != null,
    );
    setSource("hazards", {
      type: "FeatureCollection",
      features: placed.map((h) => ({
        type: "Feature",
        properties: { onRoute: blocking.some((b) => b.id === h.id) },
        geometry: { type: "Point", coordinates: [h.lng as number, h.lat as number] },
      })),
    } as FeatureCollection);

    if (!m.getLayer("hazard-dots")) {
      m.addLayer({
        id: "hazard-dots",
        type: "circle",
        source: "hazards",
        paint: {
          "circle-radius": ["case", ["get", "onRoute"], 9, 6],
          "circle-color": "#ef4b3a",
          "circle-stroke-color": "#0b0e12",
          "circle-stroke-width": 2.5,
        },
      });
    }

    /* Destination. */
    if (centre?.lat != null && centre?.lng != null) {
      setSource("centre", {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [centre.lng, centre.lat] },
      } as Feature);

      if (!m.getLayer("centre-dot")) {
        m.addLayer({
          id: "centre-dot",
          type: "circle",
          source: "centre",
          paint: {
            "circle-radius": 10,
            "circle-color": "#5ee7e0",
            "circle-stroke-color": "#0b0e12",
            "circle-stroke-width": 3,
          },
        });
      }
    }

  }, [ready, styleEpoch, base, streets, purok, route, centre, snapshot, blocking, advisory]);

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
      framed.current = key;
      m.fitBounds(frame, { padding: 44, duration: 0, maxZoom: 16.5 });
    });
  }, [ready, styleEpoch, frame, purokId]);

  /* The resident's own position. */
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !fix || !m.isStyleLoaded()) return;

    if (!meMarker.current) {
      const dot = document.createElement("div");
      dot.style.cssText =
        "width:18px;height:18px;border-radius:50%;background:#5ee7e0;border:3px solid #0b0e12;box-shadow:0 0 0 6px rgba(94,231,224,0.25)";
      meMarker.current = new maplibregl.Marker({ element: dot });
    }
    meMarker.current.setLngLat([fix.lng, fix.lat]).addTo(m);
  }, [fix, ready]);

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

  const routeColour = signalStyle(advisory?.signalLevel ?? 0).cssVar;

  return (
    <>
      <div className="flex items-center gap-3 px-3.5 py-3">
        <Link href="/" aria-label="Back" className="shrink-0">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--color-paper-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </Link>
        <h1 className="flex-1 font-display text-base font-extrabold tracking-[0.4px]">
          {t("map.title")} · {purok?.name ?? ""}
        </h1>
        {/*
          States what the map is running on. Offline this is the reassurance
          that matters; online it is a quiet reminder that it would still work.
        */}
        <span className="mono text-[9px] font-bold tracking-[0.7px] text-clear">
          {online ? t("map.offline_ready") : t("map.offline_now")}
        </span>
      </div>

      {/* One rhythm for the whole screen — the same `gap-2.5 p-3.5` column
          every other page is built on, so the map reads as one card among
          several rather than as a slab wedged between two loose strips. */}
      <main className="flex flex-1 flex-col gap-2.5 p-3.5 pt-0">
        {guidance && route.length > 0 && (
        <div className="flex items-center gap-3 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3.5 py-3">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke={routeColour}
            strokeWidth="2.4"
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
          <span className="flex-1 text-[15px] font-bold">{turnLabel}</span>
          <span className="mono text-[17px] font-bold">
            {guidance.metres}
            <span className="text-[11px] text-paper-3"> m</span>
          </span>
        </div>
      )}

        {/* A floor as well as `flex-1`: on a short viewport the cards below
            would otherwise squeeze the map to a sliver, and a map too small to
            show the next corner is not worth the space it holds. */}
        <div className="relative min-h-56 flex-1 overflow-hidden rounded-instrument border-[1.5px] border-line-soft">
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
        />

        <button
          type="button"
          onClick={recentre}
          disabled={!fix}
          aria-label={t("map.recentre")}
          className="tap absolute right-2.5 bottom-11 flex size-11 items-center justify-center rounded-[3px] border-[1.5px] border-line bg-ink-800/95 disabled:opacity-40"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--color-hv)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="3.5" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </button>

        {/*
          The legend, as a status bar across the foot of the map rather than a
          floating block on top of it. The floating version covered a quarter of
          the canvas on a phone — on the one screen where the canvas IS the
          content. This costs no layout height, occludes nothing but the bottom
          edge, and has room on the right to name the base map.
        */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-3 border-t border-line-soft bg-ink-900/92 px-2.5 py-1.5">
          <Key colour="#5ee7e0" dashed label={t("map.legend_boundary")} />
          <Key colour={routeColour} label={t("map.legend_route")} />
          <Key colour="#ef4b3a" dot label={t("map.legend_hazard")} />
          <span className="mono ml-auto truncate text-[9px] font-semibold tracking-[0.7px] text-paper-3">
            {baseLabel}
          </span>
        </div>
        </div>

        {/* The blocked-path warning. Above the destination, because it changes
            whether the destination is reachable at all. */}
        {blocking.length > 0 && (
          <div className="flex items-center gap-2.5 rounded-instrument border-[1.5px] border-alarm bg-alarm/10 px-3 py-2.5">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--color-alarm)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
              <path d="M12 9v5" /><path d="M12 17h.01" />
              <path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
            <span className="flex-1 text-[12.5px] leading-snug font-semibold">
              {blocking[0].description ?? blocking[0].category}
            </span>
            <span className="mono shrink-0 text-[10px] font-bold tracking-[0.8px] text-alarm">
              {t("map.avoid")}
            </span>
          </div>
        )}

        {/*
          The destination, as a card rather than as loose text under the map.
          It is the same fact the advisory card on the home screen ends with, so
          it is given the same shape: label, name, and the numbers in mono on
          the right where every other screen puts its numbers.
        */}
        {centre ? (
          <section className="flex items-center gap-3 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3.5 py-3">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-hv)"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
              aria-hidden
            >
              <circle cx="6" cy="19" r="2" />
              <circle cx="18" cy="5" r="2" />
              <path d="M8 19h7a4 4 0 0 0 4-4v-1a4 4 0 0 0-4-4H9a4 4 0 0 1-4-4v-1" />
            </svg>
            <div className="min-w-0 flex-1">
              <p className="lbl text-[9px]">{t("ui.evac_center")}</p>
              <h2 className="truncate font-display text-[18px] leading-tight font-extrabold tracking-[0.3px]">
                {centre.name.toUpperCase()}
              </h2>
            </div>
            <div className="shrink-0 text-right">
              <p className="mono text-[17px] leading-none font-bold">
                {Math.round(routeMetres)}
                <span className="text-[11px] text-paper-3"> M</span>
              </p>
              <p className="mono mt-1 text-[9.5px] tracking-[0.6px] text-paper-3">
                {walkMinutes(routeMetres)} {t("map.walk")}
              </p>
            </div>
          </section>
        ) : (
          <p className="mono text-[11px] text-paper-3">{t("ui.no_protocol")}</p>
        )}
      </main>
    </>
  );
}

/**
 * One legend key. The swatch is drawn the way the layer is drawn — a dashed
 * rule for the dashed boundary, a dot for the hazard circles — so the legend
 * can be matched to the map by shape and not only by colour. Roughly a tenth of
 * Filipino men are red-green colour blind, and this is a map whose two most
 * important marks are a red one and a green one.
 */
function Key({
  colour,
  label,
  dashed,
  dot,
}: {
  colour: string;
  label: string;
  dashed?: boolean;
  dot?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      {dot ? (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: colour }}
          aria-hidden
        />
      ) : (
        <span
          className="h-[3px] w-3.5 shrink-0"
          style={
            dashed
              ? { backgroundImage: `repeating-linear-gradient(90deg, ${colour} 0 4px, transparent 4px 7px)` }
              : { background: colour }
          }
          aria-hidden
        />
      )}
      <span className="mono text-[9px] font-semibold tracking-[0.6px] text-paper-2">
        {label}
      </span>
    </span>
  );
}
