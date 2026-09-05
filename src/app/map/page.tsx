"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useSync, useT } from "@/components/AppRuntime";
import { deriveAdvisory } from "@/lib/advisory";
import { resolveColour, signalStyle } from "@/lib/signal";
import { startPositionWatch, type Fix } from "@/lib/sos";
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
 * Every layer is GeoJSON, and every piece of it is already on the device: the
 * Purok boundary and route ride in the advisory snapshot cached in IndexedDB,
 * and the street grid is a precached static file. There is no tile server and
 * no network call in this view at all, which is what lets it open, pan and
 * render with the connection gone.
 *
 * That is also why the base map is drawn rather than fetched: Barangay San
 * Isidro is synthetic (Q4), so no tile source has streets for it. When real
 * geography arrives the same GeoJSON layers sit on top of a PMTiles basemap —
 * one static file per barangay, cached the same way.
 */

/** Fits the whole synthetic barangay; replaced when real bounds land. */
const FALLBACK_CENTRE: [number, number] = [121.4156, 14.2797];

export default function MapPage() {

  const { snapshot, purokId, language, online } = useSync();
  const t = useT();

  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const meMarker = useRef<maplibregl.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [streets, setStreets] = useState<FeatureCollection | null>(null);

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

  /* Build the map once. */
  useEffect(() => {
    if (!container.current || map.current || !streets) return;

    map.current = new maplibregl.Map({
      container: container.current,
      // No `style` URL: an empty style with our own sources means the map has
      // nothing to download and therefore nothing to fail offline.
      style: {
        version: 8,
        // No `glyphs` key at all. Setting it to undefined is not the same as
        // omitting it — MapLibre validates the style and rejects
        // "glyphs: string expected, undefined found", which invalidates the
        // whole style and renders nothing. There are no text layers here, so
        // no glyph server is needed, which is also what keeps the map offline.
        sources: {},
        layers: [
          { id: "ground", type: "background", paint: { "background-color": "#0b0e12" } },
        ],
      },
      center: FALLBACK_CENTRE,
      zoom: 14.4,
      attributionControl: false,
    });

    map.current.on("load", () => setReady(true));

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
    };
  }, [streets]);

  /* Paint every layer from data already on the device. */
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !streets) return;

    const setSource = (id: string, data: Feature | FeatureCollection) => {
      const existing = m.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (existing) existing.setData(data as FeatureCollection);
      else m.addSource(id, { type: "geojson", data });
    };

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

    /* Frame the route the first time there is one to frame. */
    if (route.length) {
      const lngs = route.map((p) => p[0]);
      const lats = route.map((p) => p[1]);
      m.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 60, duration: 0, maxZoom: 16.5 },
      );
    }
  }, [ready, streets, purok, route, centre, snapshot, blocking, advisory]);

  /* The resident's own position. */
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !fix) return;

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

      {guidance && route.length > 0 && (
        <div className="mx-3.5 flex items-center gap-3 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3.5 py-3">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke={signalStyle(advisory?.signalLevel ?? 0).cssVar}
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

      <div className="relative mx-3.5 mt-2.5 flex-1 overflow-hidden rounded-instrument border-[1.5px] border-line-soft">
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

        <div className="pointer-events-none absolute bottom-2.5 left-2.5 flex flex-col gap-1.5 rounded-[3px] border-[1.5px] border-line-soft bg-ink-900/90 px-2.5 py-2">
          <Key colour="#5ee7e0" dashed label={t("map.legend_boundary")} />
          <Key colour={signalStyle(advisory?.signalLevel ?? 0).cssVar} label={t("map.legend_route")} />
          <Key colour="#ef4b3a" label={t("map.legend_hazard")} />
        </div>

        <button
          type="button"
          onClick={recentre}
          disabled={!fix}
          aria-label={t("map.recentre")}
          className="tap absolute right-2.5 bottom-2.5 flex size-11 items-center justify-center rounded-[3px] border-[1.5px] border-line-soft bg-ink-800 disabled:opacity-40"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--color-hv)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="3.5" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </button>
      </div>

      <div className="flex flex-col gap-2.5 p-3.5">
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

        {centre ? (
          <div>
            <div className="flex items-end justify-between gap-3">
              <h2 className="font-display text-[19px] font-extrabold tracking-[0.3px]">
                {centre.name.toUpperCase()}
              </h2>
              <span className="mono shrink-0 text-[11px] text-paper-3">
                {Math.round(routeMetres)} M · {walkMinutes(routeMetres)}{" "}
                {t("map.walk")}
              </span>
            </div>
          </div>
        ) : (
          <p className="mono text-[11px] text-paper-3">{t("ui.no_protocol")}</p>
        )}
      </div>
    </>
  );
}

function Key({
  colour,
  label,
  dashed,
}: {
  colour: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="h-[3px] w-4 shrink-0"
        style={
          dashed
            ? { backgroundImage: `repeating-linear-gradient(90deg, ${colour} 0 4px, transparent 4px 7px)` }
            : { background: colour }
        }
        aria-hidden
      />
      <span className="mono text-[9px] font-semibold tracking-[0.8px] text-paper-2">
        {label}
      </span>
    </span>
  );
}
