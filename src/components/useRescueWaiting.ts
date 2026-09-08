"use client";

import { useEffect, useState } from "react";
import { useSync } from "./AppRuntime";
import { isStaffRole, useMyRole } from "./useMyRole";
import { activeQueue, subscribeRescue } from "@/lib/sos";

export type RescueWaiting = {
  /** Whether this device may read the queue at all. */
  isStaff: boolean;
  /** People still waiting, or null when that cannot be stated. */
  count: number | null;
};

/**
 * How many people are waiting for rescue, for the badge on the tab bar.
 *
 * `count` is null in two different situations that must not be collapsed into
 * zero: the viewer is not staff (RLS returns no rows rather than an error), or
 * the device is offline and the number it holds is no longer current. A stale
 * or unpermitted "0" on a rescue control is a false all-clear, which is the
 * worst thing this particular control could say.
 */
export function useRescueWaiting(): RescueWaiting {
  const { online } = useSync();
  const isStaff = isStaffRole(useMyRole());
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!isStaff) return;

    let live = true;
    const load = async () => {
      const queue = await activeQueue();
      if (live) setCount(queue.length);
    };

    void load();
    // Realtime rather than polling, matching the responder screen (FR-4.6).
    const stopLive = subscribeRescue(() => void load());

    return () => {
      live = false;
      stopLive();
    };
  }, [isStaff]);

  return { isStaff, count: isStaff && online ? count : null };
}
