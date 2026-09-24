"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
// Namespace import: maplibre-gl ships no default export, and importing one
// type-checks under `esModuleInterop` but fails at bundle time.
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useSync, useT } from "@/components/AppRuntime";
import { useTheme } from "@/components/useTheme";
import { MapLegend } from "@/components/MapLegend";
import { loadStreetStyle, onStyleReady, sketchStyle } from "@/lib/basemap";
import { barangayCentre } from "@/lib/advisory";
import { sharedView, trackView } from "@/lib/mapView";
import {
  CENTRE_ICON,
  HAZARD_ICON,
  SOS_ICON,
  WATER_ICON,
  hazardColour,
  pinElement,
  pinMarker,
  youElement,
} from "@/lib/mapMarks";
import { CATEGORY_TONE, allOpenHazards, subscribeHazards, type Hazard } from "@/lib/hazards";
import { allWaterReports, subscribeWaterReports, type WaterReport } from "@/lib/water";
import { DEPTH_COLOUR, placeWater, waterOpacity } from "@/lib/waterMap";
import { HazardBrief, WaterBrief } from "@/components/MapDetail";
import { focusHazard, focusWater } from "@/lib/hazardFocus";
import { onQueueChanged } from "@/lib/offlineQueue";
import { resolveColour } from "@/lib/signal";
import {
  acknowledge,
  activeQueue,
  markRescued,
  startPositionWatch,
  subscribeRescue,
  waitMinutes,
  type Fix,
  type RescueRequest,
} from "@/lib/sos";
import {
  acceptedSosPref,
  clearResponderRoute,
  drawResponderRoute,
  routeToCall,
} from "@/lib/responderRoute";
import type { Point } from "@/lib/geo";
import { SkeletonLines, useSkeletonGate } from "@/components/Skeleton";
import { PersonLabel } from "@/components/PersonLabel";
import { namesFor, type NamedPerson } from "@/lib/profile";

/**
 * Live rescue map (PRD §7.4, FR-4.6).
 *
 * The same map as every other screen in the product now: built on the drawn
 * sketch that cannot fail, upgraded to real streets when there is a signal,
 * following the theme, and sharing its camera with the evacuation and hazard
 * maps (lib/mapView.ts) — so a volunteer who looked at a street on one screen
 * finds the same view here. It fills the screen, with the queue over it: a
 * column beside the map on a laptop at the hall, a sheet over it on a phone.
 *
 * The list still needs the network to stay current (PRD §17) and says so.
 * Requests queue on residents' phones offline regardless; that half is
 * unaffected.
 */
/** A laptop at the hall shows the queue beside the map; a phone does not. */
const WIDE_QUERY = "(min-width: 1024px)";
function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const isWide = () => window.matchMedia(WIDE_QUERY).matches;

