"use client";

import { useEffect } from "react";
import { isStaffRole, useMyRole } from "./useMyRole";
import { playIncomingSOS, unlockAudio } from "@/lib/alertSound";
import { freshArrivals, newArrivalState } from "@/lib/rescueArrivals";
import { activeQueue, subscribeRescue } from "@/lib/sos";
import { getCurrentUserId } from "@/lib/supabase";

/**
 * The rescue alarm, on every staff screen.
 *
 * Mounted in the layout beside RouteGuard, and for the same reason: a volunteer
 * scanning cards at a centre door, or an official reading the coverage matrix,
 * must learn that somebody has called for help without being on the screen
 * that shows it. The badge on the tab bar already says so silently; this is the
 * part that works when the phone is face down on a table.
 *
 * Which requests are worth sounding for is decided by lib/rescueArrivals.ts,
 * which is tested. What is left here is the plumbing: subscribe, ask, play.
 *
 * Renders nothing. It is an effect with a component-shaped wrapper, which is
 * how a Next.js layout gets to run one.
 */
export function IncomingSOSAlert() {
  const isStaff = isStaffRole(useMyRole());

  useEffect(() => {
    if (!isStaff) return;

    let live = true;
    const seen = newArrivalState();
    let mine: string | null = null;

    const load = async () => {
      try {
        const queue = await activeQueue();
        if (!live) return;

        /* Asked once and kept: a volunteer who raised their own SOS gets the
           resident's confirmation for it, not the hall's alarm. */
        mine ??= await getCurrentUserId();
        if (!live) return;

        /* One alarm however many arrived together. Three calls in the same
           second is a worse emergency, not a reason to play three alarms over
           each other. */
        if (freshArrivals(queue, seen, mine).length > 0) playIncomingSOS();
      } catch {
        /* Offline. Nothing arrived, because nothing can arrive — and the badge
           already falls back to "cannot say" rather than to zero. */
      }
    };

    void load();
    const stopLive = subscribeRescue(() => void load());

    /*
     * Autoplay: a page that has never been touched may not make a noise. The
     * resident's confirmation is played from inside their own tap and needs
     * none of this; the alarm answers somebody else's emergency, so the first
     * touch anywhere in the app is what earns the right to sound it.
     */
    const wake = () => unlockAudio();
    document.addEventListener("pointerdown", wake, { once: true, passive: true });
    document.addEventListener("keydown", wake, { once: true });

    return () => {
      live = false;
      stopLive();
      document.removeEventListener("pointerdown", wake);
      document.removeEventListener("keydown", wake);
    };
  }, [isStaff]);

  return null;
}
