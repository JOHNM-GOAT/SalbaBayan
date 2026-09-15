"use client";

import { useEffect, useState } from "react";
import { useT } from "./AppRuntime";

/**
 * Placeholders for content that has been asked for but has not arrived.
 *
 * The problem these solve is specific, and it is a truthfulness problem rather
 * than a polish one. Every feed in this app initialises to an empty array and
 * fills in after an effect resolves, so on the first frame the report screen
 * renders "Nothing reported", the responder queue renders "Nobody needs help",
 * and the headcount renders 0. Each of those is a confident claim about the
 * barangay, made before the device has looked. The advisory home already got
 * this right — it distinguishes "the cache has not been read yet" from "this
 * device has never reached the server" — and these let every other screen draw
 * the same line.
 *
 * Three rules follow from where this runs, and all three are the opposite of
 * what a skeleton usually does:
 *
 * 1. THEY DO NOT ANIMATE. A pulse or a shimmer is a continuous repaint, and
 *    this is read on a phone whose battery may have to last another two days.
 *    The shape of the layout is already the signal; motion adds cost and no
 *    information. It also means there is no `prefers-reduced-motion` branch to
 *    get wrong.
 *
 * 2. THEY EXPIRE. A skeleton says "this is coming". Offline, or on a tower that
 *    is up and answering nothing, it is not coming — and a placeholder that
 *    sits there indefinitely is exactly the kind of quiet lie the always-visible
 *    sync strip exists to prevent. After `SKELETON_CAP_MS` the screen gives way
 *    to whatever it honestly has to say: no cache, nothing reported, zero.
 *
 * 3. THEY ARE FIRST-LOAD ONLY. A refresh that replaces data already on screen
 *    must never blank it back to grey blocks. Cached content, however old, beats
 *    a placeholder — the age is shown honestly in the header either way.
 */

/**
 * How long a placeholder may claim something is on its way.
 *
 * Three seconds is the same budget `NetworkFirst` gives a document fetch in the
 * Service Worker (src/app/sw.ts), and for the same reason: past it, a slow
 * tower is indistinguishable from a dead one, and the honest answer is better
 * than a hopeful one.
 */
export const SKELETON_CAP_MS = 3_000;

/**
 * Whether to show placeholders instead of content.
 *
 * `settled` is "the first read has resolved", not "there is data" — a read that
 * came back empty IS settled, and its screen should say so rather than keep
 * waiting. Pass a value that goes true once and stays true; that is what makes
 * this first-load only.
 */
export function useSkeletonGate(
  settled: boolean,
  capMs = SKELETON_CAP_MS,
): boolean {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    // Settled first: no timer to start, and `expired` stays false so a later
    // refetch cannot retroactively look like a timeout.
    if (settled) return;

    const timer = window.setTimeout(() => setExpired(true), capMs);
    return () => window.clearTimeout(timer);
  }, [settled, capMs]);

  return !settled && !expired;
}

/**
 * One placeholder block.
 *
 * `ink-700` against the `ink-800` card it usually sits in — one step of
 * separation, deliberately not more. These are furniture, not content, and a
 * darker block would pull the eye toward the part of the screen that is empty.
 */
export function Skeleton({
  className = "",
  width,
}: {
  className?: string;
  width?: string;
}) {
  return (
    <span
      aria-hidden
      style={width ? { width } : undefined}
      className={`block shrink-0 rounded-[3px] bg-ink-700 ${className}`}
    />
  );
}

/**
 * The region wrapper. Announces once, rather than letting a screen reader walk
 * a dozen meaningless blocks.
 *
 * `aria-busy` is what tells assistive technology that this subtree is
 * provisional; the blocks themselves are `aria-hidden` so there is nothing
 * inside it to read. The visible-to-nobody label is what a screen reader
 * actually announces.
 */
export function SkeletonRegion({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-2">
      <span className="sr-only">{t("ui.loading")}</span>
      {children}
    </div>
  );
}

/**
 * A feed of report-shaped rows.
 *
 * Matched to `HazardRow`'s geometry — the 4px severity rail, the label and chip
 * on the first line, the description on the second — so the real rows land in
 * the same places the blocks occupied and the list does not jump when they
 * arrive. That is the whole practical benefit of a skeleton over a spinner, and
 * it only holds if the shapes actually agree.
 */
export function SkeletonFeed({ rows = 3 }: { rows?: number }) {
  return (
    <SkeletonRegion>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="rounded-instrument border-l-4 border-line-soft bg-ink-800 px-3 py-2.5"
        >
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-[11px]" width="64px" />
            <Skeleton className="h-[13px]" width="72px" />
            <Skeleton className="ml-auto h-[10px]" width="38px" />
          </div>
          <Skeleton
            className="mt-2 h-[12px]"
            // Uneven widths, because a column of identical bars reads as a
            // pattern rather than as text that has not loaded.
            width={["82%", "64%", "73%"][i % 3]}
          />
        </div>
      ))}
    </SkeletonRegion>
  );
}

/**
 * A list of plain single-line rows — the headcount ledger and the rescue queue,
 * which are both "one fact per line" rather than a card with a description.
 */
export function SkeletonLines({ rows = 4 }: { rows?: number }) {
  return (
    <SkeletonRegion>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3 py-2.5"
        >
          <Skeleton className="h-[11px]" width="56px" />
          {/* The varying width goes on the block, not on the flex child — a
              `flex-1` block has `flex-basis: 0` and grows to fill regardless of
              any width set on it, so every row would come out identical. */}
          <span className="min-w-0 flex-1">
            <Skeleton
              className="h-[12px]"
              width={["70%", "52%", "63%", "45%"][i % 4]}
            />
          </span>
          <Skeleton className="h-[10px]" width="34px" />
        </div>
      ))}
    </SkeletonRegion>
  );
}
