"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useSync, useT } from "../AppRuntime";
import { MapLegend } from "../MapLegend";
import { CentreModal, PinMenu, type Draft, type PinKind } from "./PinMenu";
import { loadStreetStyle, onStyleReady, sketchStyle } from "@/lib/basemap";
import { barangayCentre } from "@/lib/advisory";
import { addCentre, areaFor, loadStreets, nearestStreet } from "@/lib/centres";
import { CATEGORY_TONE } from "@/lib/hazards";
import { resolveColour } from "@/lib/signal";
import type { DashItem } from "@/lib/dashboard";
import { DEPTH_COLOUR } from "@/lib/waterMap";
import type { Point } from "@/lib/geo";
import type { Streets } from "@/lib/walkRoute";
import { pointInRing } from "@/lib/walkRoute";
import {
  CENTRE_ICON,
  HAZARD_ICON,
  SOS_ICON,
  WATER_ICON,
  hazardColour,
  pinElement,
  pinMarker,
  teardropSvg,
} from "@/lib/mapMarks";


/** The draft pin takes the look of what is being placed. */
const DRAFT_LOOK: Record<PinKind | "none", { colour: string; icon: string }> = {
  none: { colour: "var(--color-hv)", icon: "<path d='M12 7v10M7 12h10'/>" },
  hazard: { colour: "var(--color-alarm)", icon: HAZARD_ICON.other },
  water: { colour: "var(--color-hv)", icon: WATER_ICON },
  evacuate: { colour: "var(--color-clear)", icon: CENTRE_ICON },
};

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

/** Below this width the pin menu is a bottom sheet instead of a pop-up at the pin. */
const SHEET_QUERY = "(max-width: 639px)";

