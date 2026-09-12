"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useSync, useT } from "./AppRuntime";
import { useMyRole } from "./useMyRole";
import { useShellWidth } from "./Shell";
import { HazardPhoto } from "./HazardPhoto";
import { loadStreetStyle, onStyleReady, sketchStyle } from "@/lib/basemap";
import { onQueueChanged } from "@/lib/offlineQueue";
import { agoLabel } from "@/lib/water";
import { resolveColour } from "@/lib/signal";
import {
  allOpenHazards,
  canResolveHazard,
  resolveHazard,
  subscribeHazards,
  CATEGORY_TONE,
  type Category,
  type Hazard,
} from "@/lib/hazards";

/**
 * The barangay hazard map, reachable from every screen (FR-7.3).
 *
 * Mounted in the layout rather than by each page, for the same reason the sync
 * strip and the tab bar are: a screen that has to remember to render it is a
 * screen someone will ship without it.
 *
 * It is a pull-up sheet and not a strip embedded in each page, and that is a
 * deliberate trade. An embedded map would be literally visible everywhere, but
 * it would take 150-200px from every screen — including the SOS screen, where
 * the button has to stay the largest thing on the display — and would mean a
 * live MapLibre instance per route. One shared sheet is one tap away from
 * anywhere, costs no layout height, and holds exactly one map, built when it is
 * opened and torn down when it is closed.
 */

/**
 * Five categories, five marks. The colour still says severity — alarm for the
 * two that can kill someone who walks into them in the dark, caution for the
 * rest — so the category has to be carried by SHAPE, which is the right answer
 * anyway: roughly a tenth of Filipino men cannot separate the red from the
 * green, and this map's whole job is to be read at a glance.
 */
const PIN_ICON: Record<Category, string> = {
  flooding: "<path d='M12 3s7 7.58 7 12a7 7 0 0 1-14 0c0-4.42 7-12 7-12z'/>",
  fallen_tree:
    "<path d='M12 22v-5'/><path d='M12 17l-6-5h3.2L5 7.5h3.2L12 2l3.8 5.5H19L15.8 12H19z'/>",
  blocked_road: "<path d='M3 20h18'/><path d='M8.5 20 12 4l3.5 16'/><path d='M9.6 12h4.8'/>",
  downed_lines: "<path d='M13 2 4 14h6l-1 8 9-12h-6z'/>",
  other: "<path d='M12 7v6'/><path d='M12 17h.01'/><circle cx='12' cy='12' r='9'/>",
};

