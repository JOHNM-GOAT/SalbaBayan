"use client";

import { useEffect, useState } from "react";
import { onQueueChanged, queuedWrites } from "@/lib/offlineQueue";
import { pendingAdvisory, type PendingAdvisory } from "@/lib/pendingAdvisory";

const NONE: PendingAdvisory = { state: "none" };

/**
 * Whether this device holds an advisory change residents have not received.
 *
 * Re-read on every queue change rather than polled, the same signal the sync
 * strip uses — so the banner clears the moment the change is delivered, and
 * turns red the moment the queue gives up on it.
 */
export function usePendingAdvisory(barangayId: string | null): PendingAdvisory {
  const [pending, setPending] = useState<PendingAdvisory>(NONE);

  useEffect(() => {
    if (!barangayId) return;

    let live = true;
    const read = () => {
      void queuedWrites().then((rows) => {
        if (live) setPending(pendingAdvisory(rows, barangayId));
      });
    };

    // Deferred a tick, matching the other screens: every setState here happens
    // after an await, but the lint rule cannot see across that boundary.
    queueMicrotask(read);
    const stop = onQueueChanged(read);

    return () => {
      live = false;
      stop();
    };
  }, [barangayId]);

  return barangayId ? pending : NONE;
}
