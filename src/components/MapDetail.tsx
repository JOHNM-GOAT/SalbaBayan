"use client";

import type { ReactNode } from "react";
import { useT } from "./AppRuntime";
import type { EvacCenter } from "@/lib/advisory";
import type { Fix } from "@/lib/sos";
import { CATEGORY_TONE, type Category } from "@/lib/hazards";
import { agoLabel, type WaterReport } from "@/lib/water";

/** What a tapped map mark says about itself, on either map. */
export type MapSelection =
  | "you"
  | { centre: string }
  | { hazard: string }
  | { water: string }
  | null;

export function CentreDetail({
  centre,
  metres,
  minutes,
  onClose,
}: {
  centre: EvacCenter;
  /** The walk, when the map knows the route to it. */
  metres?: number;
  minutes?: number;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Card tone="border-l-clear" label={t("ui.evac_center")} onClose={onClose}>
      <p className="mt-1 font-display text-[16px] leading-tight font-extrabold">{centre.name}</p>
      <p className="mono mt-1 text-[11px] text-paper-2">
        {centre.capacity == null ? t("vol.capacity_unset") : t("vol.capacity", { n: centre.capacity })}
        {metres != null && minutes != null && ` · ${Math.round(metres)} M · ${minutes} ${t("map.walk")}`}
      </p>
      {centre.lat != null && centre.lng != null && (
        <p className="mono mt-0.5 text-[10px] text-paper-3">
          {centre.lat.toFixed(5)}, {centre.lng.toFixed(5)}
        </p>
      )}
    </Card>
  );
}

export function YouDetail({ fix, onClose }: { fix: Fix; onClose: () => void }) {
  const t = useT();
  return (
    <Card tone="border-l-you" label={t("sos.location")} onClose={onClose}>
      <p className="mono mt-1 text-[12px] font-bold">
        {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}
      </p>
      <p className="mono mt-0.5 text-[10px] text-paper-3">± {Math.round(fix.accuracy)} M</p>
    </Card>
  );
}

function Card({
  tone,
  label,
  onClose,
  children,
}: {
  tone: string;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <section className={`relative rounded-instrument border-[1.5px] border-l-4 border-line-soft bg-ink-800 px-3.5 py-2.5 ${tone}`}>
      <p className="lbl">{label}</p>
      {children}
      <button
        type="button"
        onClick={onClose}
        aria-label={t("hz.close")}
        className="absolute top-1.5 right-2 px-1 text-[16px] leading-none text-paper-3"
      >
        ×
      </button>
    </section>
  );
}

/**
 * A hazard pin, tapped: what it is, where it is, and how old. The hazard map
 * holds the rest — the photo, and RESOLVE for whoever may use it.
 */
/** Enough of a hazard to describe it: the snapshot's copy has no photo or reporter. */
type BriefHazard = {
  category: string;
  description: string | null;
  ts: string;
  lat: number | null;
  lng: number | null;
};

export function HazardBrief({
  hazard,
  area,
  now,
  onOpen,
  onClose,
}: {
  hazard: BriefHazard;
  area: string;
  now: number;
  /** Opens this report on the hazard map. */
  onOpen: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const alarm = CATEGORY_TONE[hazard.category as Category] === "alarm";
  return (
    <Card tone={alarm ? "border-l-alarm" : "border-l-caution"} label={t("map.legend_hazard")} onClose={onClose}>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="font-display text-[16px] leading-tight font-extrabold">{t(`cat.${hazard.category}`)}</span>
        <span className="mono text-[10px] text-paper-3">{agoLabel(hazard.ts, now)}</span>
      </p>
      {hazard.description && <p className="mt-1 text-[12.5px] leading-snug">{hazard.description}</p>}
      <p className="mono mt-1 text-[11px] text-paper-2">
        {area}
        {hazard.lat != null && hazard.lng != null && (
          <>
            {" · "}
            {hazard.lat.toFixed(5)}, {hazard.lng.toFixed(5)}
          </>
        )}
        {hazard.lat == null && <span className="text-caution"> · {t("dash.area_only")}</span>}
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="tap mono mt-1.5 flex w-full items-center justify-center rounded-instrument border-[1.5px] border-hv text-[10px] font-bold tracking-[1px] text-hv"
      >
        {t("hz.title")}
      </button>
    </Card>
  );
}

/** A flood pin, tapped: how deep, where, and how long ago it was seen. */
export function WaterBrief({
  report,
  area,
  approx,
  stale,
  now,
  onClose,
}: {
  report: WaterReport;
  area: string;
  /** The point is its street's, not the reporter's. */
  approx: boolean;
  /** Old enough that the water has probably moved (lib/waterMap.ts). */
  stale?: boolean;
  now: number;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Card tone="border-l-hv" label={t("dash.tab_water")} onClose={onClose}>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="font-display text-[16px] leading-tight font-extrabold">{t(`water.${report.level_category}`)}</span>
        <span className={`mono text-[10px] ${stale ? "font-bold text-caution" : "text-paper-3"}`}>
          {agoLabel(report.ts, now)}
        </span>
      </p>
      {stale && (
        <p className="mt-1 text-[11.5px] leading-snug text-caution">{t("loc.water_old")}</p>
      )}
      <p className="mono mt-1 text-[11px] text-paper-2">
        {report.location_label || area}
        {report.lat != null && report.lng != null && (
          <>
            {" · "}
            {report.lat.toFixed(5)}, {report.lng.toFixed(5)}
          </>
        )}
        {approx && <span className="text-caution"> · {t("dash.area_only")}</span>}
      </p>
    </Card>
  );
}
