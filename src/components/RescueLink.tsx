"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSync, useT } from "./AppRuntime";
import { activeQueue, subscribeRescue } from "@/lib/sos";
import { isStaffRole, useMyRole } from "./useMyRole";

/**
 * The route to the rescue queue, carrying how many people are waiting.
 *
 * A staff home screen that links to "SAKLOLO" without saying whether anyone is
 * there makes the volunteer open it to find out — which, during a storm, means
 * they mostly do not, and an unanswered request sits unseen. The number is the
 * whole point of the control.
 *
 * Three states, kept distinct on purpose, because two of them are the failure
 * this project has already shipped twice:
 *
 *   - **A number.** Staff, online, list current.
 *   - **`—` because it cannot be read.** RLS returns zero rows to a resident,
 *     not an error, so a resident viewing a staff screen would otherwise be
 *     shown a confident "0 WAITING" — a claim nobody made.
 *   - **`—` because it cannot be refreshed.** Offline, the last count is not
 *     current, and a stale `0` on a rescue control reads as "nobody needs
 *     help". The responder screen already refuses to imply that; so does this.
 *
 * Only a number this component can actually stand behind is ever rendered.
 */
export function RescueLink({ variant }: { variant: "primary" | "muted" }) {
  const { online } = useSync();
  const t = useT();

  const [waiting, setWaiting] = useState<number | null>(null);

  /*
   * Via the hook, so the role is read once the session exists. Asking on mount
   * returned "resident" on every cold load — the badge then never appeared for
   * a volunteer, because nothing re-ran the check.
   */
  const isStaff = isStaffRole(useMyRole());

  useEffect(() => {
    // No reset needed when not staff: `showCount` already gates display on
    // `isStaff`, so a stale count can never be rendered. Setting state here
    // would just be a cascading render.
    if (!isStaff) return;

    let live = true;
    const load = async () => {
      const queue = await activeQueue();
      if (live) setWaiting(queue.length);
    };

    void load();
    // Realtime rather than polling, matching the responder screen (FR-4.6).
    const stopLive = subscribeRescue(() => void load());

    return () => {
      live = false;
      stopLive();
    };
  }, [isStaff]);

  /* A count is only trustworthy if it could be both read and refreshed. */
  const showCount = isStaff && online && waiting !== null;

  return (
    <Link
      href="/responder"
      className={`tap mono flex items-center justify-center gap-2 rounded-instrument border-[1.5px] text-[10px] font-bold tracking-[1px] transition-colors ${
        variant === "primary"
          ? "border-hv text-hv"
          : "border-line-soft text-paper-3 hover:text-paper"
      }`}
    >
      {t("nav.rescue")}

      {isStaff && (
        <span
          className={`rounded-[2px] px-1.5 py-px text-[10px] font-bold ${
            showCount && waiting > 0
              ? "bg-alarm text-[oklch(0.99_0.01_28)]"
              : "border border-line text-paper-3"
          }`}
          // The badge is a count, not decoration — say so for a screen reader,
          // and say plainly when the number is unavailable rather than zero.
          aria-label={
            showCount
              ? `${waiting} ${t("vol.waiting")}`
              : t("vol.waiting_unknown")
          }
          title={showCount ? undefined : t("vol.waiting_unknown")}
        >
          {showCount ? waiting : "—"}
        </span>
      )}
    </Link>
  );
}
