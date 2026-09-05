"use client";

import { useSync } from "./AppRuntime";

function formatAge(ms: number | null): string {
  if (ms === null) return "HINDI PA NAKA-SYNC";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "NAKA-CACHE NGAYON";
  if (mins < 60) return `NAKA-CACHE ${mins} MIN`;
  const hours = Math.floor(mins / 60);
  return `NAKA-CACHE ${hours} ORAS`;
}

/**
 * The persistent connection strip (PRD §6, FR-3.5).
 *
 * Renders on every screen. It states what is true rather than what is
 * reassuring: when writes are sitting on the device unsent, it says so.
 */
export function SyncStrip() {
  const { online, queued, cacheAgeMs } = useSync();

  const dot = !online ? "bg-caution" : queued > 0 ? "bg-caution" : "bg-clear";

  return (
    <div className="flex h-[25px] shrink-0 items-center gap-2 border-b border-line-soft bg-ink-900 px-3.5">
      <span className={`size-1.5 shrink-0 ${dot}`} aria-hidden />
      <span className="mono text-[10px] font-semibold tracking-[0.9px] text-paper-3">
        {online ? formatAge(cacheAgeMs) : "OFFLINE"}
        {queued > 0 && ` · ${queued} NAKA-QUEUE`}
      </span>
    </div>
  );
}
