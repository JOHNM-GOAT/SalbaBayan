"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSync, useT } from "@/components/AppRuntime";
import { QrScanner } from "@/components/QrScanner";
import { onQueueChanged } from "@/lib/offlineQueue";
import { getMyRole } from "@/lib/supabase";
import {
  allCheckins,
  isPriority,
  lookupToken,
  recordCheckin,
  residentsByIds,
  STATUSES,
  TAG_ORDER,
  type CheckinRecord,
  type CheckinStatus,
  type LookupResult,
  type Resident,
} from "@/lib/checkin";

/**
 * Resident check-in (PRD §7.9).
 *
 * The camera and the text box are peers, not a feature and its fallback. Both
 * hand the same string to `lookupToken`, and everything after that point is
 * one path — which is how the §7.9 criterion ("manual entry produces the same
 * result") is satisfied by construction rather than by testing two flows and
 * hoping they stay aligned.
 */
export default function CheckinPage() {
  const { snapshot } = useSync();
  const t = useT();

  const [result, setResult] = useState<LookupResult | null>(null);
  const [manual, setManual] = useState("");
  const [logged, setLogged] = useState<string | null>(null);
  const [records, setRecords] = useState<CheckinRecord[]>([]);
  const [people, setPeople] = useState<Map<string, Resident>>(new Map());
  const [isStaff, setIsStaff] = useState<boolean | null>(null);

  const purokName = (id: string) =>
    snapshot?.puroks.find((p) => p.id === id)?.name ?? "";

  const refresh = useCallback(async () => {
    const rows = await allCheckins();
    setRecords(rows);
    setPeople(await residentsByIds([...new Set(rows.map((r) => r.resident_id))]));
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
      void getMyRole().then((role) => setIsStaff(role !== "resident"));
    });
    const stopQueue = onQueueChanged(() => void refresh());
    return stopQueue;
  }, [refresh]);

  /** The one entry point. Both the camera and the keyboard call exactly this. */
  const resolve = useCallback(async (raw: string) => {
    setLogged(null);
    setResult(await lookupToken(raw));
  }, []);

  async function log(status: CheckinStatus) {
    if (!result?.found) return;
    await recordCheckin(result.resident.id, status);
    setLogged(result.resident.name);
    setResult(null);
    setManual("");
    void refresh();
  }

  return (
    <>
      <div className="flex items-center gap-3 px-3.5 py-3">
        <Link href="/" aria-label="Back" className="shrink-0">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--color-paper-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </Link>
        <h1 className="flex-1 font-display text-base font-extrabold tracking-[0.4px]">
          {t("qr.title")}
        </h1>
        {isStaff && (
          <span className="mono rounded-[3px] border-[1.5px] border-hv px-2 py-1 text-[9px] font-bold tracking-[0.8px] text-hv">
            VOLUNTEER
          </span>
        )}
      </div>

      <main className="flex flex-1 flex-col gap-3.5 p-3.5">
        <QrScanner onDecode={resolve} />

        {/* Always present, never revealed only on failure. A volunteer whose
            camera is failing in the rain should not have to discover that a
            manual option exists. */}
        <section>
          <label htmlFor="token" className="lbl mb-2 block">
            {t("qr.manual")}
          </label>
          <div className="flex gap-2">
            <input
              id="token"
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void resolve(manual);
              }}
              placeholder={t("qr.manual_hint")}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="tap mono flex-1 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3 text-[14px] tracking-[1px] text-paper placeholder:text-paper-3 focus:border-hv focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void resolve(manual)}
              disabled={!manual.trim()}
              className="tap rounded-instrument bg-hv px-4 text-[13px] font-bold text-hv-ink disabled:opacity-35"
            >
              {t("qr.find")}
            </button>
          </div>
        </section>

        {result?.found === false && (
          <p
            className="rounded-instrument border-[1.5px] border-caution px-3 py-2.5 text-[12.5px] leading-snug font-semibold text-caution"
            role="status"
          >
            {t("qr.not_found", { n: result.token })}
          </p>
        )}

        {logged && (
          <p
            className="rounded-instrument border-[1.5px] border-clear px-3 py-2.5 text-[12.5px] font-semibold text-clear"
            role="status"
          >
            {t("qr.logged", { n: logged })}
          </p>
        )}

        {result?.found && (
          <>
            {/* The card. Tags are the reason this screen exists — a volunteer
                needs to see "medical" before they finish reading the name. */}
            <section
              className={`rounded-instrument border-l-4 bg-ink-800 p-3.5 ${
                isPriority(result.resident) ? "border-alarm" : "border-clear"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-display text-[20px] font-extrabold tracking-[0.3px]">
                    {result.resident.name.toUpperCase()}
                  </h2>
                  <p className="mono mt-1 text-[10px] tracking-[0.7px] text-paper-3">
                    {purokName(result.resident.purok_id).toUpperCase()} ·{" "}
                    {result.resident.qr_token}
                  </p>
                </div>
                {isPriority(result.resident) && (
                  <span className="mono shrink-0 text-[10px] font-bold tracking-[0.8px] text-alarm">
                    {t("qr.priority")}
                  </span>
                )}
              </div>

              {result.resident.vulnerability_tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {TAG_ORDER.filter((tag) =>
                    result.resident.vulnerability_tags.includes(tag),
                  ).map((tag) => (
                    <span
                      key={tag}
                      className={`mono rounded-[3px] border-[1.5px] px-2.5 py-1.5 text-[10.5px] font-bold tracking-[0.8px] ${
                        tag === "medical"
                          ? "border-alarm text-alarm"
                          : tag === "elderly"
                            ? "border-caution text-caution"
                            : "border-paper-2 text-paper-2"
                      }`}
                    >
                      {t(`tag.${tag}`)}
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section>
              <p className="lbl mb-2">{t("qr.log_status")}</p>
              <div className="grid grid-cols-3 gap-2">
                {STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => log(status)}
                    className={`flex h-[74px] flex-col items-center justify-center gap-2 rounded-instrument border-[1.5px] ${
                      status === "checked_in"
                        ? "border-clear bg-clear/10 text-clear"
                        : status === "needs_help"
                          ? "border-alarm bg-alarm/10 text-alarm"
                          : "border-line-soft bg-ink-800 text-paper-2"
                    }`}
                  >
                    <StatusIcon status={status} />
                    <span className="mono text-[9.5px] font-bold tracking-[0.7px]">
                      {t(`qr.${status}`)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        <section className="flex flex-1 flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="lbl">{t("qr.recent")}</span>
            <span className="mono text-[9.5px] tracking-[0.7px] text-paper-3">
              {t("qr.today", { n: records.length })}
            </span>
          </div>

          {records.length === 0 ? (
            <p className="mono text-[11px] text-paper-3">
              {isStaff === false ? t("qr.staff_only") : t("qr.none")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {records.map((record) => {
                const person = people.get(record.resident_id);
                return (
                  <li
                    key={record.id}
                    className="flex items-center gap-3 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3 py-2.5"
                  >
                    <span
                      className={`size-2 shrink-0 rounded-[1px] ${
                        record.status === "needs_help"
                          ? "bg-alarm"
                          : record.status === "evacuated"
                            ? "bg-caution"
                            : "bg-clear"
                      }`}
                      aria-hidden
                    />
                    <span className="flex-1 truncate text-[13px] font-semibold">
                      {person?.name ?? "—"}
                    </span>
                    <span className="mono shrink-0 text-[10px] text-paper-3">
                      {new Date(record.ts)
                        .toLocaleTimeString("en-PH", {
                          hour: "numeric",
                          minute: "2-digit",
                          hour12: true,
                        })
                        .toUpperCase()}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

function StatusIcon({ status }: { status: CheckinStatus }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.3,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (status === "checked_in") return <svg {...common}><path d="M20 6L9 17l-5-5" /></svg>;
  if (status === "evacuated") return <svg {...common}><path d="M5 12h13" /><path d="M12 5l7 7-7 7" /></svg>;
  return (
    <svg {...common}>
      <path d="M12 9v5" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}
