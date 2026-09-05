"use client";

import { useSync, useT } from "./AppRuntime";

/**
 * The persistent connection strip (PRD §6, FR-3.5).
 *
 * Renders on every screen. It states what is true rather than what is
 * reassuring: when writes are sitting on the device unsent, it says so, and
 * when the cached advisory is three days old it says that too.
 *
 * The age it reports comes from the advisory snapshot's `fetchedAt`, which is
 * only ever set by a genuine network read — see the NetworkOnly note in
 * src/app/sw.ts for why that matters.
 */
export function SyncStrip() {
  const { online, queued, cacheAgeMs } = useSync();
  const t = useT();

  function age(): string {
    if (cacheAgeMs === null) return t("ui.never_synced");
    const mins = Math.floor(cacheAgeMs / 60_000);
    if (mins < 1) return t("ui.cached_now");
    if (mins < 60) return t("ui.cached_min", { n: mins });
    return t("ui.cached_hour", { n: Math.floor(mins / 60) });
  }

  const dot = !online || queued > 0 ? "bg-caution" : "bg-clear";

  /*
   * Offline shows the age ALONGSIDE the offline state, not instead of it.
   *
   * An earlier version replaced the age with "OFFLINE", which had it exactly
   * backwards: being offline is precisely when a resident needs to know
   * whether the instruction on screen is ten minutes or three days old. The
   * §7.3 acceptance criterion says so outright — "in airplane mode ... the
   * cached advisory shows its age".
   */
  const parts = [
    !online ? t("ui.offline") : null,
    age(),
    queued > 0 ? t("ui.queued", { n: queued }) : null,
  ].filter(Boolean);

  return (
    <div className="flex h-[25px] shrink-0 items-center gap-2 border-b border-line-soft bg-ink-900 px-3.5">
      <span className={`size-1.5 shrink-0 ${dot}`} aria-hidden />
      <span className="mono text-[10px] font-semibold tracking-[0.9px] text-paper-3">
        {parts.join(" · ")}
      </span>
    </div>
  );
}