export default function ResponderPage() {
  const { snapshot, online } = useSync();
  const t = useT();
  const { theme } = useTheme();

  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const meMarker = useRef<maplibregl.Marker | null>(null);
  const framed = useRef(false);
  /** The theme whose basemap is on screen, and the map that has the credit. */
  const painted = useRef<string | null>(null);
  const credited = useRef<maplibregl.Map | null>(null);

  const [queue, setQueue] = useState<RescueRequest[]>([]);
  /* Who is asking, for the responder. Names are staff-only by RLS. */
  const [people, setPeople] = useState<Map<string, NamedPerson>>(new Map());
  const [now, setNow] = useState(() => Date.now());
  const [epoch, setEpoch] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /* The same two overlays the residents' maps carry: open hazards, and water
     readings from the last day. A rescuer needs to know what is in the way. */
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [water, setWater] = useState<WaterReport[]>([]);
  const [mark, setMark] = useState<{ hazard: string } | { water: string } | null>(null);
  /* This phone's own position, for the route to the call it has taken. */
  const [fix, setFix] = useState<Fix | null>(null);
  /*
   * The call this phone is answering, and whether the map is following it.
   * Both are this device's own: the call is shared, the route to it is not.
   */
  const accepted = useSyncExternalStore(
    acceptedSosPref.subscribe,
    () => acceptedSosPref.get(),
    () => null,
  );
  const [following, setFollowing] = useState(true);
  /* Kept with the call it belongs to, so a stale distance cannot be shown
     against a different one. */
  const [routeInfo, setRouteInfo] = useState<{ id: string; metres: number } | null>(null);
  /* Null until the volunteer opens or closes it: the screen decides until then. */
  const [listChoice, setListChoice] = useState<boolean | null>(null);
  const wide = useSyncExternalStore(subscribeWide, isWide, () => false);
  const listOpen = listChoice ?? wide;
  /* First read finished — not "there is somebody waiting". An empty queue is a
     settled answer and should read as one. */
  const [settled, setSettled] = useState(false);

  const refresh = useCallback(async () => {
    const rows = await activeQueue();
    setQueue(rows);
    setPeople(await namesFor(rows.map((r) => r.requested_by ?? "")));
    setSettled(true);
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refresh());
    // Realtime rather than polling (FR-4.6, NFR-3.3).
    const stopLive = subscribeRescue(() => void refresh());
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stopLive();
      window.clearInterval(tick);
    };
  }, [refresh]);

  useEffect(() => startPositionWatch((next) => setFix(next)), []);

  /* Live, like the queue: a road blocked while a boat is out matters here. */
  useEffect(() => {
    const load = () =>
      void Promise.all([allOpenHazards(100), allWaterReports(40)]).then(([open, recent]) => {
        setHazards(open);
        setWater(recent);
      });
    queueMicrotask(load);
    const stops = [subscribeHazards(load), subscribeWaterReports(load), onQueueChanged(load)];
    return () => stops.forEach((stop) => stop());
  }, []);

  /*
   * The call being answered, if it is still open. A call that has been marked
   * rescued simply leaves the queue, and with it the route and the lock — for
   * every responder who took it, without anyone clearing anything by hand.
   */
  const answering = accepted ? (queue.find((r) => r.id === accepted) ?? null) : null;
  const target: Point | null =
    answering?.lat != null && answering.lng != null ? [answering.lng, answering.lat] : null;

  const take = useCallback((id: string) => {
    acceptedSosPref.set(id);
    setFollowing(true);
    setSelectedId(id);
  }, []);

  const barangay = snapshot?.barangay ?? null;

  /* Build once, on the style that cannot fail. */
  useEffect(() => {
    const node = container.current;
    if (!node || map.current) return;

    const instance = new maplibregl.Map({
      container: node,
      style: sketchStyle(),
      center: barangayCentre(barangay),
      zoom: 14,
      attributionControl: false,
    });
    map.current = instance;

    // No compass: every map here is read north-up, and a control that can only
    // rotate the barangay away from that is one more thing to undo at three in
    // the morning.
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    instance.on("error", (event) => console.error("[rescue-map]", event.error?.message ?? event));
    instance.on("load", () => setEpoch((n) => n + 1));

    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(node);
    const stopTracking = trackView(instance, () => framed.current);

    return () => {
      observer.disconnect();
      stopTracking();
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      instance.remove();
      map.current = null;
      framed.current = false;
      painted.current = null;
    };
    // Built once per visit, centred on the barangay known at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Real streets when there is a signal, in the theme on screen. */
  useEffect(() => {
    const m = map.current;
    if (!m || !online || painted.current === theme) return;
    painted.current = theme;
    void loadStreetStyle(theme).then((style) => {
      if (!style || map.current !== m) {
        painted.current = null;
        return;
      }
      m.setStyle(style, { diff: false });
      onStyleReady(m, () => {
        if (map.current !== m) return;
        // A licence condition of the OpenStreetMap data, and added once per
        // map rather than once per style swap.
        if (credited.current !== m) {
          credited.current = m;
          m.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
        }
        setEpoch((n) => n + 1);
      });
    });
  }, [online, epoch, theme]);

  /* The barangay outline, as on the other maps. Re-added after a style swap. */
  const outline = barangay?.boundary_geojson ?? null;
  useEffect(() => {
    const m = map.current;
    if (!m || !outline) return;
    return onStyleReady(m, () => {
      const accent = resolveColour("var(--color-hv)");
      const data = { type: "Feature", properties: {}, geometry: outline } as const;
      const source = m.getSource("boundary") as maplibregl.GeoJSONSource | undefined;
      if (source) source.setData(data);
      else m.addSource("boundary", { type: "geojson", data });
      if (!m.getLayer("boundary-line")) {
        m.addLayer({
          id: "boundary-fill",
          type: "fill",
          source: "boundary",
          paint: { "fill-color": accent, "fill-opacity": 0.06 },
        });
        m.addLayer({
          id: "boundary-line",
          type: "line",
          source: "boundary",
          paint: { "line-color": accent, "line-width": 2, "line-dasharray": [3, 2] },
        });
      }
    });
  }, [outline, epoch]);

  /* A hazard with no point of its own sits on its street's point, faded. */
  const placedHazards = useMemo(
    () =>
      hazards.flatMap((h) => {
        if (h.lat != null && h.lng != null) return [{ ...h, approx: false }];
        const area = snapshot?.puroks.find((a) => a.id === h.purok_id);
        return area?.lat != null && area.lng != null
          ? [{ ...h, lat: area.lat, lng: area.lng, approx: true }]
          : [];
      }),
    [hazards, snapshot],
  );
  const placedWater = useMemo(() => placeWater(snapshot, water, now), [snapshot, water, now]);

  /* Pins: the centres, the other reports, then every call. The same marks as the other maps. */
  const centres = snapshot?.centers;
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];

    for (const centre of centres ?? []) {
      if (centre.lat == null || centre.lng == null) continue;
      const el = pinElement({
        colour: "var(--color-clear)",
        icon: CENTRE_ICON,
        label: centre.name,
        height: 32,
      });
      markers.current.push(pinMarker(el, centre.lng, centre.lat).addTo(m));
    }

    for (const h of placedHazards) {
      const el = pinElement({
        colour: hazardColour(CATEGORY_TONE[h.category] ?? "alarm"),
        icon: HAZARD_ICON[h.category] ?? HAZARD_ICON.other,
        label: t(`cat.${h.category}`),
        height: 30,
        // A street's point, not the reporter's: "somewhere here", drawn faded.
        opacity: h.approx ? "0.7" : undefined,
        onClick: () => setMark({ hazard: h.id }),
      });
      markers.current.push(pinMarker(el, h.lng as number, h.lat as number).addTo(m));
    }

    for (const w of placedWater) {
      const el = pinElement({
        colour: DEPTH_COLOUR[w.report.level_category],
        icon: WATER_ICON,
        label: t(`water.${w.report.level_category}`),
        height: 28,
        // Faded for a street-only point, and more so for an old reading.
        opacity: waterOpacity(w),
        onClick: () => setMark({ water: w.report.id }),
      });
      markers.current.push(pinMarker(el, w.lng, w.lat).addTo(m));
    }

    for (const request of queue) {
      /*
       * A request with no fix cannot be plotted. It is deliberately NOT
       * dropped — it stays in the list with its Purok, because a person
       * without GPS is not a person without an emergency.
       */
      if (request.lat == null || request.lng == null) continue;
      const selected = request.id === selectedId;
      const el = pinElement({
        colour: request.status === "acknowledged" ? "var(--color-caution)" : "var(--color-alarm)",
        icon: SOS_ICON,
        label: t("nav.sos"),
        height: selected ? 46 : 38,
        // Every open call pulses. It is the only animated mark on the map.
        pulse: true,
        onClick: () => {
          setMark(null);
          setSelectedId(request.id);
          setListChoice(true);
          m.easeTo({
            center: [request.lng as number, request.lat as number],
            zoom: Math.max(m.getZoom(), 16.5),
            duration: 500,
          });
        },
      });
      const marker = pinMarker(el, request.lng, request.lat).addTo(m);
      if (selected) marker.getElement().style.zIndex = "2";
      markers.current.push(marker);
    }
  }, [queue, centres, placedHazards, placedWater, selectedId, epoch, t]);

  /*
   * Framing: where the hazard and evacuation maps were left, if they have been
   * looked at; otherwise the calls, or the barangay. Once per visit — after
   * that the volunteer is in charge of the camera.
   */
  useEffect(() => {
    const m = map.current;
    if (!m || framed.current || epoch === 0) return;
    return onStyleReady(m, () => {
      if (framed.current) return;
      framed.current = true;
      const saved = sharedView();
      if (saved) {
        m.jumpTo(saved);
        return;
      }
      const points = queue
        .filter((r) => r.lat != null && r.lng != null)
        .map((r) => [r.lng as number, r.lat as number]);
      if (points.length === 0) return;
      const lngs = points.map((p) => p[0]);
      const lats = points.map((p) => p[1]);
      m.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 64, duration: 0, maxZoom: 16 },
      );
    });
    // Once per visit, after the first style has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);

  /*
   * The route to the call, redrawn as the responder moves. The fix is rounded
   * to about 10 m first: a GPS that jitters by a metre would otherwise
   * recompute the walk several times a second.
   */
  const fixKey = fix ? `${fix.lng.toFixed(4)},${fix.lat.toFixed(4)}` : null;
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!target || !fixKey || !answering) {
      if (m.isStyleLoaded()) clearResponderRoute(m);
      return;
    }
    let live = true;
    const from = fixKey.split(",").map(Number) as Point;
    void routeToCall(from, target).then((route) => {
      if (!live || map.current !== m || !route) return;
      onStyleReady(m, () => {
        if (map.current !== m) return;
        drawResponderRoute(m, route.line);
        setRouteInfo({ id: answering.id, metres: route.metres });
      });
    });
    return () => {
      live = false;
    };
    // The target's identity is its coordinates, already in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixKey, answering, target?.[0], target?.[1], epoch]);

  /* Locked on the call: the map keeps it, and the walk to it, in view. */
  useEffect(() => {
    const m = map.current;
    if (!m || !following || !target) return;
    framed.current = true;
    if (!fixKey) {
      m.easeTo({ center: target, zoom: Math.max(m.getZoom(), 16), duration: 500 });
      return;
    }
    const from = fixKey.split(",").map(Number) as Point;
    m.fitBounds(
      [
        [Math.min(from[0], target[0]), Math.min(from[1], target[1])],
        [Math.max(from[0], target[0]), Math.max(from[1], target[1])],
      ],
      { padding: 80, maxZoom: 17, duration: 500 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [following, fixKey, target?.[0], target?.[1]]);

  /*
   * The responder's own position, drawn as on the residents' maps. An HTML
   * marker, so it does not wait for the style: gating it on isStyleLoaded
   * dropped the first fix, and a phone standing still may never send a second.
   */
  useEffect(() => {
    const m = map.current;
    if (!m || !fix) return;
    meMarker.current ??= new maplibregl.Marker({ element: youElement(undefined, t("sos.location")) });
    meMarker.current.setLngLat([fix.lng, fix.lat]).addTo(m);
  }, [fix, epoch, t]);

  useEffect(
    () => () => {
      meMarker.current?.remove();
      meMarker.current = null;
    },
    [],
  );

  /** Back to where the responder is standing. */
  const recentre = useCallback(() => {
    const m = map.current;
    if (!m || !fix) return;
    framed.current = true;
    m.easeTo({ center: [fix.lng, fix.lat], zoom: Math.max(m.getZoom(), 16.5), duration: 500 });
  }, [fix]);

  /** Centre on a call — the pin button, and every "take this call". */
  const centreOn = useCallback((request: RescueRequest) => {
    const m = map.current;
    if (!m || request.lat == null || request.lng == null) return;
    framed.current = true;
    m.easeTo({ center: [request.lng, request.lat], zoom: Math.max(m.getZoom(), 16.5), duration: 500 });
  }, []);

  const oldest = queue[0];
  /* What the recentre button goes to: the call being answered, else the one
     that has waited longest with a point on the map. */
  const centreTarget =
    answering ?? queue.find((r) => r.lat != null && r.lng != null) ?? null;
  const markedHazard =
    mark && "hazard" in mark ? (hazards.find((h) => h.id === mark.hazard) ?? null) : null;
  const markedWater =
    mark && "water" in mark ? (placedWater.find((w) => w.report.id === mark.water) ?? null) : null;
  const areaName = (id: string) => snapshot?.puroks.find((a) => a.id === id)?.name ?? "";
  const loadingQueue = useSkeletonGate(settled);

  return (
    <main className="relative flex min-h-[28rem] flex-1 overflow-hidden">
      <div className="relative min-w-0 flex-1">
        {/*
          Absolute + inset against the sized wrapper: a percentage height inside
          a flex item resolves against an indefinite containing block, and
          maplibre-gl.css sets `position: relative` on the container after
          mount, so the utility class would lose. Either mistake renders a blank
          rectangle with every layer correctly loaded behind it.
        */}
        <div
          ref={container}
          style={{ position: "absolute", inset: 0 }}
          className="[&_.maplibregl-ctrl-bottom-left]:bottom-14! [&_.maplibregl-ctrl-bottom-right]:bottom-14! sm:[&_.maplibregl-ctrl-bottom-left]:bottom-9! sm:[&_.maplibregl-ctrl-bottom-right]:bottom-9!"
        />

        {/* Top: where this is, how many are waiting, and the network warning. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 grid gap-1.5 p-2 sm:max-w-md sm:gap-2 sm:p-2.5">
          <div className="pointer-events-auto flex items-center gap-2.5 rounded-instrument border-[1.5px] border-line-soft bg-ink-900/95 px-3 py-2 shadow-md">
            <Link href="/volunteer" aria-label="Back" className="shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-paper-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </Link>
            <h1 className="min-w-0 flex-1 truncate font-display text-[14.5px] font-extrabold tracking-[0.4px]">
              {t("resp.title")}
            </h1>
            <span className="mono shrink-0 text-[13px] font-bold tracking-[0.8px] text-alarm">
              {queue.length}
            </span>
          </div>

          {/* This view genuinely needs the network. Saying so is better than
              showing an empty queue that looks like "nobody needs help". */}
          {!online && (
            <p className="pointer-events-auto mono rounded-instrument border-[1.5px] border-caution bg-ink-900/95 px-3 py-2 text-[10px] leading-snug tracking-[0.6px] text-caution shadow-md">
              OFFLINE — HINDI NA-UPDATE ANG LISTAHAN. HINDI ITO NANGANGAHULUGANG
              WALANG HUMIHINGI NG SAKLOLO.
            </p>
          )}
        </div>

        {/* The oldest unanswered call, and the way into the list on a phone. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-14 z-10 grid gap-2 p-2.5 pr-14 sm:bottom-9 sm:max-w-md sm:pr-2.5">
          {markedHazard && (
            <div className="pointer-events-auto shadow-md">
              <HazardBrief
                hazard={markedHazard}
                area={areaName(markedHazard.purok_id)}
                now={now}
                onOpen={() => focusHazard(markedHazard.id)}
                onClose={() => setMark(null)}
              />
            </div>
          )}
          {markedWater && (
            <div className="pointer-events-auto shadow-md">
              <WaterBrief
                report={markedWater.report}
                area={areaName(markedWater.report.purok_id)}
                approx={markedWater.approx}
                stale={markedWater.stale}
                now={now}
                onOpen={() => focusWater(markedWater.report.id)}
                onClose={() => setMark(null)}
              />
            </div>
          )}

          {oldest && oldest.status === "pending" && (
            <button
              type="button"
              onClick={() => {
                setSelectedId(oldest.id);
                setListChoice(true);
              }}
              className="pointer-events-auto flex items-center gap-3 rounded-instrument border-[1.5px] border-alarm bg-ink-900/95 px-3 py-2 text-left shadow-md"
            >
              <span className="min-w-0 flex-1">
                <span className="lbl block text-[9px] text-alarm">{t("resp.oldest")}</span>
                <span className="block truncate text-[13.5px] font-bold">
                  {oldest.lat != null ? t("dash.who") : t("resp.no_fix")}
                </span>
              </span>
              <span className="mono shrink-0 text-[17px] font-bold text-alarm">
                {waitMinutes(oldest.ts, now)}m
              </span>
            </button>
          )}

          {answering && (
            <div className="pointer-events-auto flex items-center gap-2 rounded-instrument border-[1.5px] border-alarm bg-ink-900/95 px-3 py-2 shadow-md">
              <span className="min-w-0 flex-1">
                <span className="lbl block text-[9px] text-alarm">{t("loc.route_to")}</span>
                <span className="mono block text-[12px] font-bold">
                  {routeInfo?.id === answering.id ? `${routeInfo.metres} M` : t("resp.no_fix")}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setFollowing((on) => !on)}
                aria-pressed={following}
                className={`tap mono rounded-[3px] border-[1.5px] px-2 text-[9.5px] font-bold tracking-[0.7px] ${
                  following ? "border-alarm bg-alarm/10 text-alarm" : "border-line-soft text-paper-3"
                }`}
              >
                {t("loc.following")}
              </button>
            </div>
          )}

        </div>

        {/* Phones: tapping the map beside the open list closes it. */}
        {listOpen && (
          <button
            type="button"
            aria-label={t("hz.close")}
            onClick={() => setListChoice(false)}
            className="absolute inset-0 z-10 bg-paper/20 md:hidden"
          />
        )}

        {/* Where the responder is, and where the call is: one button each. */}
        <button
          type="button"
          onClick={recentre}
          disabled={!fix}
          aria-label={t("map.recentre")}
          className="tap absolute right-2.5 bottom-[190px] z-10 flex size-11 items-center justify-center rounded-[3px] border-[1.5px] border-line bg-ink-800/95 shadow-md disabled:opacity-40 sm:bottom-[168px]"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--color-hv)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="3.5" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </button>

        {centreTarget && (
          <button
            type="button"
            onClick={() => centreOn(centreTarget)}
            aria-label={t("loc.centre_call")}
            title={t("loc.centre_call")}
            className="tap absolute right-2.5 bottom-[140px] z-10 flex size-11 items-center justify-center rounded-[3px] border-[1.5px] border-alarm bg-ink-900/95 shadow-md sm:bottom-[118px]"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--color-alarm)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
          </button>
        )}

        {/*
          The queue, behind a hamburger at the top of the map rather than a
          worded button at its foot: the foot is where the call being answered
          and the walk to it are read, and they are what a rescuer is holding
          the phone for.
        */}
        {!listOpen && (
          <button
            type="button"
            onClick={() => setListChoice(true)}
            aria-label={t("resp.title")}
            aria-expanded={false}
            className="tap absolute top-2.5 right-2.5 z-10 flex size-11 items-center justify-center rounded-instrument border-[1.5px] border-line bg-ink-900/95 shadow-md"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
            {queue.length > 0 && (
              <span className="mono absolute -top-1.5 -right-1.5 min-w-[18px] rounded-full border-[1.5px] border-ink-900 bg-alarm px-1 text-center text-[9.5px] leading-[15px] font-bold text-[oklch(0.99_0.01_28)]">
                {queue.length}
              </span>
            )}
          </button>
        )}

        <MapLegend rescue />
      </div>

      {/*
        The queue. Over the map on a phone, beside it from lg up — the hall's
        laptop (PRD §4), where the map stays put while the list scrolls.
      */}
      <aside
        inert={!listOpen}
        className={`absolute inset-y-0 right-0 z-20 w-[22rem] max-w-[92%] overflow-hidden border-l border-line-soft bg-ink-900 shadow-xl transition-[transform,width] duration-200 ease-out lg:relative lg:max-w-none lg:shadow-none ${
          listOpen ? "translate-x-0" : "translate-x-full lg:w-0 lg:border-l-0"
        } lg:translate-x-0`}
      >
        <div className="flex h-full w-[22rem] max-w-full flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-line-soft px-3.5 py-2.5">
            <span className="lbl">{t("resp.title")}</span>
            <button
              type="button"
              onClick={() => setListChoice(false)}
              aria-label={t("hz.close")}
              className="px-1 text-[20px] leading-none text-paper-3 hover:text-paper"
            >
              ×
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {/*
              "Nobody needs help" is the single most dangerous thing this screen
              can say, and it used to say it on the first frame, before
              `activeQueue` had answered.
            */}
            {loadingQueue ? (
              <SkeletonLines rows={3} />
            ) : queue.length === 0 ? (
              <p className="mono mt-4 text-center text-[11px] tracking-[0.6px] text-paper-3">
                {t("resp.none")}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {queue.map((request) => (
                  <li
                    key={request.id}
                    aria-current={request.id === selectedId}
                    className={`rounded-instrument border-l-4 bg-ink-800 p-3 ${
                      request.status === "acknowledged" ? "border-caution" : "border-alarm"
                    } ${request.id === selectedId ? "ring-[1.5px] ring-hv" : ""}`}
                  >
                    <div className="mb-1.5">
                      <PersonLabel person={people.get(request.requested_by ?? "")} />
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="mono text-[11px] tracking-[0.5px] text-paper-2">
                        {request.lat != null && request.lng != null
                          ? `${request.lat.toFixed(4)} · ${request.lng.toFixed(4)}`
                          : t("resp.no_fix")}
                      </span>
                      <span className="mono text-[14px] font-bold text-paper">
                        {waitMinutes(request.ts, now)}m
                      </span>
                    </div>

                    <div className="mt-2.5 grid gap-2">
                      <div className="flex gap-2">
                        {request.status === "pending" ? (
                          <button
                            type="button"
                            onClick={() => {
                              // Answering it is taking it: the route starts here.
                              take(request.id);
                              centreOn(request);
                              void acknowledge(request.id).then(refresh);
                            }}
                            className="tap flex-1 rounded-[3px] bg-hv text-[12.5px] font-bold text-hv-ink"
                          >
                            {t("resp.ack")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void markRescued(request.id).then(refresh)}
                            className="tap flex-1 rounded-[3px] border-[1.5px] border-clear text-[12.5px] font-bold text-clear"
                          >
                            {t("resp.rescued")}
                          </button>
                        )}
                      </div>

                      {/*
                        Anyone else may take the same call and get their own
                        route to it; nothing here tells the others what this
                        phone is doing.
                      */}
                      {accepted === request.id ? (
                        <button
                          type="button"
                          onClick={() => acceptedSosPref.set("")}
                          className="tap mono rounded-[3px] border-[1.5px] border-line-soft text-[10.5px] font-bold tracking-[0.8px] text-paper-3"
                        >
                          {t("loc.stop_route")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            take(request.id);
                            centreOn(request);
                          }}
                          className="tap mono rounded-[3px] border-[1.5px] border-alarm text-[10.5px] font-bold tracking-[0.8px] text-alarm"
                        >
                          {t("loc.take_call")}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>
    </main>
  );
}
