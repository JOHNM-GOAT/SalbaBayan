"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useSync, useT } from "../AppRuntime";
import { MapLegend } from "../MapLegend";
import { loadStreetStyle, onStyleReady, sketchStyle } from "@/lib/basemap";
import { barangayCentre } from "@/lib/advisory";
import { CATEGORY_TONE } from "@/lib/hazards";
import { resolveColour } from "@/lib/signal";
import type { DashItem } from "@/lib/dashboard";
import {
  CENTRE_ICON,
  HAZARD_ICON,
  SOS_ICON,
  WATER_ICON,
  hazardColour,
  pinElement,
  pinMarker,
} from "@/lib/mapMarks";

const DEPTH_COLOUR = {
  knee: "var(--color-clear)",
  waist: "var(--color-caution)",
  chest: "var(--color-alarm)",
  above_head: "var(--color-alarm)",
} as const;

function pinFor(item: DashItem): { colour: string; icon: string; size: number } {
  if (item.kind === "sos") {
    return {
      colour: item.sos.status === "pending" ? "var(--color-alarm)" : "var(--color-caution)",
      icon: SOS_ICON,
      size: 40,
    };
  }
  if (item.kind === "hazard") {
    return {
      colour: hazardColour(CATEGORY_TONE[item.hazard.category] ?? "alarm"),
      icon: HAZARD_ICON[item.hazard.category] ?? HAZARD_ICON.other,
      size: 32,
    };
  }
  return { colour: DEPTH_COLOUR[item.water.level_category], icon: WATER_ICON, size: 30 };
}

/**
 * The dashboard map: the barangay outline, the evacuation centre, and a pin for
 * every item in the lists. Same basemap rule as the other maps — the drawn
 * sketch always, real streets only when online.
 */
export function DashboardMap({
  items,
  selectedId,
  onSelect,
  labelFor,
}: {
  items: DashItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  labelFor: (item: DashItem) => string;
}) {
  const { snapshot, online } = useSync();
  const t = useT();
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const framed = useRef(false);
  const upgraded = useRef(false);
  const credited = useRef<maplibregl.Map | null>(null);
  const [epoch, setEpoch] = useState(0);

  const barangay = snapshot?.barangay ?? null;

  /* Build once. */
  useEffect(() => {
    const node = container.current;
    if (!node || map.current) return;
    const instance = new maplibregl.Map({
      container: node,
      style: sketchStyle(),
      center: barangayCentre(barangay),
      zoom: 15,
      attributionControl: false,
    });
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    instance.on("error", (event) => console.error("[dashboard-map]", event.error?.message ?? event));
    instance.on("load", () => setEpoch((n) => n + 1));
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(node);

    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
      framed.current = false;
      upgraded.current = false;
    };
    // Built once per visit, centred on the barangay known at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * Real streets as soon as there is a signal. `online` settles a moment after
   * the page opens, so this waits for it rather than deciding at build time.
   */
  useEffect(() => {
    const m = map.current;
    if (!m || !online || upgraded.current) return;
    upgraded.current = true;
    void loadStreetStyle().then((style) => {
      if (!style || map.current !== m) {
        upgraded.current = false;
        return;
      }
      m.setStyle(style, { diff: false });
      onStyleReady(m, () => {
        if (map.current !== m) return;
        // Once per map: the style-ready callback can fire again on a re-render.
        if (credited.current !== m) {
          credited.current = m;
          m.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
        }
        setEpoch((n) => n + 1);
      });
    });
  }, [online, epoch]);

  /* The barangay outline, re-added after a style swap. */
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
        m.addLayer({ id: "boundary-fill", type: "fill", source: "boundary", paint: { "fill-color": accent, "fill-opacity": 0.06 } });
        m.addLayer({
          id: "boundary-line",
          type: "line",
          source: "boundary",
          paint: { "line-color": accent, "line-width": 2, "line-dasharray": [3, 2] },
        });
      }
    });
  }, [outline, epoch]);

  /* Pins: the centre, then every item. The selected one is drawn larger. */
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const pins: maplibregl.Marker[] = [];
    const centre = snapshot?.centers[0];
    if (centre?.lat != null && centre.lng != null) {
      pins.push(
        pinMarker(pinElement({ colour: "var(--color-clear)", icon: CENTRE_ICON, label: centre.name, height: 34 }), centre.lng, centre.lat).addTo(m),
      );
    }
    for (const item of items) {
      if (item.lat == null || item.lng == null) continue;
      const { colour, icon, size } = pinFor(item);
      const selected = item.id === selectedId;
      const el = pinElement({
        colour,
        icon,
        label: labelFor(item),
        height: selected ? size + 12 : size,
        onClick: () => onSelect(item.id),
      });
      // An area-only point is drawn faded: it says "somewhere here", not "here".
      if (item.approx && !selected) el.style.opacity = "0.7";
      const marker = pinMarker(el, item.lng, item.lat).addTo(m);
      if (selected) marker.getElement().style.zIndex = "2";
      pins.push(marker);
    }
    return () => pins.forEach((pin) => pin.remove());
  }, [items, selectedId, snapshot, onSelect, labelFor, epoch]);

  /* Frame everything once; after that the official is in charge of the camera. */
  const showAll = () => {
    const m = map.current;
    if (!m) return;
    const points: [number, number][] = items
      .filter((i) => i.lat != null && i.lng != null)
      .map((i) => [i.lng as number, i.lat as number]);
    for (const ring of outline?.coordinates ?? []) for (const p of ring) points.push([p[0], p[1]]);
    if (points.length === 0) return;
    const lngs = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    m.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 60, maxZoom: 17, duration: 400 },
    );
  };

  useEffect(() => {
    const m = map.current;
    if (!m || framed.current || epoch === 0) return;
    framed.current = true;
    showAll();
    // Once per visit, after the first style has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);

  /* Selecting an item from the list brings its pin into view. */
  useEffect(() => {
    const m = map.current;
    const item = items.find((i) => i.id === selectedId);
    if (!m || !item || item.lat == null || item.lng == null) return;
    m.easeTo({ center: [item.lng, item.lat], zoom: Math.max(m.getZoom(), 16.5), duration: 500 });
    // Only when the selection changes, not on every refresh of the lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return (
    // The map credit sits bottom-right, lifted clear of the legend bar.
    <div className="absolute inset-0 [&_.maplibregl-ctrl-bottom-right]:bottom-9">
      <div ref={container} style={{ position: "absolute", inset: 0 }} />
      <button
        type="button"
        onClick={showAll}
        className="mono absolute top-[76px] right-2.5 rounded-[3px] border-[1.5px] border-line bg-ink-800/95 px-2.5 py-1.5 text-[10px] font-bold tracking-[0.8px] text-paper shadow-sm"
      >
        {t("dash.show_all")}
      </button>
      <MapLegend rescue />
    </div>
  );
}
