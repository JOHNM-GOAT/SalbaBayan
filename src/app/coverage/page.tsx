"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSync, useT } from "@/components/AppRuntime";
import { AppHeader } from "@/components/AppHeader";
import { buildCoverage } from "@/lib/advisory";
import { signalStyle } from "@/lib/signal";

/**
 * Purok x Signal coverage matrix (PRD §7.1, FR-2.6).
 *
 * The point of this screen is to be looked at *before* a storm. Every gap it
 * shows is a resident who would open the app mid-typhoon and find no
 * instruction for their street. Finding one here is a configuration task;
 * finding it during an event is a failure.
 *
 * Rendered from the same cached snapshot as the advisory, so it is legible
 * offline too — an official checking readiness in a barangay hall with poor
 * signal is exactly the expected case.
 */
export default function CoveragePage() {
  const { snapshot } = useSync();
  const t = useT();

  const coverage = useMemo(
    () => (snapshot ? buildCoverage(snapshot) : null),
    [snapshot],
  );

  return (
    <div className="flex min-h-dvh flex-col bg-ink-900">
      <AppHeader />

      <main className="flex flex-1 flex-col gap-3 p-3.5">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-[15px] font-extrabold tracking-[0.5px]">
            {t("ui.coverage")}
          </h1>
          <Link
            href="/"
            className="mono text-[10px] font-bold tracking-[0.8px] text-hv"
          >
            ← HOME
          </Link>
        </div>

        {!coverage ? (
          <p className="mono text-[11px] text-paper-3">...</p>
        ) : (
          <>
            <p
              className={`mono text-[11px] font-semibold tracking-[0.5px] ${
                coverage.totalGaps > 0 ? "text-caution" : "text-clear"
              }`}
            >
              {coverage.totalGaps > 0
                ? t("ui.coverage_gaps", { n: coverage.totalGaps })
                : t("ui.coverage_complete")}
            </p>

            {/* Wide content scrolls inside its own container rather than
                pushing the page sideways. */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr>
                    <th className="lbl pb-2 pr-3 font-normal">PUROK</th>
                    {[1, 2, 3, 4, 5].map((level) => (
                      <th
                        key={level}
                        className="lbl pb-2 text-center font-normal"
                      >
                        {level}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {coverage.rows.map((row) => (
                    <tr key={row.purok.id} className="border-t border-line-soft">
                      <td className="py-2 pr-3 text-[12.5px] font-semibold whitespace-nowrap">
                        {row.purok.name}
                      </td>
                      {row.cells.map((cell) => {
                        const style = signalStyle(cell.signalLevel);
                        return (
                          <td key={cell.signalLevel} className="py-2 text-center">
                            {cell.configured ? (
                              /* Filled with the severity colour of the level
                                 it covers, so the matrix reads as the same
                                 ramp used everywhere else. */
                              <span
                                className={`inline-block size-4 rounded-[2px] ${style.bg}`}
                                title={`Signal ${cell.signalLevel}: configured`}
                              />
                            ) : (
                              /* A gap is drawn as an outline, not a colour:
                                 absence should look like absence. */
                              <span
                                className="inline-block size-4 rounded-[2px] border-[1.5px] border-dashed border-caution"
                                title={`Signal ${cell.signalLevel}: NO PROTOCOL`}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
