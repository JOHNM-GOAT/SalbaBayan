"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "./AppRuntime";
import {
  allMyRequests,
  elapsedSince,
  isActive,
  subscribeRescue,
  type RescueRequest,
} from "@/lib/sos";

/**
 * "You have already called for help, and nobody has come yet."
 *
 * The SOS screen says this well, but only while someone is standing on it. A
 * person who taps the button and then walks back to the home screen — to read
 * the instruction again, to check the route, or simply because that is what a
 * phone does when you put it in a pocket and take it out — had no way of
 * knowing the request was still open. The worst reading of a blank home screen
 * is "it did not go through", and the response to that is to press the button
 * again, which is the one thing nobody in danger should have to wonder about.
 *
 * So the request follows them home. The clock counts from the tap, not from
 * delivery, for the same reason it does on the SOS screen: a request that sat
 * in the queue for forty minutes waited forty minutes, and saying otherwise
 * would flatter the app at the expense of the person holding it.
 *
 * Deliberately not animated. `.sos-pulse` is the one animation in this product
 * and it belongs to the SOS pins on the map; a second thing pulsing is how an
 * animation that means "urgent" stops meaning anything. The ticking seconds
 * are motion enough to read as live.
 */
export function ActiveSOSBanner() {
  const t = useT();
  const [request, setRequest] = useState<RescueRequest | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    /* Server rows and the local write queue together, so a request raised with
       no signal shows here as soon as it is durable — which is the moment the
       button was pressed, not the moment a network appeared. */
    const rows = await allMyRequests();
    setRequest(rows.find(isActive) ?? null);
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refresh());
    const stopLive = subscribeRescue(() => void refresh());
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stopLive();
      window.clearInterval(tick);
    };
  }, [refresh]);

  /* No open request is the normal state of this device, and it should look
     exactly like it always has. */
  if (!request) return null;

  const acknowledged = request.status === "acknowledged";

  return (
    <Link
      href="/sos"
      className="tap flex items-center gap-3 rounded-instrument border-l-4 border-alarm bg-alarm/10 px-3 py-2.5 transition-colors hover:bg-alarm/15"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-alarm">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="oklch(0.99 0.01 28)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 2v3" />
          <path d="M6 21v-6a6 6 0 0 1 12 0v6z" />
          <path d="M4 21h16" />
        </svg>
      </span>

      <span className="min-w-0 flex-1">
        <span className="block font-display text-[15px] leading-tight font-extrabold tracking-[0.3px] text-alarm">
          {t("sos.sent")}
        </span>
        {/*
          The elapsed time and the state, in that order, because the first
          question is "how long have I been waiting" and the second is "has
          anyone seen it". Tabular numerals, so the seconds do not shift the
          words beside them every tick.
        */}
        <span className="mono mt-0.5 block truncate text-[11.5px] font-semibold tracking-[0.6px] text-paper-2">
          {elapsedSince(request.ts, now)} ·{" "}
          {acknowledged ? t("sos.state_ack") : t("sos.waiting")}
        </span>
      </span>

      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--color-alarm)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
        <path d="M9 6l6 6-6 6" />
      </svg>
    </Link>
  );
}
