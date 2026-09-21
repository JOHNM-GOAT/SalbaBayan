"use client";

import { useEffect, useState } from "react";
import { useSync, useT } from "./AppRuntime";
import { HoldToConfirm } from "./HoldToConfirm";
import { clockLabel } from "@/lib/ledger";
import { countDeviceIn, recentArrival, type Arrival } from "@/lib/deviceCheckin";

/**
 * A resident's phone QR, scanned at the hall: how many came with it, then a
 * press-and-hold adds them to the hall's headcount. A phone already counted
 * in the last 3 days says so and offers nothing to press.
 */
export function DeviceArrival({
  code,
  onCounted,
}: {
  code: string;
  onCounted: (people: number) => void;
}) {
  const { snapshot } = useSync();
  const t = useT();
  const centre = snapshot?.centers[0] ?? null;

  const [people, setPeople] = useState(1);
  const [arrival, setArrival] = useState<Arrival | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void recentArrival(code).then((found) => {
      if (live) setArrival(found);
    });
    return () => {
      live = false;
    };
  }, [code]);

  const step = (by: number) => setPeople((n) => Math.min(50, Math.max(1, n + by)));

  return (
    <section className="grid gap-3 rounded-instrument border-l-4 border-hv bg-ink-800 p-3.5">
      <h2 className="mono font-display text-[18px] font-extrabold tracking-[1.5px]">
        {t("ci.phone", { n: code })}
      </h2>

      {arrival === undefined ? (
        <p className="mono text-[11px] text-paper-3">…</p>
      ) : arrival ? (
        <p className="rounded-instrument border-[1.5px] border-caution px-3 py-2.5 text-[12.5px] leading-snug font-semibold text-caution" role="status">
          {t("ci.already", { n: `${clockLabel(arrival.ts)} (${arrival.people})` })}
        </p>
      ) : (
        <>
          <p className="text-[13px] font-semibold">{t("ci.how_many")}</p>
          <div className="flex items-center justify-center gap-5">
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={people <= 1}
              aria-label="-1"
              className="tap size-12 rounded-instrument border-[1.5px] border-line-soft text-[22px] font-bold disabled:opacity-35"
            >
              −
            </button>
            <span className="mono w-14 text-center text-[34px] leading-none font-bold">{people}</span>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={people >= 50}
              aria-label="+1"
              className="tap size-12 rounded-instrument border-[1.5px] border-line-soft text-[22px] font-bold disabled:opacity-35"
            >
              +
            </button>
          </div>
          {centre && (
            <HoldToConfirm
              label={t("ci.hold_count", { n: people })}
              holdingLabel={t("sos.cancelling")}
              tone="accent"
              onConfirm={() => {
                void countDeviceIn(code, centre.id, people).then(() => onCounted(people));
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
