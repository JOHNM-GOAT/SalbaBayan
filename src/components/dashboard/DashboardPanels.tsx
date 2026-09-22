"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSync, useT } from "../AppRuntime";
import { AdvisoryBanner } from "../AdvisoryBanner";
import { AdvisoryModal } from "../AdvisoryEditor";
import { HazardPhoto } from "../HazardPhoto";
import { HoldToConfirm } from "../HoldToConfirm";
import { PersonLabel } from "../PersonLabel";
import type { EvacCenter } from "@/lib/advisory";
import { MAX_CENTRES } from "@/lib/centres";
import { capacityState, centreTotal, subscribeHeadcounts } from "@/lib/headcount";
import { directionsUrl, type DashItem } from "@/lib/dashboard";
import { resolveHazard } from "@/lib/hazards";
import { signalStyle } from "@/lib/signal";
import { acknowledge, markRescued } from "@/lib/sos";
import { agoLabel } from "@/lib/water";

export type Tab = "sos" | "hazards" | "water" | "centres";

export function clockLabel(iso: string): string {
  return new Date(iso)
    .toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
    .toUpperCase();
}

/* ---------------------------------------------------------------------------
 * Header: the signal, and the one control officials open this screen for
 * ------------------------------------------------------------------------ */

export function SignalHeader() {
  const { snapshot } = useSync();
  const t = useT();
  const [advisoryOpen, setAdvisoryOpen] = useState(false);
  if (!snapshot) return null;
  const level = snapshot.barangay.current_signal_level;
  const style = signalStyle(level);
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2.5">
        <span
          className={`mono flex size-9 shrink-0 items-center justify-center rounded-[3px] text-[17px] font-bold ${style.bg} ${style.ink}`}
          aria-hidden
        >
          {level}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`font-display text-[15px] leading-tight font-extrabold ${style.text}`}>
            {level === 0 ? t("ui.no_signal") : t("ui.signal_no", { n: level })}
          </p>
          <p className="mono truncate text-[9.5px] tracking-[0.6px] text-paper-3">
            {snapshot.barangay.name.toUpperCase()}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setAdvisoryOpen(true)}
        className="tap mono flex items-center justify-center rounded-instrument bg-hv text-[10.5px] font-bold tracking-[1px] text-hv-ink"
      >
        {t("off.change_advisory")}
      </button>
      {advisoryOpen && <AdvisoryModal onClose={() => setAdvisoryOpen(false)} />}
      <AdvisoryBanner barangayId={snapshot.barangay.id} />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Counters and tabs
 * ------------------------------------------------------------------------ */

export function Counters({ sos, hazards, water }: { sos: number; hazards: number; water: number }) {
  const t = useT();
  const box = (n: number, label: string, tone: string) => (
    <div className="rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-2.5 py-2">
      <p className={`mono text-[20px] leading-none font-bold ${n > 0 ? tone : "text-paper-3"}`}>{n}</p>
      <p className="mono mt-1 text-[8.5px] leading-tight font-semibold tracking-[0.6px] text-paper-3">{label}</p>
    </div>
  );
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {box(sos, t("dash.open_sos"), "text-alarm")}
      {box(hazards, t("dash.open_hazards"), "text-caution")}
      {box(water, t("dash.water_reports"), "text-hv")}
    </div>
  );
}