export function HazardSheet() {
  const { snapshot, userId } = useSync();
  const t = useT();
  const role = useMyRole();
  const width = useShellWidth();

  const [open, setOpen] = useState(false);
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const framed = useRef(false);
  const [styleEpoch, setStyleEpoch] = useState(0);

  const refresh = useCallback(async () => {
    setHazards(await allOpenHazards(100));
  }, []);

  /*
   * Live on every screen, not only while the sheet is open. The count on the
   * handle is the reason: a resident who never opens the sheet should still see
   * it go from two to three when someone reports a downed line on their street.
   */
  useEffect(() => {
    queueMicrotask(() => void refresh());
    const stopLive = subscribeHazards(() => void refresh());
    const stopQueue = onQueueChanged(() => void refresh());
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      stopLive();
      stopQueue();
      window.clearInterval(tick);
    };
  }, [refresh]);

  /* Memoised because the pin effect reads it, and an identity that changes on
     every render would re-plot every marker on every render. */
  const purokName = useCallback(
    (id: string) => snapshot?.puroks.find((p) => p.id === id)?.name ?? "",
    [snapshot],
  );

  /* A hazard with no fix cannot be pinned. It is counted rather than dropped —
     the same rule the rescue queue follows for an SOS with no GPS. */
  const placed = useMemo(
    () => hazards.filter((h) => h.lat != null && h.lng != null),
    [hazards],
  );
  const unplaced = hazards.length - placed.length;
  const selected = hazards.find((h) => h.id === selectedId) ?? null;

  /* Build the map when the sheet opens; tear it down when it closes. */
  useEffect(() => {
    if (!open) return;
    const node = container.current;
    if (!node || map.current) return;

    framed.current = false;
    const instance = new maplibregl.Map({
      container: node,
      // Same contract as the evacuation map: built on the style that cannot
      // fail, upgraded to real streets only if they can actually be fetched.
      style: sketchStyle(),
      center: [121.4156, 14.2797],
      zoom: 14,
      attributionControl: false,
    });
    map.current = instance;

    instance.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    instance.on("error", (event) =>
      console.error("[hazard-map]", event.error?.message ?? event),
    );
    instance.on("load", () => setStyleEpoch((n) => n + 1));

    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(node);

    void loadStreetStyle().then((style) => {
      if (!style || map.current !== instance) return;
      instance.setStyle(style, { diff: false });
      onStyleReady(instance, () => {
        if (map.current !== instance) return;
        instance.addControl(
          new maplibregl.AttributionControl({ compact: true }),
          "top-left",
        );
        setStyleEpoch((n) => n + 1);
      });
    });

    return () => {
      observer.disconnect();
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      instance.remove();
      map.current = null;
    };
  }, [open]);

  /* Pins. Re-plotted whenever the reports change or the style is replaced. */
  useEffect(() => {
    const m = map.current;
    if (!open || !m) return;

    return onStyleReady(m, () => {
      markers.current.forEach((marker) => marker.remove());
      markers.current = [];

      const ground = resolveColour("var(--color-ink-900)");

      for (const hazard of placed) {
        const tone = CATEGORY_TONE[hazard.category];
        const colour = `var(--color-${tone})`;

        const pin = document.createElement("button");
        pin.type = "button";
        pin.setAttribute(
          "aria-label",
          `${t(`cat.${hazard.category}`)} — ${purokName(hazard.purok_id)}`,
        );
        pin.style.cssText = [
          "width:30px",
          "height:30px",
          "border-radius:50%",
          "display:flex",
          "align-items:center",
          "justify-content:center",
          `background:${colour}`,
          `border:2.5px solid ${ground}`,
          "box-shadow:0 1px 4px rgba(0,0,0,0.28)",
          "cursor:pointer",
          "padding:0",
        ].join(";");
        pin.innerHTML =
          `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${ground}"` +
          ` stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
          `${PIN_ICON[hazard.category]}</svg>`;

        pin.addEventListener("click", () => {
          setSelectedId(hazard.id);
          m.easeTo({
            center: [hazard.lng as number, hazard.lat as number],
            zoom: Math.max(m.getZoom(), 16.5),
          });
        });

        markers.current.push(
          new maplibregl.Marker({ element: pin })
            .setLngLat([hazard.lng as number, hazard.lat as number])
            .addTo(m),
        );
      }

      /* Frame them once per opening — after that the reader is in charge. */
      if (!framed.current && placed.length > 0) {
        framed.current = true;
        const lngs = placed.map((h) => h.lng as number);
        const lats = placed.map((h) => h.lat as number);
        m.fitBounds(
          [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
          ],
          { padding: 64, duration: 0, maxZoom: 16 },
        );
      }
    });
  }, [open, placed, styleEpoch, t, purokName]);

  const canFix = selected
    ? canResolveHazard(selected, userId ?? null, role)
    : false;

  return (
    <>
      {/*
        The handle. `sticky` at the tab bar's own height rather than `fixed`, so
        it rides directly above the nav without either one needing to know the
        other's layout — and without any screen needing a padding-bottom to
        avoid being covered.
      */}
      <div
        className="sticky z-20 shrink-0 border-t border-line-soft bg-ink-800"
        style={{ bottom: "calc(74px + env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          className={`mx-auto flex w-full items-center gap-2.5 px-3.5 py-2 ${width}`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-hv)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
            <path d="M12 22s7-7.58 7-13a7 7 0 0 0-14 0c0 5.42 7 13 7 13z" />
            <circle cx="12" cy="9" r="2.5" />
          </svg>
          <span className="lbl">{t("hz.title")}</span>

          {/*
            The count is the honest part. `hazards` is the OPEN set, so this is
            always "still unresolved" and never a running total of everything
            that ever happened.
          */}
          <span
            className={`mono ml-auto text-[10px] font-bold tracking-[0.7px] ${
              hazards.length > 0 ? "text-alarm" : "text-paper-3"
            }`}
          >
            {hazards.length > 0 ? t("hz.count", { n: hazards.length }) : t("hz.clear")}
          </span>

          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-paper-3)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
            <path d="M6 15l6-6 6 6" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end">
          {/* Tapping away closes it — the usual sheet affordance, and the only
              one available to a thumb that cannot reach the close button. */}
          <button
            type="button"
            aria-label={t("hz.close")}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-paper/25"
          />

          <section
            className={`relative mx-auto flex h-[82dvh] w-full flex-col overflow-hidden rounded-t-instrument border-t-[1.5px] border-line bg-ink-900 ${width}`}
            role="dialog"
            aria-modal="true"
            aria-label={t("hz.title")}
          >
            <div className="flex shrink-0 items-center gap-3 border-b border-line-soft px-3.5 py-2.5">
              <span className="lbl flex-1">{t("hz.title")}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="tap flex items-center px-1 text-[12px] font-bold text-hv"
              >
                {t("hz.close")}
              </button>
            </div>

            <div className="relative flex-1">
              <div ref={container} style={{ position: "absolute", inset: 0 }} />

              {placed.length === 0 && (
                <p className="mono pointer-events-none absolute inset-x-0 top-1/2 px-6 text-center text-[11px] leading-relaxed text-paper-3">
                  {hazards.length === 0 ? t("hz.none") : t("hz.no_fix", { n: unplaced })}
                </p>
              )}
            </div>

            {/* Details, or the instruction that gets you to them. */}
            <div className="max-h-[46%] shrink-0 overflow-auto border-t border-line-soft">
              {selected ? (
                <HazardDetail
                  hazard={selected}
                  now={now}
                  purokName={purokName}
                  canFix={canFix}
                  onFix={async () => {
                    await resolveHazard(selected.id);
                    setSelectedId(null);
                    void refresh();
                  }}
                  onDismiss={() => setSelectedId(null)}
                />
              ) : (
                <p className="mono px-3.5 py-3 text-[10px] tracking-[0.6px] text-paper-3">
                  {placed.length > 0 ? t("hz.tap") : t("hz.none")}
                  {unplaced > 0 && ` · ${t("hz.no_fix", { n: unplaced })}`}
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function HazardDetail({
  hazard,
  now,
  purokName,
  canFix,
  onFix,
  onDismiss,
}: {
  hazard: Hazard;
  now: number;
  purokName: (id: string) => string;
  canFix: boolean;
  onFix: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const tone = CATEGORY_TONE[hazard.category];

  return (
    <div
      className={`border-l-4 px-3.5 py-3 ${tone === "alarm" ? "border-alarm" : "border-caution"}`}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`mono shrink-0 text-[11px] font-bold tracking-[0.7px] ${
            tone === "alarm" ? "text-alarm" : "text-caution"
          }`}
        >
          {t(`cat.${hazard.category}`)}
        </span>

        {/* The state, stated. This is the whole point of the fix: a report is
            open until somebody says otherwise, and it should say so. */}
        <span className="mono rounded-[3px] border border-caution px-1.5 py-0.5 text-[9px] font-bold tracking-[0.7px] text-caution">
          {t("hazard.unresolved")}
        </span>

        <span className="mono ml-auto shrink-0 text-[10px] text-paper-3">
          {agoLabel(hazard.ts, now)}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("hz.close")}
          className="shrink-0 px-1 text-[15px] leading-none text-paper-3"
        >
          ×
        </button>
      </div>

      {hazard.description && (
        <p className="mt-2 text-[13px] leading-snug">{hazard.description}</p>
      )}

      <p className="lbl mt-2.5">{t("hz.where")}</p>
      <p className="mono text-[11px] text-paper-2">
        {purokName(hazard.purok_id)}
        {hazard.lat != null && hazard.lng != null && (
          <>
            {" · "}
            {hazard.lat.toFixed(5)}, {hazard.lng.toFixed(5)}
          </>
        )}
      </p>

      {hazard.photo_url && <HazardPhoto path={hazard.photo_url} />}

      {canFix ? (
        <button
          type="button"
          onClick={onFix}
          className="tap mt-3 flex w-full items-center justify-center gap-2 rounded-instrument bg-hv text-[13px] font-bold text-hv-ink"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6L9 17l-5-5" />
          </svg>
          {t("hazard.resolve")}
        </button>
      ) : (
        /*
          Said rather than hidden. A blank space where a button might be tells a
          resident nothing; this tells them the rule, so they know to find a
          volunteer instead of assuming the app is broken.
        */
        <p className="mono mt-3 text-[10px] leading-relaxed tracking-[0.5px] text-paper-3">
          {t("hz.only_volunteer")}
        </p>
      )}
    </div>
  );
}
