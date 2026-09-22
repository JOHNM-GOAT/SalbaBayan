"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useSync, useT } from "@/components/AppRuntime";
import { DashboardMap } from "@/components/dashboard/DashboardMap";
import { CentreModal } from "@/components/dashboard/PinMenu";
import {
  CentreDetail,
  CentreList,
  Counters,
  ItemDetail,
  ItemList,
  SignalHeader,
  Tabs,
  useCentreCounts,
  useItemText,
  type Tab,
} from "@/components/dashboard/DashboardPanels";
import { loadStreets, removeCentre, updateCentre } from "@/lib/centres";
import { dashboardMenu } from "@/lib/dashboardMenu";
import { loadDashboard, type DashItem, type Dashboard } from "@/lib/dashboard";
import { subscribeHazards } from "@/lib/hazards";
import { onQueueChanged } from "@/lib/offlineQueue";
import { subscribeRescue } from "@/lib/sos";
import { subscribeWaterReports } from "@/lib/water";

const EMPTY: Dashboard = { sos: [], hazards: [], water: [] };
const TAB_OF: Record<DashItem["kind"], Tab> = { sos: "sos", hazard: "hazards", water: "water" };

type Selection = { id: string; kind: "item" | "centre" } | null;

/**
 * Official home: the barangay map, full screen and fully interactive.
 *
 * Tapping a street drops a pin with a menu — hazard, water depth, or a new
 * evacuation centre (DashboardMap / PinMenu). Every open SOS, hazard and water
 * report is on the map, and the lists sit in a right sidebar opened from the
 * menu icon in the header. A tapped pin opens its details in that same
 * sidebar. On a wide screen the sidebar sits beside the map; on a phone it
 * slides over it.
 */
