"use client";

import { useEffect, useState } from "react";
import { useT } from "./AppRuntime";
import { HoldToConfirm } from "./HoldToConfirm";
import {
  blockedWrites,
  discardBlockedWrite,
  flushQueue,
  onQueueChanged,
  retryBlocked,
  type QueuedWrite,
} from "@/lib/offlineQueue";
import { clockLabel } from "@/lib/ledger";

/**
 * What FAILED TO SEND means, and what to do about it: each write the queue
 * gave up on, with TRY AGAIN, or DISCARD (press and hold) when it is no longer
 * wanted. Opened from the strip at the top of every screen.
 */
export function FailedWrites({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [rows, setRows] = useState<QueuedWrite[] | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      void blockedWrites().then((found) => {
        if (live) setRows(found.sort((a, b) => a.createdAt - b.createdAt));
      });
    load();
    const stop = onQueueChanged(load);
    return () => {
      live = false;
      stop();
    };
  }, []);

  /* Nothing left to show: close on its own. */
  useEffect(() => {
    if (rows && rows.length === 0) onClose();
  }, [rows, onClose]);

  // Written as literal calls so scripts/check-translations.mjs can see each key.
  const what = (row: QueuedWrite) =>
    row.table === "rescue_requests"
      ? t("nav.sos")
      : row.table === "hazard_reports"
        ? t("map.legend_hazard")
        : row.table === "water_reports"
          ? t("dash.tab_water")
          : row.table === "profiles"
            ? t("profile.me")
            : t("sync.other");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-paper/30 p-3 pt-16"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("sync.failed_title")}
        className="grid max-h-[80dvh] w-full max-w-md gap-3 overflow-y-auto rounded-instrument border-[1.5px] border-alarm bg-ink-900 p-4 shadow-2xl"
      >
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <p className="lbl text-alarm">{t("sync.failed_title")}</p>
            <p className="mt-1 text-[12px] leading-snug text-paper-2">{t("sync.failed_hint")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("hz.close")}
            className="-mt-1 px-1 text-[22px] leading-none text-paper-3"
          >
            ×
          </button>
        </div>

        {(rows ?? []).map((row) => (
          <div key={row.id} className="grid gap-2 rounded-[3px] border-[1.5px] border-line-soft bg-ink-800 p-3">
            <p className="flex items-baseline gap-2">
              <span className="text-[13.5px] font-bold">{what(row)}</span>
              <span className="mono ml-auto text-[10px] text-paper-3">{clockLabel(new Date(row.createdAt).toISOString())}</span>
            </p>
            {row.lastError && (
              <p className="mono text-[10px] leading-snug break-words text-paper-3">{row.lastError}</p>
            )}
            <button
              type="button"
              onClick={() => void retryBlocked(row.id).then(() => flushQueue())}
              className="tap mono rounded-instrument border-[1.5px] border-hv text-[10.5px] font-bold tracking-[1px] text-hv"
            >
              {t("sync.retry")}
            </button>
            <HoldToConfirm
              label={t("sync.hold_discard")}
              holdingLabel={t("sos.cancelling")}
              tone="alarm"
              onConfirm={() => void discardBlockedWrite(row.id)}
            />
          </div>
        ))}
      </section>
    </div>
  );
}
