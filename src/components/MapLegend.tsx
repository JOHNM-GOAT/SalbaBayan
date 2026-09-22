"use client";

import type { ReactNode } from "react";
import { useT } from "./AppRuntime";
import { CENTRE_ICON, HAZARD_ICON, SOS_ICON, WATER_ICON } from "@/lib/mapMarks";
import { CATEGORY_TONE, type Category } from "@/lib/hazards";

/**
 * The key both maps share. Each swatch is drawn the way the map draws it —
 * dashed rule, line, pin — so it can be matched by shape, not only by colour.
 */
export function MapLegend({
  routeColour,
  right,
  rescue,
  position = "bottom-0",
}: {
  /** Shown only on the evacuation map, which is the only one with a route. */
  routeColour?: string;
  right?: ReactNode;
  /** The official dashboard also draws SOS calls and water readings. */
  rescue?: boolean;
  /** Where the bar sits; the dashboard lifts it above its phone sheet. */
  position?: string;
}) {
  const t = useT();
  return (
    <div className={`pointer-events-none absolute inset-x-0 ${position} flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft bg-ink-900/92 px-2.5 py-1.5`}>
      <Item label={t("map.legend_boundary")}>
        <span
          className="h-[3px] w-3.5"
          style={{ backgroundImage: "repeating-linear-gradient(90deg, var(--color-hv) 0 4px, transparent 4px 7px)" }}
        />
      </Item>
      {routeColour && (
        <Item label={t("map.legend_route")}>
          <span className="h-[3px] w-3.5" style={{ background: routeColour }} />
        </Item>
      )}
      {rescue && (
        <Item label={t("nav.sos")}>
          <Pin colour="var(--color-alarm)" icon={SOS_ICON} />
        </Item>
      )}
      <Item label={t("map.legend_hazard")}>
        <Pin colour="var(--color-alarm)" icon={HAZARD_ICON.other} />
      </Item>
      {rescue && (
        <Item label={t("dash.tab_water")}>
          <Pin colour="var(--color-caution)" icon={WATER_ICON} />
        </Item>
      )}
      <Item label={t("ui.evac_center")}>
        <Pin colour="var(--color-clear)" icon={CENTRE_ICON} />
      </Item>
      {right && <span className="ml-auto min-w-0 truncate">{right}</span>}
    </div>
  );
}

/** What each hazard icon means — the hazard map's own key, above the shared one. */
export function HazardCategoryKey() {
  const t = useT();
  const categories = Object.keys(HAZARD_ICON) as Category[];
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-3.5 py-1.5">
      {categories.map((category) => (
        <Item key={category} label={t(`cat.${category}`)}>
          <Pin colour={`var(--color-${CATEGORY_TONE[category]})`} icon={HAZARD_ICON[category]} />
        </Item>
      ))}
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {children}
      <span className="mono text-[9px] font-semibold tracking-[0.6px] text-paper-2">{label}</span>
    </span>
  );
}

/** The map pin at legend size. */
function Pin({ colour, icon }: { colour: string; icon: string }) {
  return (
    <svg width="11" height="14" viewBox="0 0 28 36" className="shrink-0 overflow-visible" aria-hidden>
      <path
        d="M14 1C6.8 1 1 6.7 1 13.8 1 23.2 14 35 14 35s13-11.8 13-21.2C27 6.7 21.2 1 14 1z"
        style={{ fill: colour }}
        stroke="#fff"
        strokeWidth="2"
      />
      <svg
        x="7"
        y="6.5"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: icon }}
      />
    </svg>
  );
}
