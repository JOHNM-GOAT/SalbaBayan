"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSync, useT } from "@/components/AppRuntime";
import { PurokBar } from "@/components/PurokBar";
import { SignalPlacard } from "@/components/SignalPlacard";
import { LeaveByStrip } from "@/components/LeaveByStrip";
import { ActionCard } from "@/components/ActionCard";
import { deriveAdvisory } from "@/lib/advisory";
import { Skeleton, SkeletonRegion, useSkeletonGate } from "@/components/Skeleton";

/**
 * Advisory home (PRD §7.1, §7.2 — Phase 1).
 *
 * Everything below the header is derived from one cached snapshot, so changing
 * language or Purok re-renders without a fetch and therefore without a network.
 */
export default function Home() {
  const { snapshot, purokId, language, loading } = useSync();
  const t = useT();

  const advisory = useMemo(
    () =>
      snapshot && purokId
        ? deriveAdvisory(snapshot, purokId, language)
        : null,
    [snapshot, purokId, language],
  );

  /* `loading` is "the cache has not been read yet", so it settling is what ends
     the wait. The gate adds the ceiling: past it, say what is known. */
  const waiting = useSkeletonGate(!loading);

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
           *
           * The waiting half used to be a literal "...", which said nothing
           * about what was coming and left the screen to jump from one line of
           * text to a full advisory. The placeholder below holds the shape of
           * the placard, the leave-by strip and the action card, so the
           * instruction lands where the eye is already looking. It expires on
           * its own — see useSkeletonGate — so a device that never reaches the
           * server still ends up at the honest message rather than at grey
           * blocks forever.
           */
          waiting ? (
            <SkeletonRegion>
              <Skeleton className="h-[132px] rounded-instrument" />
              <Skeleton className="h-[42px] rounded-instrument" />
              <Skeleton className="h-[96px] rounded-instrument" />
            </SkeletonRegion>
          ) : (
            <p className="mono mt-8 text-center text-[11px] leading-relaxed tracking-[0.6px] text-paper-3">
              {t("ui.no_cache")}
            </p>
          )
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

          </>
        )}
      </main>
    </>
  );
}
