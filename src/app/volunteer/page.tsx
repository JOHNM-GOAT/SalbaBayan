"use client";

import Link from "next/link";
import { useSync, useT } from "@/components/AppRuntime";
import { SignalPlacard } from "@/components/SignalPlacard";
import { RescueLink } from "@/components/RescueLink";

/**
 * Volunteer home (PRD §4: "operates an evacuation centre ... checks people in,
 * keeps the headcount, and reports what they can see").
 *
 * Deliberately thin. A volunteer's home screen is not a dashboard to study,
 * it is the two seconds between putting the phone away and picking it up
 * again — so it carries the signal placard everyone needs, the centres they
 * might be standing in, and the way to their work. Numbers that would need a
 * staff-only read are not shown here rather than shown as zeros: this screen
 * has to be correct on a device whose role has not been granted yet, which is
 * the normal state of a new volunteer's phone on day one.
 */
export default function VolunteerHome() {
  const { snapshot } = useSync();
  const t = useT();

  const centres = snapshot?.centers ?? [];

  return (
    <main className="flex flex-1 flex-col gap-2.5 p-3.5">
      {!snapshot ? (
        <p className="mono mt-8 text-center text-[11px] leading-relaxed tracking-[0.6px] text-paper-3">
          {t("ui.no_cache")}
        </p>
      ) : (
        <>
          <SignalPlacard />

          <span className="lbl mt-1">{t("vol.centres")}</span>

          <ul className="grid gap-2 @xl:grid-cols-2">
            {centres.map((centre) => (
              <li
                key={centre.id}
                className="rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3.5 py-3"
              >
                <p className="text-[13.5px] font-bold">{centre.name}</p>
                <p className="mono mt-1 text-[10px] tracking-[0.6px] text-paper-3">
                  {t("vol.capacity", { n: centre.capacity })}
                  {/* A centre with no coordinates cannot be a map destination,
                      and a volunteer directing someone there should know. */}
                  {centre.lat == null && ` · ${t("vol.no_location")}`}
                </p>
              </li>
            ))}
          </ul>

          <div className="mt-1 grid grid-cols-2 gap-2">
            <Link
              href="/checkin"
              className="tap mono flex items-center justify-center rounded-instrument border-[1.5px] border-hv text-[10px] font-bold tracking-[1px] text-hv"
            >
              {t("nav.scan")}
            </Link>
            <Link
              href="/headcount"
              className="tap mono flex items-center justify-center rounded-instrument border-[1.5px] border-line-soft text-[10px] font-bold tracking-[1px] text-paper-3 transition-colors hover:text-paper"
            >
              {t("nav.count")}
            </Link>
            <Link
              href="/report"
              className="tap mono flex items-center justify-center rounded-instrument border-[1.5px] border-line-soft text-[10px] font-bold tracking-[1px] text-paper-3 transition-colors hover:text-paper"
            >
              {t("nav.report")}
            </Link>
            {/* The map left the tab bar to make room for rescue, so it keeps a
                place here — a volunteer directing someone to a centre should
                not have to go hunting for it. */}
            <Link
              href="/map"
              className="tap mono flex items-center justify-center rounded-instrument border-[1.5px] border-line-soft text-[10px] font-bold tracking-[1px] text-paper-3 transition-colors hover:text-paper"
            >
              {t("nav.map")}
            </Link>
            <RescueLink variant="primary" />
          </div>
        </>
      )}
    </main>
  );
}
