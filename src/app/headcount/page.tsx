"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSync, useT } from "@/components/AppRuntime";
import { onQueueChanged } from "@/lib/offlineQueue";
import { getMyRole } from "@/lib/supabase";
import {
  capacityState,
  clockLabel,
  deviceLabel,
  fullLedger,
  recordDelta,
  subscribeHeadcounts,
  totalFrom,
  vulnerabilityBreakdown,
  type LedgerEntry,
  type VulnerabilityBreakdown,
} from "@/lib/headcount";

/**
 * Evacuation centre headcount (PRD §7.8).
 *
 * The two controls are the largest things on the screen and sit in the thumb
 * zone, because they are pressed hundreds of times by someone standing at a
 * door, often with wet hands, while talking to the people they are counting.
 */
export default function HeadcountPage() {
  const { snapshot } = useSync();
  const t = useT();

  const [centreId, setCentreId] = useState<string | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [tags, setTags] = useState<VulnerabilityBreakdown>({
    medical: 0,
    elderly: 0,
    infant: 0,
  });
  const [bulkOpen, setBulkOpen] = useState(false);
  const [isStaff, setIsStaff] = useState<boolean | null>(null);

  const centres = snapshot?.centers ?? [];
  // Derived, not synced into state: the first centre is the default until the
  // volunteer picks another. An effect mirroring this would fire on every
  // snapshot refresh and fight the selection.
  const activeId = centreId ?? centres[0]?.id ?? null;
  const centre = centres.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    // A display hint only. The real boundary is insert_headcounts, which
    // requires staff AND that the recorder is the caller.
    queueMicrotask(() => void getMyRole().then((role) => setIsStaff(role !== "resident")));
  }, []);

  const refresh = useCallback(async () => {
    if (!activeId) return;
    const [rows, breakdown] = await Promise.all([
      fullLedger(activeId),
      vulnerabilityBreakdown(),
    ]);
    setEntries(rows);
    setTags(breakdown);
  }, [activeId]);

  useEffect(() => {
    queueMicrotask(() => void refresh());
    const stopLive = subscribeHeadcounts(() => void refresh());
    const stopQueue = onQueueChanged(() => void refresh());
    return () => {
      stopLive();
      stopQueue();
    };
  }, [refresh]);

  const count = totalFrom(entries);
  const capacity = centre?.capacity ?? 0;
  const state = capacityState(count, capacity);
  const pct = capacity > 0 ? Math.min(100, Math.round((count / capacity) * 100)) : 0;

  async function tap(delta: number) {
    if (!activeId) return;
    // Optimistic: the row is durable locally before this resolves, and the
    // queued-ledger merge means the number moves immediately. If RLS rejects
    // it the row is marked blocked and the sync strip says so.
    await recordDelta(activeId, delta);
    void refresh();
  }

  const tone =
    state === "full" ? "alarm" : state === "filling" ? "caution" : "clear";

  return (
    <>
      <div className="flex items-center gap-3 px-3.5 py-3">
        <Link href="/" aria-label="Back" className="shrink-0">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--color-paper-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="truncate font-display text-base font-extrabold tracking-[0.4px]">
            {centre?.name ?? t("hc.title")}
          </h1>
          {centre && (
            <p className="mono text-[9.5px] tracking-[0.7px] text-paper-3">
              {t("hc.capacity")} {capacity}
            </p>
          )}
        </div>
      </div>

      <main className="flex flex-1 flex-col gap-3 p-3.5">
        {centres.length > 1 && (
          <div className="flex gap-2 overflow-x-auto">
            {centres.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCentreId(c.id)}
                className={`mono shrink-0 rounded-[3px] px-2.5 py-1.5 text-[10px] font-bold tracking-[0.6px] ${
                  c.id === activeId
                    ? "bg-hv text-hv-ink"
                    : "border-[1.5px] border-line-soft bg-ink-800 text-paper-3"
                }`}
              >
                {c.name.toUpperCase()}
              </button>
            ))}
          </div>
        )}

        {/* The count, and what it means against capacity. */}
        <section className="rounded-instrument border-[1.5px] border-line-soft bg-ink-800 p-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <p className="lbl">{t("hc.inside")}</p>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className="mono text-[46px] leading-none font-bold">{count}</span>
                <span className="mono text-[17px] font-semibold text-paper-3">
                  /{capacity}
                </span>
              </p>

              <div className="mt-3 h-[7px] overflow-hidden rounded-[2px] bg-ink-700">
                <div
                  className={`h-full ${
                    tone === "alarm"
                      ? "bg-alarm"
                      : tone === "caution"
                        ? "bg-caution"
                        : "bg-clear"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              <p
                className={`mono mt-2 text-[10.5px] font-bold tracking-[0.6px] ${
                  tone === "alarm"
                    ? "text-alarm"
                    : tone === "caution"
                      ? "text-caution"
                      : "text-clear"
                }`}
              >
                {t("hc.full_pct", { n: pct })} ·{" "}
                {t("hc.space_left", { n: Math.max(0, capacity - count) })}
              </p>
            </div>

            {/* Vulnerability breakdown — staff-only by RLS, so it renders as
                zeros to anyone not entitled rather than erroring. */}
            <div className="flex flex-col justify-between border-l border-line-soft pl-4 text-right">
              {(
                [
                  ["medical", tags.medical, "text-alarm"],
                  ["elderly", tags.elderly, "text-caution"],
                  ["infant", tags.infant, "text-paper"],
                ] as const
              ).map(([key, value, colour]) => (
                <div key={key}>
                  <p className={`mono text-[19px] font-bold ${colour}`}>{value}</p>
                  <p className="lbl text-[8.5px]">{t(`hc.${key}`)}</p>
                </div>
              ))}
            </div>
          </div>

          {state !== "ok" && (
            <p
              className={`mono mt-3 rounded-[3px] border-[1.5px] px-2.5 py-2 text-[10px] font-bold tracking-[0.7px] ${
                state === "full"
                  ? "border-alarm text-alarm"
                  : "border-caution text-caution"
              }`}
            >
              {state === "full" ? t("hc.full") : t("hc.filling")}
            </p>
          )}
        </section>

        <div className="flex items-baseline justify-between">
          <span className="lbl">{t("hc.ledger")}</span>
          {/* The claim the whole design rests on, stated on screen. */}
          <span className="mono text-[9px] tracking-[0.7px] text-paper-3">
            {t("hc.append_only")}
          </span>
        </div>

        <ul className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
          {entries.length === 0 ? (
            <li className="mono text-[11px] text-paper-3">{t("hc.empty")}</li>
          ) : (
            entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-3 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3 py-2.5"
              >
                <span
                  className={`mono w-9 shrink-0 text-[14px] font-bold ${
                    entry.delta > 0 ? "text-clear" : "text-alarm"
                  }`}
                >
                  {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                </span>
                <span className="mono flex-1 truncate text-[12px] text-paper-2">
                  {deviceLabel(entry.recorded_by)}
                </span>
                <span className="mono shrink-0 text-[10px] text-paper-3">
                  {clockLabel(entry.ts)}
                </span>
              </li>
            ))
          )}
        </ul>

        {isStaff === false && (
          <p className="rounded-instrument border-[1.5px] border-caution px-3 py-2.5 text-[12px] leading-snug font-semibold text-caution">
            {t("hc.staff_only")}
          </p>
        )}
      </main>

      {/* Thumb zone. Sized well past the 44px minimum — these are the most
          pressed controls in the product. */}
      <div className="flex gap-2.5 border-t border-line bg-ink-800 p-3.5">
        <button
          type="button"
          onClick={() => tap(-1)}
          className="flex h-[68px] flex-1 items-center justify-center gap-2 rounded-instrument border-[1.5px] border-alarm bg-alarm/10 font-display text-[26px] font-extrabold text-alarm active:bg-alarm/20"
          aria-label="minus one"
        >
          − 1
        </button>
        <button
          type="button"
          onClick={() => tap(1)}
          className="flex h-[68px] flex-[1.6] items-center justify-center gap-2 rounded-instrument bg-clear font-display text-[26px] font-extrabold text-[oklch(0.17_0.05_148)] active:opacity-90"
          aria-label="plus one"
        >
          + 1
        </button>
      </div>

      <div className="px-3.5 pb-3.5">
        {bulkOpen ? (
          <BulkEntry
            onCancel={() => setBulkOpen(false)}
            onSubmit={async (n) => {
              setBulkOpen(false);
              await tap(n);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setBulkOpen(true)}
            className="tap flex w-full items-center justify-center gap-2 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 text-[13px] font-semibold text-paper-2"
          >
            {t("hc.bulk")}
          </button>
        )}
      </div>

    </>
  );
}

/**
 * Bulk entry (FR-8.1).
 *
 * A family of five arriving together is one `+5`. Making a volunteer tap five
 * times invites both miscounts and a queue at the door.
 */
function BulkEntry({
  onSubmit,
  onCancel,
}: {
  onSubmit: (n: number) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState(2);

  return (
    <div className="rounded-instrument border-[1.5px] border-hv bg-ink-800 p-3">
      <p className="lbl mb-2">{t("hc.bulk_hint")}</p>
      <div className="flex items-center gap-2">
        {[2, 3, 4, 5, 6].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setValue(n)}
            className={`mono h-11 flex-1 rounded-[3px] text-[15px] font-bold ${
              value === n
                ? "bg-hv text-hv-ink"
                : "border-[1.5px] border-line-soft text-paper-2"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="tap flex-1 rounded-[3px] border-[1.5px] border-line-soft text-[12.5px] font-semibold text-paper-3"
        >
          ×
        </button>
        <button
          type="button"
          onClick={() => onSubmit(value)}
          className="tap flex-[2] rounded-[3px] bg-clear text-[13px] font-bold text-[oklch(0.17_0.05_148)]"
        >
          + {value}
        </button>
      </div>
    </div>
  );
}
