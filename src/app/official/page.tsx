"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSync, useT } from "@/components/AppRuntime";
import { SignalPlacard } from "@/components/SignalPlacard";
import { buildCoverage } from "@/lib/advisory";
import { loadReadiness } from "@/lib/readinessData";
import { overallStatus, readyCount, type ReadinessCheck } from "@/lib/readiness";

/**
 * Official home (PRD §4: "configures protocols and translations before the
 * season, sets the current signal level ... monitors the readiness dashboard,
 * oversees rescue dispatch").
 *
 * The two questions an official opens their phone to answer are "is the
 * barangay configured" and "is anyone waiting", so this screen answers exactly
 * those and then gets out of the way. Both numbers are the same ones their own
 * screens compute — readiness from `loadReadiness`, gaps from `buildCoverage`
 * — rather than a second, separately-derived summary that could disagree with
 * the page it links to.
 */
export default function OfficialHome() {
  const { snapshot } = useSync();
  const t = useT();

  const [checks, setChecks] = useState<ReadinessCheck[] | null>(null);

  /*
   * `live` guards the setState. The snapshot arrives twice on a normal visit —
   * once from the IndexedDB cache, once from the network refresh — so two
   * loads overlap, and without this the slower first one can land last and
   * leave stale figures on screen.
   */
  useEffect(() => {
    let live = true;
    void loadReadiness(snapshot).then((next) => {
      if (live) setChecks(next);
    });
    return () => {
      live = false;
    };
  }, [snapshot]);

  const coverage = snapshot ? buildCoverage(snapshot) : null;
  const overall = checks ? overallStatus(checks) : "unknown";

  const tone =
    overall === "ready"
      ? "text-clear"
      : overall === "missing"
        ? "text-alarm"
        : overall === "partial"
          ? "text-caution"
          : "text-paper-3";

  return (
    <main className="flex flex-1 flex-col gap-2.5 p-3.5">
      {!snapshot ? (
        <p className="mono mt-8 text-center text-[11px] leading-relaxed tracking-[0.6px] text-paper-3">
          {t("ui.no_cache")}
        </p>
      ) : (
        <>
          <SignalPlacard />

          <div className="grid gap-2 @xl:grid-cols-2">
            <Link
              href="/readiness"
              className="rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3.5 py-3"
            >
              <p className="lbl">{t("off.readiness")}</p>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className={`mono text-[30px] leading-none font-bold ${tone}`}>
                  {checks ? readyCount(checks) : "—"}
                </span>
                {checks && (
                  <span className="mono text-[14px] font-semibold text-paper-3">
                    /{checks.length}
                  </span>
                )}
              </p>
            </Link>

            <Link
              href="/coverage"
              className="rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3.5 py-3"
            >
              <p className="lbl">{t("off.gaps")}</p>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span
                  className={`mono text-[30px] leading-none font-bold ${
                    coverage && coverage.totalGaps > 0 ? "text-caution" : "text-clear"
                  }`}
                >
                  {coverage?.totalGaps ?? "—"}
                </span>
                <span className="mono text-[14px] font-semibold text-paper-3">
                  /{(coverage?.rows.length ?? 0) * 5}
                </span>
              </p>
            </Link>
          </div>

          <div className="mt-1 grid grid-cols-2 gap-2">
            <Link
              href="/responder"
              className="tap mono flex items-center justify-center rounded-instrument border-[1.5px] border-hv text-[10px] font-bold tracking-[1px] text-hv"
            >
              {t("nav.rescue")}
            </Link>
            <Link
              href="/headcount"
              className="tap mono flex items-center justify-center rounded-instrument border-[1.5px] border-line-soft text-[10px] font-bold tracking-[1px] text-paper-3 transition-colors hover:text-paper"
            >
              {t("nav.count")}
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
