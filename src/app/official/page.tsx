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

/**
 * Official home: a live map of the barangay with every open SOS, hazard and
 * water report on it (PRD §4: "sets the current signal level ... oversees
 * rescue dispatch").
 *
 * Wide screens: list on the left, map in the middle, the selected item on the
 * right. Phones: the map fills the screen, the list pulls up from the bottom,
 * and a selected item opens as a bottom card. The signal and CHANGE ADVISORY
 * stay at the top of the list either way; readiness and population are the
 * Barangay tab.
 */
export default function OfficialHome() {
  const { snapshot } = useSync();
  const t = useT();
  const { title } = useItemText();

  const [data, setData] = useState<Dashboard>(EMPTY);
  const [tab, setTab] = useState<Tab>("sos");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    setData(await loadDashboard(snapshot));
  }, [snapshot]);

  /* Live: a new SOS, a report or a change from another device lands here within seconds. */
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

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      const item = all.find((i) => i.id === id);
      if (item) setTab(TAB_OF[item.kind]);
    },
    [all],
  );
  const labelFor = useCallback((item: DashItem) => title(item), [title]);

  const listBody =
    tab === "barangay" ? (
      <BarangayPanel />
    ) : (
      <ItemList items={list} selectedId={selectedId} onSelect={select} now={now} />
    );

  const detail = selected && (
    <ItemDetail
      key={selected.id}
      item={selected}
      now={now}
      onClose={() => setSelectedId(null)}
      onChanged={() => void refresh()}
    />
  );

  return (
    <main className="relative flex min-h-0 flex-1 overflow-hidden">
      {/* Wide screens: the list. */}
      <aside className="hidden w-[20rem] shrink-0 flex-col border-r border-line-soft bg-ink-900 @3xl:flex">
        <div className="grid gap-2.5 border-b border-line-soft p-3">
          <SignalHeader />
          <Counters {...counts} />
        </div>
        <Tabs tab={tab} onTab={setTab} counts={counts} />
        <div className="min-h-0 flex-1 overflow-y-auto">{listBody}</div>
      </aside>

      <div className="relative min-h-[28rem] flex-1">
        <DashboardMap items={all} selectedId={selectedId} onSelect={select} labelFor={labelFor} />

        {/* Phones: the list pulls up; a selected item opens as a bottom card. */}
        <div className="absolute inset-x-0 bottom-0 z-10 @3xl:hidden">
          {selected ? (
            <section className="max-h-[70dvh] overflow-y-auto rounded-t-instrument border-t-[1.5px] border-line bg-ink-900 shadow-lg">
              {detail}
            </section>
          ) : (
            <section
              className={`flex flex-col rounded-t-instrument border-t-[1.5px] border-line bg-ink-900 shadow-lg ${
                sheetOpen ? "h-[70dvh]" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => setSheetOpen((open) => !open)}
                aria-expanded={sheetOpen}
                className="flex w-full flex-col items-center gap-1.5 px-3 pt-1.5 pb-2"
              >
                <span className="h-1 w-10 rounded-full bg-line" aria-hidden />
                <span className="mono flex w-full items-center justify-between text-[10.5px] font-bold tracking-[0.6px]">
                  <span className={counts.sos > 0 ? "text-alarm" : "text-paper-3"}>
                    {counts.sos} {t("dash.open_sos")}
                  </span>
                  <span className={counts.hazards > 0 ? "text-caution" : "text-paper-3"}>
                    {counts.hazards} {t("dash.open_hazards")}
                  </span>
                  <span className={counts.water > 0 ? "text-hv" : "text-paper-3"}>
                    {counts.water} {t("dash.water_reports")}
                  </span>
                </span>
              </button>
              {sheetOpen && (
                <>
                  <div className="border-b border-line-soft px-3 pb-2.5">
                    <SignalHeader />
                  </div>
                  <Tabs tab={tab} onTab={setTab} counts={counts} />
                  <div className="min-h-0 flex-1 overflow-y-auto">{listBody}</div>
                </>
              )}
            </section>
          )}
        </div>
      </div>

      {/* Wide screens: the selected item. */}
      {selected && (
        <aside className="hidden w-[20rem] shrink-0 overflow-y-auto border-l border-line-soft bg-ink-900 @3xl:block">
          {detail}
        </aside>
      )}
    </main>
  );
}
