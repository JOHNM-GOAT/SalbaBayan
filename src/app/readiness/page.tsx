"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSync, useT } from "@/components/AppRuntime";
import { useMyRole } from "@/components/useMyRole";
import { loadReadiness } from "@/lib/readinessData";
import { loadDocuments, type DocumentsView } from "@/lib/documents";
import {
  overallStatus,
  readyCount,
  type CheckStatus,
  type ReadinessCheck,
} from "@/lib/readiness";

/**
 * Pre-storm readiness and the documentation base (PRD §5.2 F4, §5.6 F13).
 *
 * Both are official-facing and both are deliberately boring: a list of what is
 * configured and a list of what is written down. The value is entirely in
 * being accurate the day *before* a storm, which is why every number here is
 * computed from the same rows the app runs on rather than from a checklist
 * somebody has to remember to tick.
 */
export default function ReadinessPage() {
  const { snapshot } = useSync();
  const t = useT();

  const [checks, setChecks] = useState<ReadinessCheck[] | null>(null);
  const [docs, setDocs] = useState<DocumentsView | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const role = useMyRole();
  const isOfficial = role === null ? null : role === "official";

  const refresh = useCallback(async () => {
    setChecks(await loadReadiness(snapshot));
    setDocs(await loadDocuments());
  }, [snapshot]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  const tone = (status: CheckStatus) =>
    status === "ready"
      ? "text-clear"
      : status === "missing"
        ? "text-alarm"
        : status === "partial"
          ? "text-caution"
          : "text-paper-3";

  const border = (status: CheckStatus) =>
    status === "ready"
      ? "border-clear"
      : status === "missing"
        ? "border-alarm"
        : status === "partial"
          ? "border-caution"
          : "border-line";

  const overall = checks ? overallStatus(checks) : "unknown";

  return (
    <>
      <div className="flex items-center gap-3 px-3.5 py-3">
        <Link href="/" aria-label="Back" className="shrink-0">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--color-paper-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </Link>
        <h1 className="flex-1 font-display text-base font-extrabold tracking-[0.4px]">
          {t("rd.title")}
        </h1>
        {checks && (
          <span className={`mono text-[10px] font-bold tracking-[0.8px] ${tone(overall)}`}>
            {t(`rd.${overall}`)}
          </span>
        )}
      </div>

      <main className="flex flex-1 flex-col gap-4 p-3.5">
        <p className="text-[12.5px] leading-snug text-paper-2">{t("rd.subtitle")}</p>

        {checks && (
          <>
            <div className="flex items-baseline gap-2">
              <span className={`mono text-[34px] leading-none font-bold ${tone(overall)}`}>
                {readyCount(checks)}
              </span>
              <span className="mono text-[15px] font-semibold text-paper-3">
                / {checks.length}
              </span>
            </div>

            {/* Five independent checks read fine as a column on a phone and
                waste most of a laptop screen; they pair up instead. */}
            <ul className="grid gap-2 @2xl:grid-cols-2">
              {checks.map((check) => (
                <li
                  key={check.id}
                  className={`rounded-instrument border-l-4 bg-ink-800 px-3.5 py-3 ${border(check.status)}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex-1 text-[13px] font-semibold">
                      {t(`rd.${check.id}`)}
                    </span>

                    {/* The numbers behind the verdict, so an official can argue
                        with it rather than take a colour on faith. */}
                    <span className={`mono shrink-0 text-[12.5px] font-bold ${tone(check.status)}`}>
                      {check.status === "unknown"
                        ? "—"
                        : `${check.done}/${check.total}`}
                    </span>

                    {check.href && check.status !== "ready" && (
                      <Link
                        href={check.href}
                        className="mono shrink-0 rounded-[3px] border-[1.5px] border-hv px-2 py-1 text-[9px] font-bold tracking-[0.7px] text-hv"
                      >
                        {t("rd.fix")}
                      </Link>
                    )}
                  </div>

                  {/* An unknown must explain itself, or it reads as a bug —
                      and "you are not allowed to see this" must never be left
                      to look like "the barangay has not done it". */}
                  {check.detail && (
                    <p className="mono mt-1.5 text-[9.5px] leading-relaxed text-paper-3">
                      {t(
                        check.detail === "not-permitted"
                          ? "rd.not_permitted"
                          : "rd.no_baseline",
                      )}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="lbl">{t("rd.library")}</span>
            {/* The promise ("Readable with no signal") is only made once it is
                true. When these rows came from the device rather than the
                network, that is what it says instead. */}
            <span className="mono text-[9px] tracking-[0.7px] text-paper-3">
              {docs && !docs.live && docs.rows.length > 0
                ? t("rd.library_cached")
                : t("rd.library_hint")}
            </span>
          </div>

          {(docs?.rows.length ?? 0) === 0 ? (
            /*
             * Three reasons a list can be empty, and they are not the same
             * thing. Saying "Officials only" to an official whose phone simply
             * has no signal tells them they lack a permission they hold.
             */
            <p className="mono text-[11px] leading-relaxed text-paper-3">
              {docs && !docs.live
                ? t("rd.library_offline")
                : isOfficial === false
                  ? t("rd.official_only")
                  : t("rd.library_empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {(docs?.rows ?? []).map((doc) => (
                <li
                  key={doc.filename}
                  className="overflow-hidden rounded-instrument border-[1.5px] border-line-soft bg-ink-800"
                >
                  <button
                    type="button"
                    onClick={() => setOpen(open === doc.filename ? null : doc.filename)}
                    className="tap flex w-full items-center gap-3 px-3.5 text-left"
                    aria-expanded={open === doc.filename}
                  >
                    <span className="flex-1 text-[13px] font-semibold">{doc.title}</span>
                    <span className="mono shrink-0 text-[9.5px] text-paper-3">
                      {doc.filename}
                    </span>
                  </button>

                  {open === doc.filename && (
                    /*
                     * Rendered as pre-wrapped text rather than parsed markdown.
                     * A markdown renderer is weight in a bundle that must boot
                     * offline, and the documents here are read for their
                     * content, not their formatting.
                     */
                    <pre className="max-h-80 overflow-auto border-t border-line-soft px-3.5 py-3 text-[11.5px] leading-relaxed whitespace-pre-wrap text-paper-2 @2xl:max-h-[32rem]">
                      {doc.content}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
