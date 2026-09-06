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

            {/* The SOS control is the largest, reddest thing below the
                instruction, and it is never more than one tap from the screen
                the app opens to. */}
            <Link
              href="/sos"
              className="tap mt-1 flex items-center justify-center gap-2.5 rounded-instrument bg-alarm py-3 font-display text-[16px] font-extrabold tracking-[0.5px] text-[oklch(0.99_0.01_28)]"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 2v3" />
                <path d="M6 21v-6a6 6 0 0 1 12 0v6z" />
                <path d="M4 21h16" />
              </svg>
              SOS
            </Link>

            <div className="mt-1 flex gap-2">
              <Link
                href="/map"
                className="tap mono flex flex-1 items-center justify-center rounded-instrument border-[1.5px] border-hv text-[10px] font-bold tracking-[1px] text-hv"
              >
                MAPA
              </Link>
              <Link
                href="/report"
                className="tap mono flex flex-1 items-center justify-center rounded-instrument border-[1.5px] border-line-soft text-[10px] font-bold tracking-[1px] text-paper-3 transition-colors hover:text-paper"
              >
                MAG-ULAT
              </Link>
              <Link
                href="/coverage"
                className="tap mono flex flex-1 items-center justify-center rounded-instrument border-[1.5px] border-line-soft text-[10px] font-bold tracking-[1px] text-paper-3 transition-colors hover:text-paper"
              >
                COVERAGE
              </Link>
              <Link
                href="/headcount"
                className="tap mono flex flex-1 items-center justify-center rounded-instrument border-[1.5px] border-line-soft text-[10px] font-bold tracking-[1px] text-paper-3 transition-colors hover:text-paper"
              >
                BILANG
              </Link>
              <Link
                href="/checkin"
                className="tap mono flex flex-1 items-center justify-center rounded-instrument border-[1.5px] border-line-soft text-[10px] font-bold tracking-[1px] text-paper-3 transition-colors hover:text-paper"
              >
                CHECK-IN
              </Link>
              <Link
                href="/readiness"
                className="tap mono flex flex-1 items-center justify-center rounded-instrument border-[1.5px] border-line-soft text-[10px] font-bold tracking-[1px] text-paper-3 transition-colors hover:text-paper"
              >
                HANDA
              </Link>
              <Link
                href="/responder"
                className="tap mono flex flex-1 items-center justify-center rounded-instrument border-[1.5px] border-line-soft text-[10px] font-bold tracking-[1px] text-paper-3 transition-colors hover:text-paper"
              >
                RESPONDER
              </Link>
            </div>
          </>
        )}
      </main>
    </>
  );
}
