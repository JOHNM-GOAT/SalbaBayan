"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
// Namespace import: maplibre-gl ships no default export, and importing one
// type-checks under `esModuleInterop` but fails at bundle time.
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useSync, useT } from "@/components/AppRuntime";
import {
  acknowledge,
  activeQueue,
  markRescued,
  subscribeRescue,
  waitMinutes,
  type RescueRequest,
} from "@/lib/sos";

/**
 * Live rescue map (PRD §7.4, FR-4.6).
 *
 * MapLibre with OpenFreeMap tiles — no API key, no billing account, no
 * proprietary dependency (Q3). Attribution is a licence condition of the
 * underlying OpenStreetMap data, so the control stays on and is not styled
 * away.
 *
 * This is the one view in the product that legitimately requires connectivity
 * (PRD §17): it runs at the barangay hall on mains power and a wired line.
 * Incoming requests still queue on residents' devices when they are offline —
 * that half is unaffected.
 */

/** Barangay San Isidro, Sta. Cruz, Laguna — fixture geography, pending Q4. */
const CENTRE: [number, number] = [121.4142, 14.2801];

export default function ResponderPage() {
  const { online } = useSync();
  const t = useT();

  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);

  const [queue, setQueue] = useState<RescueRequest[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [mapReady, setMapReady] = useState(false);

  const refresh = useCallback(async () => {
    setQueue(await activeQueue());
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refresh());
    // Realtime rather than polling (FR-4.6, NFR-3.3).
    const stopLive = subscribeRescue(() => void refresh());
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stopLive();
      window.clearInterval(tick);
    };
  }, [refresh]);

  useEffect(() => {
    if (!container.current || map.current) return;

    map.current = new maplibregl.Map({
      container: container.current,
      /*
       * The dark basemap, not the default light one.
       *
       * Not a preference: this view is read at night in a barangay hall, and a
       * white rectangle in an otherwise near-black interface both wrecks the
       * reader's dark adaptation and makes the severity-coloured pins harder
       * to pick out. It also happens to draw less power on an OLED panel.
       */
      style: "https://tiles.openfreemap.org/styles/dark",
      center: CENTRE,
      zoom: 14,
      // Keep the attribution control; removing it would breach the OSM licence.
      attributionControl: { compact: true },
    });

    map.current.addControl(new maplibregl.NavigationControl(), "top-right");
    map.current.on("load", () => setMapReady(true));

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  /* Re-plot pins whenever the queue changes. */
  useEffect(() => {
    if (!map.current || !mapReady) return;

    markers.current.forEach((m) => m.remove());
    markers.current = [];

    for (const request of queue) {
      // A request with no fix cannot be plotted. It is deliberately NOT
      // dropped — it stays in the list with its Purok, because a person
      // without GPS is not a person without an emergency.
      if (request.lat == null || request.lng == null) continue;

      const pin = document.createElement("div");
      pin.style.cssText = [
        "width:18px",
        "height:18px",
        "border-radius:50%",
        `background:${request.status === "acknowledged" ? "var(--color-caution)" : "var(--color-alarm)"}`,
        "border:2.5px solid var(--color-ink-900)",
        "box-shadow:0 0 0 3px rgba(0,0,0,0.35)",
      ].join(";");

      markers.current.push(
        new maplibregl.Marker({ element: pin })
          .setLngLat([request.lng, request.lat])
          .addTo(map.current),
      );
    }
  }, [queue, mapReady]);

  const oldest = queue[0];

  return (
    <>
      <div className="flex items-center gap-3 px-3.5 py-3">
        <Link href="/" aria-label="Back" className="shrink-0">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--color-paper-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </Link>
        <h1 className="flex-1 font-display text-base font-extrabold tracking-[0.4px]">
          {t("resp.title")}
        </h1>
        <span className="mono text-[11px] font-bold tracking-[0.8px] text-alarm">
          {queue.length}
        </span>
      </div>

      {/* This view genuinely needs the network. Saying so is better than
          showing an empty queue that looks like "nobody needs help". */}
      {!online && (
        <p className="mono mx-3.5 rounded-instrument border-[1.5px] border-caution bg-ink-800 px-3 py-2 text-[10px] leading-snug tracking-[0.6px] text-caution">
          OFFLINE — HINDI NA-UPDATE ANG LISTAHAN. HINDI ITO NANGANGAHULUGANG
          WALANG HUMIHINGI NG SAKLOLO.
        </p>
      )}

      <main className="flex flex-1 flex-col gap-3 p-3.5">
        <div
          ref={container}
          className="h-64 w-full shrink-0 overflow-hidden rounded-instrument border-[1.5px] border-line-soft"
        />

        {/* The oldest unanswered request is escalated out of the list, because
            in a long queue the one most at risk is the one easiest to lose. */}
        {oldest && oldest.status === "pending" && (
          <section className="rounded-instrument border-[1.5px] border-alarm bg-alarm/10 p-3">
            <p className="lbl text-alarm">{t("resp.oldest")}</p>
            <div className="mt-1.5 flex items-baseline justify-between">
              <span className="text-[14px] font-bold">
                {oldest.lat != null ? "Purok" : t("resp.no_fix")}
              </span>
              <span className="mono text-[17px] font-bold text-alarm">
                {waitMinutes(oldest.ts, now)}m
              </span>
            </div>
          </section>
        )}

        {queue.length === 0 ? (
          <p className="mono mt-4 text-center text-[11px] tracking-[0.6px] text-paper-3">
            {t("resp.none")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {queue.map((request) => (
              <li
                key={request.id}
                className={`rounded-instrument border-l-4 bg-ink-800 p-3 ${
                  request.status === "acknowledged"
                    ? "border-caution"
                    : "border-alarm"
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="mono text-[11px] tracking-[0.5px] text-paper-2">
                    {request.lat != null && request.lng != null
                      ? `${request.lat.toFixed(4)} · ${request.lng.toFixed(4)}`
                      : t("resp.no_fix")}
                  </span>
                  <span className="mono text-[14px] font-bold text-paper">
                    {waitMinutes(request.ts, now)}m
                  </span>
                </div>

                <div className="mt-2.5 flex gap-2">
                  {request.status === "pending" ? (
                    <button
                      type="button"
                      onClick={() => void acknowledge(request.id).then(refresh)}
                      className="tap flex-1 rounded-[3px] bg-hv text-[12.5px] font-bold text-hv-ink"
                    >
                      {t("resp.ack")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void markRescued(request.id).then(refresh)}
                      className="tap flex-1 rounded-[3px] border-[1.5px] border-clear text-[12.5px] font-bold text-clear"
                    >
                      {t("resp.rescued")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