function subscribeSheet(onChange: () => void) {
  const query = window.matchMedia(SHEET_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const isSheet = () => window.matchMedia(SHEET_QUERY).matches;

/** The draft pin's element: the pin itself, and a slot above it for the menu. */
function draftElement() {
  const root = document.createElement("div");
  // No position here: MapLibre makes the marker element absolute, which
  // already anchors the menu slot.
  root.style.cssText = "line-height:0";
  const pin = document.createElement("div");
  pin.style.cssText = "filter:drop-shadow(0 2px 3px rgba(0,0,0,0.4));pointer-events:none";
  const menu = document.createElement("div");
  menu.style.cssText = "position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);line-height:normal";
  // Taps and scrolls inside the menu are not taps on the map.
  for (const type of ["click", "dblclick", "mousedown", "touchstart", "wheel"]) {
    menu.addEventListener(type, (event) => event.stopPropagation());
  }
  root.append(pin, menu);
  return { root, pin, menu };
}

function paintPin(pin: HTMLElement, look: { colour: string; icon: string }) {
  pin.innerHTML = teardropSvg(look.colour, look.icon, 42);
}

/**
 * The dashboard map: the barangay outline, the evacuation centres, a pin for
 * every item in the lists — and the official's own pins. Tapping a spot inside
 * the barangay drops a pin with a menu (PinMenu): a hazard, a water depth, or a
 * new evacuation centre. Same basemap rule as the other maps: the drawn sketch
 * always, real streets only when online.
 */
export function DashboardMap({
  items,
  selectedId,
  onSelect,
  labelFor,
  onPinned,
}: {
  items: DashItem[];
  /** An item's or a centre's id. */
  selectedId: string | null;
  onSelect: (id: string, kind: "item" | "centre") => void;
  labelFor: (item: DashItem) => string;
  /** A pin was saved; `message` is what to tell the official. */
  onPinned: (message: string) => void;
}) {
  const { snapshot, online } = useSync();
  const t = useT();
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const framed = useRef(false);
  const upgraded = useRef(false);
  const credited = useRef<maplibregl.Map | null>(null);
  const draftMarker = useRef<maplibregl.Marker | null>(null);
  const [epoch, setEpoch] = useState(0);

  const [streets, setStreets] = useState<Streets | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [kind, setKind] = useState<PinKind | null>(null);
  const [modal, setModal] = useState(false);
  const [outside, setOutside] = useState(false);
  const sheet = useSyncExternalStore(subscribeSheet, isSheet, () => false);
  /* The draft marker's element; the pop-up menu is portalled into it. */
  const [draftEl] = useState(() => (typeof document === "undefined" ? null : draftElement()));

  const barangay = snapshot?.barangay ?? null;
  const outline = barangay?.boundary_geojson ?? null;

  useEffect(() => {
    void loadStreets().then(setStreets);
  }, []);

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
    // Zoom at the foot of the map, in thumb reach on a phone.
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
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
          m.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
        }
        setEpoch((n) => n + 1);
      });
    });
  }, [online, epoch]);

  /* The barangay outline, re-added after a style swap. */
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

  /* Pins: every centre, then every item. The selected one is drawn larger. */
  const centres = snapshot?.centers;
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const pins: maplibregl.Marker[] = [];
    for (const centre of centres ?? []) {
      if (centre.lat == null || centre.lng == null) continue;
      const selected = centre.id === selectedId;
      const el = pinElement({
        colour: "var(--color-clear)",
        icon: CENTRE_ICON,
        label: centre.name,
        height: selected ? 46 : 36,
        onClick: () => onSelect(centre.id, "centre"),
      });
      const marker = pinMarker(el, centre.lng, centre.lat).addTo(m);
      if (selected) marker.getElement().style.zIndex = "2";
      pins.push(marker);
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
        onClick: () => onSelect(item.id, "item"),
      });
      // An area-only point is drawn faded: it says "somewhere here", not "here".
      if (item.approx && !selected) el.style.opacity = "0.7";
      const marker = pinMarker(el, item.lng, item.lat).addTo(m);
      if (selected) marker.getElement().style.zIndex = "2";
      pins.push(marker);
    }
    return () => pins.forEach((pin) => pin.remove());
  }, [items, centres, selectedId, onSelect, labelFor, epoch]);

  /*
   * A tap on the map itself (not on a pin) drops a draft pin there, inside the
   * barangay only — the database refuses a centre outside it anyway (0026).
   */
  const ring = outline?.coordinates[0] as Point[] | undefined;
  useEffect(() => {
    const m = map.current;
    if (!m || !snapshot) return;
    const onClick = (event: maplibregl.MapMouseEvent) => {
      const target = event.originalEvent.target as HTMLElement | null;
      if (target?.closest(".maplibregl-marker, .maplibregl-ctrl")) return;
      const point: Point = [event.lngLat.lng, event.lngLat.lat];
      if (ring && !pointInRing(point, ring)) {
        setDraft(null);
        setOutside(true);
        return;
      }
      const street = nearestStreet(streets, point);
      setOutside(false);
      setKind(null);
      setDraft({ lng: point[0], lat: point[1], street, purokId: areaFor(snapshot, street, point) });
      // Room above the pin for its menu.
      m.easeTo({ center: point, offset: [0, sheet ? -40 : 110], duration: 350 });
    };
    m.on("click", onClick);
    return () => {
      m.off("click", onClick);
    };
  }, [snapshot, streets, ring, sheet]);

  /* The draft pin, and on wider screens the menu attached to it. */
  useEffect(() => {
    const m = map.current;
    if (!m || !draft || !draftEl) {
      draftMarker.current?.remove();
      return;
    }
    draftMarker.current ??= new maplibregl.Marker({ element: draftEl.root, anchor: "bottom" });
    const look = DRAFT_LOOK[kind ?? "none"];
    paintPin(draftEl.pin, look);
    draftMarker.current.setLngLat([draft.lng, draft.lat]).addTo(m);
  }, [draft, kind, draftEl]);

  useEffect(
    () => () => {
      draftMarker.current?.remove();
    },
    [],
  );

  /* Outside-the-barangay note fades on its own. */
  useEffect(() => {
    if (!outside) return;
    const timer = window.setTimeout(() => setOutside(false), 3500);
    return () => window.clearTimeout(timer);
  }, [outside]);

  const close = () => {
    setDraft(null);
    setKind(null);
    setModal(false);
  };

  /* Frame everything once; after that the official is in charge of the camera. */
  const showAll = () => {
    const m = map.current;
    if (!m) return;
    const points: [number, number][] = items
      .filter((i) => i.lat != null && i.lng != null)
      .map((i) => [i.lng as number, i.lat as number]);
    for (const c of centres ?? []) if (c.lat != null && c.lng != null) points.push([c.lng, c.lat]);
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

  /* Selecting something from the list brings its pin into view. */
  useEffect(() => {
    const m = map.current;
    if (!m || !selectedId) return;
    const item = items.find((i) => i.id === selectedId);
    const centre = centres?.find((c) => c.id === selectedId);
    const lat = item?.lat ?? centre?.lat;
    const lng = item?.lng ?? centre?.lng;
    if (lat == null || lng == null) return;
    m.easeTo({ center: [lng, lat], zoom: Math.max(m.getZoom(), 16.5), duration: 500 });
    // Only when the selection changes, not on every refresh of the lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const menu = draft && (
    <PinMenu
      draft={draft}
      kind={kind}
      onKind={setKind}
      onEvacuate={() => setModal(true)}
      onClose={close}
      onDone={() => {
        close();
        onPinned(t("dash.pinned"));
      }}
    />
  );

  return (
    /*
     * Controls sit bottom-right and the map credit bottom-left, both lifted
     * clear of the legend bar (two lines on a phone, one from sm up).
     */
    <div className="absolute inset-0 [&_.maplibregl-ctrl-bottom-left]:bottom-11! [&_.maplibregl-ctrl-bottom-right]:bottom-11! sm:[&_.maplibregl-ctrl-bottom-left]:bottom-7! sm:[&_.maplibregl-ctrl-bottom-right]:bottom-7!">
      <div ref={container} style={{ position: "absolute", inset: 0 }} />
      <button
        type="button"
        onClick={showAll}
        className="mono absolute top-2.5 right-2.5 rounded-[3px] border-[1.5px] border-line bg-ink-800/95 px-2.5 py-1.5 text-[10px] font-bold tracking-[0.8px] text-paper shadow-sm"
      >
        {t("dash.show_all")}
      </button>

      {outside && (
        <p
          role="status"
          className="absolute top-12 left-1/2 z-10 w-[min(22rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-instrument border-[1.5px] border-caution bg-ink-900 px-3 py-2 text-center text-[12px] leading-snug text-caution shadow-md"
        >
          {t("dash.outside")}
        </p>
      )}

      {/* The menu: at the pin on wider screens, a bottom sheet on a phone. */}
      {menu && !sheet && draftEl && createPortal(menu, draftEl.menu)}
      {menu && sheet && (
        <div className="absolute inset-x-0 bottom-0 z-30 flex justify-center p-2 [&>div]:w-full">{menu}</div>
      )}

      {modal && draft && snapshot && (
        <CentreModal
          title={t("dash.new_centre")}
          place={draft.street ?? `${draft.lat.toFixed(5)}, ${draft.lng.toFixed(5)}`}
          initial={{ name: "", capacity: null }}
          holdLabel={t("dash.hold_add")}
          onCancel={() => setModal(false)}
          onSave={(input) => {
            const at = { ...draft };
            close();
            if (!at.purokId) return;
            void addCentre(snapshot, streets, { ...input, lat: at.lat, lng: at.lng, purokId: at.purokId }).then(() =>
              onPinned(t("dash.centre_saved")),
            );
          }}
        />
      )}

      <MapLegend rescue />
    </div>
  );
}
