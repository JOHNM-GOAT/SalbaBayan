"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSync } from "@/components/AppRuntime";
import { PurokBar } from "@/components/PurokBar";
import { SignalPlacard } from "@/components/SignalPlacard";
import { LeaveByStrip } from "@/components/LeaveByStrip";
import { ActionCard } from "@/components/ActionCard";
import { deriveAdvisory } from "@/lib/advisory";

/**
 * Advisory home (PRD §7.1, §7.2 — Phase 1).
 *
 * Everything below the header is derived from one cached snapshot, so changing
 * language or Purok re-renders without a fetch and therefore without a network.
 */
export default function Home() {
  const { snapshot, purokId, language, loading } = useSync();

  const advisory = useMemo(
    () =>
      snapshot && purokId
        ? deriveAdvisory(snapshot, purokId, language)
        : null,
    [snapshot, purokId, language],
  );

  return (
    <>
      <PurokBar />

      <main className="flex flex-1 flex-col gap-2.5 p-3.5">
        {!snapshot ? (
          /*
           * Two genuinely different states, and conflating them would be a
           * lie. `loading` means the cache has not been read yet. Once it has
           * and there is still nothing, this device has never reached the
           * server — so it is told that plainly instead of spinning forever.
           */
          <p className="mono mt-8 text-center text-[11px] leading-relaxed tracking-[0.6px] text-paper-3">
            {loading
              ? "..."
              : "WALANG NAKA-CACHE NA ADVISORY. KAILANGAN MUNA NG KONEKSYON."}
          </p>
        ) : (
          <>
            <SignalPlacard />

            {advisory?.evacuateBy && (
              <LeaveByStrip
                deadline={advisory.evacuateBy}
                signalLevel={advisory.signalLevel}
              />
            )}

            {advisory && <ActionCard advisory={advisory} />}

            <Link
              href="/coverage"
              className="tap mono mt-1 flex items-center justify-center rounded-instrument border-[1.5px] border-line-soft text-[10px] font-bold tracking-[1px] text-paper-3 transition-colors hover:text-paper"
            >
              PROTOCOL COVERAGE
            </Link>
          </>
        )}
      </main>
    </>
  );
}
