"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import * as maplibregl from "maplibre-gl";
import { useSync, useT } from "./AppRuntime";
import { useMyRole } from "./useMyRole";
import { HoldToConfirm } from "./HoldToConfirm";
import { enqueueUpdate } from "@/lib/offlineQueue";
import { resolveColour } from "@/lib/signal";
import type { Point } from "@/lib/geo";
import {
  buildWalkGraph,
  pointInRing,
  routeDescription,
  walkRoute,
  type Streets,
} from "@/lib/walkRoute";

/**
 * Setting the evacuation centre — officials only.
 *
 * The official taps the map where the centre is. A point outside the barangay
 * is refused on the spot; the database refuses it again (migration 0026), so
 * the rule holds even for a tampered client. RLS already limits writes to
 * evac_centers and protocols to officials; this control is simply not shown to
 * anyone else.
 *
 * Moving the centre moves every route. The routes are redrawn here, on the
 * phone, with the same code the geography generator used
 * (src/lib/walkRoute.ts), from each area's starting point to the new location
 * — ALL of them computed before anything is saved, so a failure cannot leave
 * half the barangay walking to where the hall used to be. The centre and the
 * routes then go through the offline queue, and reach every open phone through
 * the live subscription (lib/advisory.ts).
 *
 * The save is a press-and-hold, like issuing a signal. Changing where the whole
 * barangay evacuates to is not something a stray tap should be able to do.
 */