export default function OfficialHome() {
  const { snapshot } = useSync();
  const t = useT();
  const { title } = useItemText();
  const menuOpen = useSyncExternalStore(dashboardMenu.subscribe, dashboardMenu.get, () => false);

  const [data, setData] = useState<Dashboard>(EMPTY);
  const [tab, setTab] = useState<Tab>("sos");
  const [selected, setSelected] = useState<Selection>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const centres = useMemo(() => snapshot?.centers ?? [], [snapshot]);
  const centreCounts = useCentreCounts(centres);

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

  /* A laptop opens with the sidebar beside the map; a phone with the map alone. */
  useEffect(() => {
    dashboardMenu.set(window.innerWidth >= 1024);
    return () => dashboardMenu.set(false);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const all = useMemo(() => [...data.sos, ...data.hazards, ...data.water], [data]);
  const item = selected?.kind === "item" ? (all.find((i) => i.id === selected.id) ?? null) : null;
  const centre = selected?.kind === "centre" ? (centres.find((c) => c.id === selected.id) ?? null) : null;
  const list = tab === "sos" ? data.sos : tab === "hazards" ? data.hazards : data.water;
  const counts = {
    sos: data.sos.length,
    hazards: data.hazards.length,
    water: data.water.length,
    centres: centres.length,
  };
  const editingCentre = centres.find((c) => c.id === editing) ?? null;

  const select = useCallback(
    (id: string, kind: "item" | "centre") => {
      setSelected({ id, kind });
      if (kind === "centre") setTab("centres");
      else {
        const found = all.find((i) => i.id === id);
        if (found) setTab(TAB_OF[found.kind]);
      }
      dashboardMenu.set(true);
    },
    [all],
  );
  const labelFor = useCallback((i: DashItem) => title(i), [title]);

  const back = (
    <button
      type="button"
      onClick={() => setSelected(null)}
      className="mono flex items-center gap-1 text-[10px] font-bold tracking-[0.8px] text-paper-2 hover:text-paper"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {t("dash.back")}
    </button>
  );

  return (
    <main className="relative flex min-h-0 flex-1 overflow-hidden">
      <div className="relative min-h-[28rem] min-w-0 flex-1">
        <DashboardMap
          items={all}
          selectedId={selected?.id ?? null}
          onSelect={select}
          labelFor={labelFor}
          onPinned={setToast}
        />

        {/* The counts stay readable while the sidebar is shut; tapping opens it. */}
        {!menuOpen && (
          <button
            type="button"
            onClick={() => dashboardMenu.set(true)}
            className="mono absolute top-2.5 left-2.5 z-10 flex gap-2 rounded-instrument border-[1.5px] border-line bg-ink-900/95 px-2.5 py-1.5 text-[10.5px] font-bold shadow-md"
          >
            <span className={counts.sos > 0 ? "text-alarm" : "text-paper-3"}>{counts.sos} SOS</span>
            <span className={counts.hazards > 0 ? "text-caution" : "text-paper-3"}>▲{counts.hazards}</span>
            <span className={counts.water > 0 ? "text-hv" : "text-paper-3"}>≈{counts.water}</span>
          </button>
        )}

        {toast && (
          <p
            role="status"
            className="absolute bottom-14 left-1/2 z-30 w-[min(24rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-instrument border-[1.5px] border-clear bg-ink-900 px-3 py-2 text-center text-[12px] leading-snug font-semibold text-clear shadow-lg"
          >
            {toast}
          </p>
        )}

        {/* Phones: tapping the map beside the open sidebar closes it. */}
        {menuOpen && (
          <button
            type="button"
            aria-label={t("hz.close")}
            onClick={() => dashboardMenu.set(false)}
            className="absolute inset-0 z-10 bg-paper/20 md:hidden"
          />
        )}
      </div>

      {/*
        The right sidebar. Over the map on phones and tablets; beside it from
        lg up, where there is room for both and the map resizes to fit.
      */}
      <aside
        id="dashboard-menu"
        inert={!menuOpen}
        className={`absolute inset-y-0 right-0 z-20 w-[22rem] max-w-[92%] overflow-hidden border-l border-line-soft bg-ink-900 shadow-xl transition-[transform,width] duration-200 ease-out lg:relative lg:max-w-none lg:shadow-none ${
          menuOpen ? "translate-x-0" : "translate-x-full lg:w-0 lg:border-l-0"
        } lg:translate-x-0`}
      >
        <div className="flex h-full w-[22rem] max-w-full flex-col">
          {item || centre ? (
            <>
              <div className="flex items-center justify-between border-b border-line-soft px-3.5 py-2.5">
                {back}
                <CloseButton label={t("hz.close")} />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {item && (
                  <ItemDetail
                    key={item.id}
                    item={item}
                    now={now}
                    onClose={() => setSelected(null)}
                    onChanged={() => void refresh()}
                  />
                )}
                {centre && snapshot && (
                  <CentreDetail
                    key={centre.id}
                    centre={centre}
                    count={centreCounts.get(centre.id)}
                    onlyOne={centres.length <= 1}
                    onEdit={() => setEditing(centre.id)}
                    onRemove={() => {
                      setSelected(null);
                      void loadStreets().then((streets) =>
                        removeCentre(snapshot, streets, centre.id).then(() => setToast(t("dash.centre_saved"))),
                      );
                    }}
                  />
                )}
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-2.5 border-b border-line-soft p-3">
                <div className="flex items-center justify-between">
                  <span className="lbl">{t("dash.menu")}</span>
                  <CloseButton label={t("hz.close")} />
                </div>
                <SignalHeader />
                <Counters sos={counts.sos} hazards={counts.hazards} water={counts.water} />
              </div>
              <Tabs tab={tab} onTab={setTab} counts={counts} />
              <div className="min-h-0 flex-1 overflow-y-auto">
                {tab === "centres" ? (
                  <CentreList
                    centres={centres}
                    counts={centreCounts}
                    selectedId={null}
                    onSelect={(id) => select(id, "centre")}
                  />
                ) : (
                  <ItemList items={list} selectedId={null} onSelect={(id) => select(id, "item")} now={now} />
                )}
              </div>
            </>
          )}
        </div>
      </aside>

      {editingCentre && snapshot && (
        <CentreModal
          title={t("dash.edit_centre")}
          place={
            editingCentre.lat != null && editingCentre.lng != null
              ? `${editingCentre.lat.toFixed(5)}, ${editingCentre.lng.toFixed(5)}`
              : ""
          }
          initial={{ name: editingCentre.name, capacity: editingCentre.capacity }}
          holdLabel={t("dash.hold_save_centre")}
          onCancel={() => setEditing(null)}
          onSave={(input) => {
            const id = editingCentre.id;
            setEditing(null);
            void loadStreets().then((streets) =>
              updateCentre(snapshot, streets, id, input).then(() => setToast(t("dash.centre_saved"))),
            );
          }}
        />
      )}
    </main>
  );
}

function CloseButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => dashboardMenu.set(false)}
      aria-label={label}
      className="px-1 text-[20px] leading-none text-paper-3 hover:text-paper"
    >
      ×
    </button>
  );
}