export function Tabs({
  tab,
  onTab,
  counts,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  counts: Record<Tab, number>;
}) {
  const t = useT();
  const item = (id: Tab, label: string, count?: number) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => onTab(id)}
      className={`mono flex-1 border-b-2 px-1 pb-1.5 text-[9.5px] font-bold tracking-[0.7px] ${
        tab === id ? "border-hv text-hv" : "border-transparent text-paper-3"
      }`}
    >
      {label}
      {count !== undefined && <span className="ml-1 rounded-[2px] bg-ink-700 px-1 text-paper-2">{count}</span>}
    </button>
  );
  return (
    <div className="flex border-b border-line-soft" role="tablist">
      {item("sos", t("dash.tab_sos"), counts.sos)}
      {item("hazards", t("dash.tab_hazards"), counts.hazards)}
      {item("water", t("dash.tab_water"), counts.water)}
      {item("centres", t("dash.tab_centres"), counts.centres)}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * List
 * ------------------------------------------------------------------------ */

export function useItemText() {
  const t = useT();
  return useMemo(() => itemText(t), [t]);
}

function itemText(t: ReturnType<typeof useT>) {
  const title = (item: DashItem): string => {
    if (item.kind === "sos") {
      return item.person ? `${item.person.first_name} ${item.person.last_name}`.trim() : t("profile.no_name");
    }
    if (item.kind === "hazard") return t(`cat.${item.hazard.category}`);
    return t(`water.${item.water.level_category}`);
  };
  const status = (item: DashItem): { text: string; tone: string; dot: string } => {
    if (item.kind === "sos") {
      return item.sos.status === "pending"
        ? { text: t("sos.not_seen"), tone: "text-alarm", dot: "bg-alarm" }
        : { text: t("sos.state_ack"), tone: "text-caution", dot: "bg-caution" };
    }
    if (item.kind === "hazard") return { text: t("hazard.unresolved"), tone: "text-caution", dot: "bg-caution" };
    return { text: t("dash.tab_water"), tone: "text-hv", dot: "bg-hv" };
  };
  return { title, status };
}

export function ItemList({
  items,
  selectedId,
  onSelect,
  now,
}: {
  items: DashItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  now: number;
}) {
  const { snapshot } = useSync();
  const t = useT();
  const { title, status } = useItemText();
  const area = (id: string | null) => snapshot?.puroks.find((p) => p.id === id)?.name ?? "";

  if (items.length === 0) {
    return <p className="mono px-3 py-6 text-center text-[11px] text-paper-3">{t("dash.none")}</p>;
  }
  return (
    <ul className="flex flex-col">
      {items.map((item) => {
        const s = status(item);
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={item.id === selectedId}
              className={`flex w-full items-start gap-2.5 border-b border-line-soft px-3 py-2.5 text-left ${
                item.id === selectedId ? "bg-hv/10" : "hover:bg-ink-800"
              }`}
            >
              <span className={`mt-1 size-2.5 shrink-0 rounded-full ${s.dot}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{title(item)}</span>
                <span className="mono block truncate text-[9.5px] tracking-[0.4px] text-paper-3">
                  {[area(item.purokId), item.lat == null ? t("resp.no_fix") : item.approx ? t("dash.area_only") : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {item.kind !== "sos" && item.person && (
                  <span className="mt-0.5 block">
                    <PersonLabel person={item.person} />
                  </span>
                )}
              </span>
              <span className="shrink-0 text-right">
                <span className={`mono block text-[9px] font-bold tracking-[0.5px] ${s.tone}`}>{s.text}</span>
                <span className="mono block text-[10px] text-paper-3">{agoLabel(item.ts, now)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------------------
 * Detail
 * ------------------------------------------------------------------------ */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="lbl text-[9px]">{label}</p>
      <div className="mt-0.5 text-[12.5px]">{children}</div>
    </div>
  );
}

export function ItemDetail({
  item,
  now,
  onClose,
  onChanged,
}: {
  item: DashItem;
  now: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { snapshot } = useSync();
  const t = useT();
  const { title, status } = useItemText();
  const s = status(item);
  const area = snapshot?.puroks.find((p) => p.id === item.purokId)?.name ?? "—";

  return (
    <div className="grid gap-3 p-3.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className={`mono text-[10px] font-bold tracking-[0.7px] ${s.tone}`}>{s.text}</p>
          <h2 className="mt-0.5 font-display text-[18px] leading-tight font-extrabold">{title(item)}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("hz.close")}
          className="shrink-0 px-1 text-[20px] leading-none text-paper-3"
        >
          ×
        </button>
      </div>

      {item.kind === "sos" && item.person && (
        <Row label={t("dash.who")}>
          <PersonLabel person={item.person} />
        </Row>
      )}
      {item.kind !== "sos" && (
        <Row label={t("dash.reported")}>
          <PersonLabel person={item.person} />
        </Row>
      )}

      {item.kind === "water" && item.water.location_label && (
        <Row label={t("water.where")}>{item.water.location_label}</Row>
      )}
      {item.kind === "hazard" && item.hazard.description && (
        <Row label={t("dash.notes")}>{item.hazard.description}</Row>
      )}
      {item.kind === "sos" && item.sos.notes && <Row label={t("dash.notes")}>{item.sos.notes}</Row>}

      <Row label={t("dash.location")}>
        <p>{area}</p>
        {item.lat != null && item.lng != null && (
          <p className="mono text-[11px] text-paper-2">
            {item.lat.toFixed(5)}, {item.lng.toFixed(5)}
            {item.approx && <span className="text-caution"> · {t("dash.area_only")}</span>}
          </p>
        )}
        {item.lat == null && <p className="mono text-[11px] text-caution">{t("resp.no_fix")}</p>}
      </Row>

      {item.kind === "sos" && item.sos.accuracy_m != null && (
        <Row label={t("dash.accuracy")}>
          <span className="mono">± {Math.round(item.sos.accuracy_m)} M</span>
        </Row>
      )}

      <Row label={item.kind === "sos" ? t("dash.raised") : t("dash.reported")}>
        <span className="mono text-[11.5px]">
          {clockLabel(item.ts)} · {agoLabel(item.ts, now)}
        </span>
      </Row>

      {item.kind === "hazard" && item.hazard.photo_url && <HazardPhoto path={item.hazard.photo_url} />}

      {/* The action this item is waiting for. */}
      {item.kind === "sos" && item.sos.status === "pending" && (
        <button
          type="button"
          onClick={() => void acknowledge(item.id).then(onChanged)}
          className="tap rounded-instrument bg-hv text-[13px] font-bold text-hv-ink"
        >
          {t("resp.ack")}
        </button>
      )}
      {item.kind === "sos" && item.sos.status === "acknowledged" && (
        <HoldToConfirm
          label={t("resp.rescued")}
          holdingLabel={t("sos.cancelling")}
          tone="accent"
          onConfirm={() => void markRescued(item.id).then(onChanged)}
        />
      )}
      {item.kind === "hazard" && (
        <HoldToConfirm
          label={t("hazard.resolve")}
          holdingLabel={t("sos.cancelling")}
          tone="accent"
          onConfirm={() => void resolveHazard(item.id).then(onChanged)}
        />
      )}

      {item.lat != null && item.lng != null && (
        <div className="grid gap-1.5 border-t border-line-soft pt-3">
          <a
            href={directionsUrl(item.lat, item.lng)}
            target="_blank"
            rel="noopener noreferrer"
            className="tap flex items-center justify-center rounded-instrument border-[1.5px] border-hv text-[12px] font-bold text-hv"
          >
            {t("dash.directions")}
          </a>
          <p className="text-[10.5px] leading-snug text-paper-3">{t("dash.directions_note")}</p>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Centres: up to three, each with its live headcount
 * ------------------------------------------------------------------------ */

/** People inside each centre in the current evacuation, live. */
export function useCentreCounts(centres: EvacCenter[]): Map<string, number> {
  const { snapshot } = useSync();
  const since = snapshot?.barangay.evacuation_started_at ?? null;
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const ids = centres.map((c) => c.id).join(",");

  useEffect(() => {
    let live = true;
    const load = () =>
      void Promise.all(ids.split(",").filter(Boolean).map(async (id) => [id, await centreTotal(id, since)] as const)).then(
        (pairs) => {
          if (live) setCounts(new Map(pairs));
        },
      );
    load();
    const stop = subscribeHeadcounts(load);
    return () => {
      live = false;
      stop();
    };
  }, [ids, since]);

  return counts;
}

function Fill({ count, capacity }: { count: number | undefined; capacity: number | null }) {
  const t = useT();
  const state = capacity ? capacityState(count ?? 0, capacity) : "ok";
  const tone = state === "full" ? "bg-alarm" : state === "filling" ? "bg-caution" : "bg-clear";
  const pct = capacity ? Math.min(100, Math.round(((count ?? 0) / capacity) * 100)) : 0;
  return (
    <div className="grid gap-1">
      <p className="mono flex items-baseline gap-1 text-[11px]">
        <span className="text-[17px] leading-none font-bold">{count ?? "—"}</span>
        <span className="text-paper-3">/ {capacity ?? "—"}</span>
        <span className="ml-auto text-[9px] font-bold tracking-[0.6px] text-paper-3">{t("dash.inside")}</span>
      </p>
      {capacity != null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-ink-700" aria-hidden>
          <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function CentreList({
  centres,
  counts,
  selectedId,
  onSelect,
}: {
  centres: EvacCenter[];
  counts: Map<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  return (
    <div className="grid gap-2 p-3">
      {centres.map((centre) => (
        <button
          key={centre.id}
          type="button"
          onClick={() => onSelect(centre.id)}
          aria-current={centre.id === selectedId}
          className={`grid gap-2 rounded-instrument border-[1.5px] px-3 py-2.5 text-left ${
            centre.id === selectedId ? "border-hv bg-hv/10" : "border-line-soft bg-ink-800 hover:border-line"
          }`}
        >
          <span className="truncate text-[13px] font-bold">{centre.name}</span>
          <Fill count={counts.get(centre.id)} capacity={centre.capacity} />
        </button>
      ))}
      <p className="mono text-[9.5px] tracking-[0.5px] text-paper-3">
        {t("dash.centres_of", { n: centres.length })}
      </p>
      <p className="text-[11.5px] leading-snug text-paper-3">
        {centres.length >= MAX_CENTRES ? t("dash.centres_full") : t("dash.tap_hint")}
      </p>
    </div>
  );
}

export function CentreDetail({
  centre,
  count,
  onlyOne,
  onEdit,
  onRemove,
}: {
  centre: EvacCenter;
  count: number | undefined;
  /** The last centre cannot be removed (0047). */
  onlyOne: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <div className="grid gap-3 p-3.5">
      <div>
        <p className="mono text-[10px] font-bold tracking-[0.7px] text-clear">{t("ui.evac_center")}</p>
        <h2 className="mt-0.5 font-display text-[18px] leading-tight font-extrabold">{centre.name}</h2>
      </div>
      <Fill count={count} capacity={centre.capacity} />
      {centre.lat != null && centre.lng != null && (
        <Row label={t("dash.location")}>
          <p className="mono text-[11px] text-paper-2">
            {centre.lat.toFixed(5)}, {centre.lng.toFixed(5)}
          </p>
        </Row>
      )}
      <button
        type="button"
        onClick={onEdit}
        className="tap mono rounded-instrument border-[1.5px] border-hv text-[10.5px] font-bold tracking-[1px] text-hv"
      >
        {t("dash.edit_centre")}
      </button>
      {onlyOne ? (
        <p className="text-[11px] leading-snug text-paper-3">{t("dash.last_centre")}</p>
      ) : (
        <HoldToConfirm
          label={t("dash.hold_remove")}
          holdingLabel={t("sos.cancelling")}
          tone="alarm"
          onConfirm={onRemove}
        />
      )}
      {centre.lat != null && centre.lng != null && (
        <a
          href={directionsUrl(centre.lat, centre.lng)}
          target="_blank"
          rel="noopener noreferrer"
          className="tap flex items-center justify-center rounded-instrument border-[1.5px] border-line-soft text-[12px] font-bold text-paper-2"
        >
          {t("dash.directions")}
        </a>
      )}
    </div>
  );
}
