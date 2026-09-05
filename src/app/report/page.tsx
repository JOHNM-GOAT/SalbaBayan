"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSync, useT } from "@/components/AppRuntime";
import { onQueueChanged } from "@/lib/offlineQueue";
import { DepthPicker } from "@/components/DepthPicker";
import {
  agoLabel,
  DEPTH_TONE,
  allWaterReports,
  submitWaterReport,
  subscribeWaterReports,
  type Depth,
  type WaterReport,
} from "@/lib/water";

/**
 * Water-level reporting (PRD §7.6).
 *
 * One decision, one optional detail, one button. The person filling this in is
 * standing in water, so every field that is not strictly needed has been left
 * out: no numeric depth, no category picker (this screen is flooding — hazard
 * categories arrive in Phase 6), no required text.
 */
export default function ReportPage() {
  const { purokId, snapshot, online } = useSync();
  const t = useT();

  const [depth, setDepth] = useState<Depth | null>(null);
  const [label, setLabel] = useState("");
  const [outcome, setOutcome] = useState<"sent" | "queued" | null>(null);
  const [reports, setReports] = useState<WaterReport[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const purokName = (id: string) =>
    snapshot?.puroks.find((p) => p.id === id)?.name ?? "";

  const refresh = useCallback(async () => {
    // Merged view: server rows plus anything still queued locally, so a
    // reporter always sees their own report immediately.
    setReports(await allWaterReports());
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refresh());
    // Realtime, not polling: the §7.6 criterion is that a report reaches
    // another connected device within five seconds without a refresh.
    const stop = subscribeWaterReports(() => void refresh());
    const stopQueue = onQueueChanged(() => void refresh());
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      stop();
      stopQueue();
      window.clearInterval(tick);
    };
  }, [refresh]);

  async function onSubmit() {
    if (!depth || !purokId) return;

    await submitWaterReport({ purokId, depth, locationLabel: label });

    /*
     * `enqueueWrite` returns as soon as the report is durable on the device,
     * never "delivered" — so the confirmation is worded by connectivity rather
     * than by a delivery flag that does not exist. Both outcomes are honest;
     * neither claims the barangay has seen it yet.
     */
    setOutcome(online ? "sent" : "queued");
    setDepth(null);
    setLabel("");
    void refresh();
  }

  return (
    <>
      <div className="flex items-center gap-3 px-3.5 py-3">
        <Link href="/" aria-label="Back" className="shrink-0">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--color-paper-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </Link>
        <h1 className="flex-1 font-display text-base font-extrabold tracking-[0.4px]">
          {t("water.title")}
        </h1>
        <span className="mono text-[10px] tracking-[0.7px] text-paper-3">
          {purokId ? purokName(purokId).toUpperCase() : ""}
        </span>
      </div>

      <main className="flex flex-1 flex-col gap-4 p-3.5">
        <section>
          <p className="lbl mb-2">{t("water.how_high")}</p>
          <DepthPicker value={depth} onChange={setDepth} />
        </section>

        <section>
          <label htmlFor="where" className="lbl mb-2 block">
            {t("water.where")}
          </label>
          {/* Optional, and a plain text box rather than a map pin: naming the
              street is faster than placing a marker, and a landmark is what a
              neighbour would actually say. */}
          <input
            id="where"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={t("water.where_hint")}
            className="tap w-full rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3 text-[13.5px] text-paper placeholder:text-paper-3 focus:border-hv focus:outline-none"
          />
        </section>

        <button
          type="button"
          onClick={onSubmit}
          disabled={!depth}
          className="tap flex items-center justify-center rounded-instrument bg-hv py-3 font-display text-[15.5px] font-extrabold tracking-[0.3px] text-hv-ink disabled:opacity-35"
        >
          {t("water.submit")}
        </button>

        <p className="mono -mt-2 text-center text-[9.5px] tracking-[0.7px] text-paper-3">
          {depth ? t("water.visible") : t("water.pick_depth")}
        </p>

        {outcome && (
          <p
            className={`rounded-instrument border-[1.5px] px-3 py-2.5 text-[12.5px] leading-snug font-semibold ${
              outcome === "sent"
                ? "border-clear text-clear"
                : "border-caution text-caution"
            }`}
            role="status"
          >
            {outcome === "sent" ? t("water.sent") : t("water.queued")}
          </p>
        )}

        <section className="flex flex-1 flex-col gap-2">
          <p className="lbl">{t("water.recent")}</p>

          {reports.length === 0 ? (
            <p className="mono text-[11px] text-paper-3">{t("water.none")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {reports.map((report) => (
                <li
                  key={report.id}
                  className="flex items-center gap-3 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3 py-2.5"
                >
                  <span
                    className={`mono shrink-0 text-[11px] font-bold tracking-[0.7px] ${DEPTH_TONE[report.level_category]}`}
                  >
                    {t(`water.${report.level_category}`)}
                  </span>
                  <span className="flex-1 truncate text-[12.5px]">
                    {report.location_label ?? purokName(report.purok_id)}
                  </span>
                  <span className="mono shrink-0 text-[10px] text-paper-3">
                    {agoLabel(report.ts, now)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
