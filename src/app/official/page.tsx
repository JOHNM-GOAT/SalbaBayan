"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSync, useT } from "@/components/AppRuntime";
import { DashboardMap } from "@/components/dashboard/DashboardMap";
import {
  BarangayPanel,
  Counters,
  ItemDetail,
  ItemList,
  SignalHeader,
  Tabs,
  useItemText,
  type Tab,
} from "@/components/dashboard/DashboardPanels";
import { loadDashboard, type DashItem, type Dashboard } from "@/lib/dashboard";
import { subscribeHazards } from "@/lib/hazards";
import { onQueueChanged } from "@/lib/offlineQueue";
import { subscribeRescue } from "@/lib/sos";
import { subscribeWaterReports } from "@/lib/water";

const EMPTY: Dashboard = { sos: [], hazards: [], water: [] };
const TAB_OF: Record<DashItem["kind"], Tab> = { sos: "sos", hazard: "hazards", water: "water" };

/** Narrow screens close the menu when an item is picked, so the map and its card show. */
const isNarrow = () => typeof window !== "undefined" && window.innerWidth < 768;

/**
 * Official home: the barangay map, full screen and fully interactive, with
 * every open SOS, hazard and water report on it.
 *
 * The list is a pop-up sidebar behind MENU; a tapped pin or row slides its
 * details in from the right. Both float over the map instead of taking space
 * from it. The signal and CHANGE ADVISORY stay at the top of the menu, and the
 * Barangay tab holds readiness, gaps, population and households.
 */
export default function OfficialHome() {
  const { snapshot } = useSync();
  const t = useT();
  const { title } = useItemText();

  const [data, setData] = useState<Dashboard>(EMPTY);
  const [tab, setTab] = useState<Tab>("sos");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /* The drawer keeps showing the last item while it slides shut. */
  const [shownId, setShownId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    setData(await loadDashboard(snapshot));
  }, [snapshot]);

  /* Live: a new SOS, a report or a change from another device lands within seconds. */
  useEffect(() => {
    queueMicrotask(() => void refresh());
    const stops = [
      subscribeRescue(() => void refresh()),
      subscribeHazards(() => void refresh()),
      subscribeWaterReports(() => void refresh()),
      onQueueChanged(() => void refresh()),
    ];
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      stops.forEach((stop) => stop());
      window.clearInterval(tick);
    };
  }, [refresh]);

  const all = useMemo(() => [...data.sos, ...data.hazards, ...data.water], [data]);
  const selected = all.find((item) => item.id === selectedId) ?? null;
  const list = tab === "sos" ? data.sos : tab === "hazards" ? data.hazards : tab === "water" ? data.water : [];
  const counts = { sos: data.sos.length, hazards: data.hazards.length, water: data.water.length };

  const shown = selected ?? all.find((item) => item.id === shownId) ?? null;

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      setShownId(id);
      const item = all.find((i) => i.id === id);
      if (item) setTab(TAB_OF[item.kind]);
      if (isNarrow()) setMenuOpen(false);
    },
    [all],
  );
  const labelFor = useCallback((item: DashItem) => title(item), [title]);

  return (
    <main className="relative flex min-h-0 flex-1 overflow-hidden">
      <div className="relative min-h-[28rem] flex-1">
        <DashboardMap items={all} selectedId={selectedId} onSelect={select} labelFor={labelFor} />

        {/* MENU: opens the list; the counts stay readable while it is shut. */}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-expanded={menuOpen}
          aria-controls="dashboard-menu"
          className={`absolute top-2.5 left-2.5 z-10 flex items-center gap-2.5 rounded-instrument border-[1.5px] border-line bg-ink-900/95 px-3 py-2 shadow-md transition-opacity ${
            menuOpen ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          <span className="mono text-[10.5px] font-bold tracking-[0.8px]">{t("dash.menu")}</span>
          <span className="mono flex gap-2 text-[10.5px] font-bold">
            <span className={counts.sos > 0 ? "text-alarm" : "text-paper-3"}>{counts.sos} SOS</span>
            <span className={counts.hazards > 0 ? "text-caution" : "text-paper-3"}>▲{counts.hazards}</span>
            <span className={counts.water > 0 ? "text-hv" : "text-paper-3"}>≈{counts.water}</span>
          </span>
        </button>

        {/* Narrow screens: tapping the map beside the open menu closes it. */}
        {menuOpen && (
          <button
            type="button"
            aria-label={t("hz.close")}
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 z-10 bg-paper/20 md:hidden"
          />
        )}

        {/* The pop-up sidebar. */}
        <aside
          id="dashboard-menu"
          inert={!menuOpen}
          className={`absolute inset-y-0 left-0 z-20 flex w-[20rem] max-w-[88%] flex-col border-r border-line-soft bg-ink-900 shadow-xl transition-transform duration-200 ease-out ${
            menuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="grid gap-2.5 border-b border-line-soft p-3">
            <div className="flex items-center justify-between">
              <span className="lbl">{t("dash.menu")}</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label={t("hz.close")}
                className="px-1 text-[20px] leading-none text-paper-3"
              >
                ×
              </button>
            </div>
            <SignalHeader />
            <Counters {...counts} />
          </div>
          <Tabs tab={tab} onTab={setTab} counts={counts} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "barangay" ? (
              <BarangayPanel />
            ) : (
              <ItemList items={list} selectedId={selectedId} onSelect={select} now={now} />
            )}
          </div>
        </aside>

        {/* The slide-out drawer with the selected item. */}
        <aside
          inert={!selected}
          className={`absolute inset-y-0 right-0 z-20 w-[22rem] max-w-[92%] overflow-y-auto border-l border-line-soft bg-ink-900 shadow-xl transition-transform duration-200 ease-out ${
            selected ? "translate-x-0" : "translate-x-full"
          }`}
        >
          {shown && (
            <ItemDetail
              key={shown.id}
              item={shown}
              now={now}
              onClose={() => setSelectedId(null)}
              onChanged={() => void refresh()}
            />
          )}
        </aside>
      </div>
    </main>
  );
}
