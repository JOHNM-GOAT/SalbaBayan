"use client";

import { useCallback, useEffect, useState } from "react";
import type { BulletinResponse } from "@/app/api/pagasa/route";

/**
 * The PAGASA bulletin, on the official's screen.
 *
 * Fetched from this app's own route handler (app/api/pagasa), which does the
 * reading; see that file for why it cannot happen in the browser.
 *
 * The last reading is kept in localStorage and shown again on the next open,
 * with the time it was read. That is the same bargain the advisory snapshot
 * makes: better to show the last thing known and say how old it is than to show
 * an empty card in the middle of a storm. The age is always on screen, so a
 * stale bulletin can never pass for a current one.
 */

const KEY = "salbabayan.pagasa.last";

/** How often the card refreshes itself while the dashboard stays open. */
const POLL_MS = 10 * 60 * 1000;

export type BulletinFeed = {
  /** Null until the first read finishes or a stored one is found. */
  reading: BulletinResponse | null;
  /** A fetch is in flight. */
  loading: boolean;
  /** Read again now — the official tapped refresh. */
  reload: () => void;
};

export function useBulletin(enabled = true): BulletinFeed {
  const [reading, setReading] = useState<BulletinResponse | null>(() => stored());
  const [loading, setLoading] = useState(false);
  const [epoch, setEpoch] = useState(0);

  const reload = useCallback(() => setEpoch((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // Out of the effect body itself: a synchronous setState there starts a
    // second render pass before the first has painted, and the spinner is not
    // worth that. The same queueMicrotask the rest of the app refreshes with.
    queueMicrotask(() => {
      if (live) setLoading(true);
    });

    void read()
      .then((next) => {
        if (!live || !next) return;
        /*
         * A failed read does not overwrite a good one. "PAGASA could not be
         * reached just now" is worth knowing, but not at the price of throwing
         * away the bulletin this device already has — which is exactly the
         * moment it matters, since the towers go down in the same storm.
         */
        setReading((previous) =>
          next.state === "unavailable" && previous && previous.state !== "unavailable"
            ? previous
            : remember(next),
        );
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [enabled, epoch]);

  /* While the dashboard is open, keep it current: PAGASA issues a bulletin
     every few hours during a storm, more often near landfall. */
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(reload, POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, reload]);

  return { reading, loading, reload };
}

async function read(): Promise<BulletinResponse | null> {
  try {
    const response = await fetch("/api/pagasa", { cache: "no-store" });
    if (!response.ok) return { state: "unavailable", fetchedAt: new Date().toISOString() };
    return (await response.json()) as BulletinResponse;
  } catch {
    // Offline. The route handler was never reached, so nothing is known now —
    // whatever was stored stands, with its age.
    return { state: "unavailable", fetchedAt: new Date().toISOString() };
  }
}

function stored(): BulletinResponse | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as BulletinResponse) : null;
  } catch {
    // Unreadable or storage disabled. Treated as nothing stored.
    return null;
  }
}

function remember(reading: BulletinResponse): BulletinResponse {
  try {
    localStorage.setItem(KEY, JSON.stringify(reading));
  } catch {
    // Full or blocked. The reading is still returned; only the memory is lost.
  }
  return reading;
}