export function CentreEditor({
  mapRef,
  streets,
}: {
  mapRef: RefObject<maplibregl.Map | null>;
  streets: Streets | null;
}) {
  const { snapshot } = useSync();
  const t = useT();
  const role = useMyRole();

  const [editing, setEditing] = useState(false);
  const [point, setPoint] = useState<Point | null>(null);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [outside, setOutside] = useState(false);
  const [saved, setSaved] = useState(false);
  const marker = useRef<maplibregl.Marker | null>(null);

  // #5 Callaguip has exactly one centre, the barangay hall.
  const centre = snapshot?.centers[0] ?? null;
  const ring = snapshot?.barangay.boundary_geojson?.coordinates[0] as Point[] | undefined;

  /* While editing, a tap on the map places the centre — inside the barangay only. */
  useEffect(() => {
    const m = mapRef.current;
    if (!editing || !m) return;

    const onClick = (event: maplibregl.MapMouseEvent) => {
      const tapped: Point = [event.lngLat.lng, event.lngLat.lat];
      if (ring && !pointInRing(tapped, ring)) {
        setOutside(true);
        return;
      }
      setOutside(false);
      setPoint(tapped);
    };

    m.on("click", onClick);
    m.getCanvas().style.cursor = "crosshair";
    return () => {
      m.off("click", onClick);
      m.getCanvas().style.cursor = "";
    };
  }, [editing, mapRef, ring]);

  /* The draft position, drawn as its own marker so it never reads as saved. */
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !editing || !point) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      const dot = document.createElement("div");
      dot.style.cssText = [
        "width:22px",
        "height:22px",
        "border-radius:50%",
        `border:3px dashed ${resolveColour("var(--color-hv)")}`,
        `background:${resolveColour("var(--color-ink-900)")}`,
      ].join(";");
      marker.current = new maplibregl.Marker({ element: dot });
    }
    marker.current.setLngLat(point).addTo(m);
  }, [editing, point, mapRef]);

  useEffect(
    () => () => {
      marker.current?.remove();
    },
    [],
  );

  if (role !== "official" || !snapshot || !centre) return null;

  const trimmedCapacity = capacity.trim();
  const capacityValue =
    trimmedCapacity === ""
      ? null
      : /^\d+$/.test(trimmedCapacity) && Number(trimmedCapacity) >= 1
        ? Number(trimmedCapacity)
        : undefined; // invalid
  const canSave =
    point !== null && name.trim() !== "" && capacityValue !== undefined && streets !== null;

  const start = () => {
    setEditing(true);
    setSaved(false);
    setOutside(false);
    setName(centre.name);
    setCapacity(centre.capacity == null ? "" : String(centre.capacity));
    setPoint(centre.lat != null && centre.lng != null ? [centre.lng, centre.lat] : null);
  };

  const save = () => {
    if (!canSave || point === null || streets === null) return;
    const centreName = name.trim();
    const graph = buildWalkGraph(streets);

    // Every route first. Nothing is written until all of them exist.
    const routeByArea = new Map<string, { geojson: unknown; text: string }>();
    for (const area of snapshot.puroks) {
      if (area.lat == null || area.lng == null) continue;
      const from: Point = [area.lng, area.lat];
      const route = walkRoute(graph, from, point);
      if (!route) continue;
      // A centre placed on an area's own starting point is a zero-length walk;
      // draw it as the short line from the start to the centre instead.
      const line = route.line.length >= 2 ? route.line : [from, point];
      routeByArea.set(area.id, {
        geojson: { type: "LineString", coordinates: line },
        text: routeDescription(area.name, centreName, route),
      });
    }

    const protocols = snapshot.protocols.filter((p) => p.evac_center_id === centre.id);

    void (async () => {
      await enqueueUpdate("evac_centers", centre.id, {
        lat: point[1],
        lng: point[0],
        name: centreName,
        capacity: capacityValue,
      });
      for (const protocol of protocols) {
        const route = routeByArea.get(protocol.purok_id);
        if (!route) continue;
        await enqueueUpdate("protocols", protocol.id, {
          route_geojson: route.geojson,
          route: route.text,
        });
      }
    })();

    setEditing(false);
    setPoint(null);
    setSaved(true);
  };

  if (!editing) {
    return (
      <div className="grid gap-1.5">
        <button
          type="button"
          onClick={start}
          className="tap mono flex items-center justify-center rounded-instrument border-[1.5px] border-hv text-[10.5px] font-bold tracking-[1px] text-hv"
        >
          {t("ce.set")}
        </button>
        {saved && (
          <p className="mono text-[10px] leading-relaxed tracking-[0.5px] text-paper-3" role="status">
            {t("ce.saved")}
          </p>
        )}
      </div>
    );
  }

  return (
    <section className="grid gap-3 rounded-instrument border-[1.5px] border-hv bg-ink-800 px-3.5 py-3">
      <p className="text-[12.5px] leading-snug font-semibold">{t("ce.tap")}</p>

      {outside && (
        <p className="mono text-[10.5px] font-bold tracking-[0.5px] text-alarm" role="alert">
          {t("ce.outside")}
        </p>
      )}

      <label className="grid gap-1.5">
        <span className="lbl">{t("ce.name")}</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="tap w-full rounded-instrument border-[1.5px] border-line-soft bg-ink-900 px-3 text-[13.5px] text-paper focus:border-hv focus:outline-none"
        />
      </label>

      <label className="grid gap-1.5">
        <span className="lbl">{t("ce.capacity")}</span>
        <input
          inputMode="numeric"
          value={capacity}
          placeholder={t("ce.capacity_unset")}
          onChange={(event) => setCapacity(event.target.value)}
          className="tap w-full rounded-instrument border-[1.5px] border-line-soft bg-ink-900 px-3 text-[13.5px] text-paper placeholder:text-paper-3 focus:border-hv focus:outline-none"
        />
      </label>

      {capacityValue === undefined && (
        <p className="mono text-[10.5px] font-bold tracking-[0.5px] text-alarm" role="alert">
          {t("ce.capacity_invalid")}
        </p>
      )}

      {canSave ? (
        <HoldToConfirm
          label={t("ce.hold_save")}
          holdingLabel={t("sos.cancelling")}
          tone="accent"
          onConfirm={save}
        />
      ) : (
        <button
          type="button"
          disabled
          className="tap rounded-instrument border-[1.5px] border-line-soft bg-ink-900 py-3 text-[13px] font-semibold text-paper-3 opacity-60"
        >
          {t("ce.hold_save")}
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          setEditing(false);
          setPoint(null);
          setOutside(false);
        }}
        className="mono text-[10.5px] font-bold tracking-[0.8px] text-paper-3"
      >
        {t("ce.cancel")}
      </button>
    </section>
  );
}
