"use client";

import { useEffect } from "react";
import { onWriteLanded } from "@/lib/offlineQueue";
import { notifyRescue } from "@/lib/push";

/**
 * Wake the staff when this device's SOS actually reaches the server.
 *
 * Mounted in the layout beside the other null-rendering effects, because the
 * resident may well have walked away from the SOS screen — to the map, to the
 * instruction, or back home — long before the write flushes. Hanging this off
 * that one screen would mean the alert fires only if they happened to stay on
 * it, which is the opposite of what an offline-first queue is for.
 *
 * On the row LANDING, not on the button press. Those are the same instant with
 * a signal and an hour apart without one, and a notification naming a request
 * the server has never heard of sends a volunteer out to an empty map.
 */
export function PushBridge() {
  useEffect(
    () =>
      onWriteLanded((write) => {
        if (write.table !== "rescue_requests" || write.op !== "insert") return;
        /* Not awaited: the queue is mid-flush and the rows behind this one are
           waiting. The sender refuses anything that is not a live request of
           this device's own, so a late or duplicate call is harmless. */
        void notifyRescue(write.id);
      }),
    [],
  );

  return null;
}
