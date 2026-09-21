"use client";

import type { ReactNode } from "react";
import { useT } from "./AppRuntime";
import type { EvacCenter } from "@/lib/advisory";
import type { Fix } from "@/lib/sos";

/** What a tapped map mark says about itself, on either map. */
export type MapSelection = "centre" | "you" | null;

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
