"use client";

import Link from "next/link";
import { useSync, useT } from "@/components/AppRuntime";
import { SignalPlacard } from "@/components/SignalPlacard";
import { HouseholdsCard } from "@/components/HouseholdsCard";

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
 *
 * The household count is here because volunteers are the ones who walk the
 * streets and can count them; HouseholdsCard shows itself only to staff.
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
                  {/* Capacity is left unset until an official enters it — said
                      as such, never printed as "null" or a guessed number. */}
                  {centre.capacity == null
                    ? t("vol.capacity_unset")
                    : t("vol.capacity", { n: centre.capacity })}
                  {/* A centre with no coordinates cannot be a map destination,
                      and a volunteer directing someone there should know. */}
                  {centre.lat == null && ` · ${t("vol.no_location")}`}
                </p>
              </li>
            ))}
          </ul>

          <HouseholdsCard />

          {/*
           * Only what the tab bar cannot reach. SCAN, BILANG and SAKLOLO all
           * have tabs, and repeating them here made the home a wall of
           * identical buttons duplicating the navigation two centimetres
           * below it. The rescue count moved onto the tab itself, where it is
           * visible from every screen rather than only this one.
           */}
          <div className="mt-1 grid grid-cols-2 gap-2">
            <HomeLink href="/report" label={t("nav.report")} icon="drop" />
            <HomeLink href="/map" label={t("nav.map")} icon="map" />
          </div>
        </>
      )}
    </main>
  );
}

/**
 * The two destinations the volunteer's tab bar does not carry.
 *
 * They used to be a grey outline with grey tracked caps — the same treatment
 * this app gives disabled text — so the only two links on the screen read as
 * the least interactive thing on it, while the cards above them (which do
 * nothing when tapped) looked exactly the same. Colour is the fix, and the
 * rule that governs it is already written down: `hv` means INTERACTIVE and
 * nothing else. So these take the accent, in a tint that keeps them below the
 * signal placard in the reading order without pretending they are inert, and
 * each gets the icon its own tab carries elsewhere in the product, so the
 * shape is recognised before the word is read.
 */
function HomeLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: "drop" | "map";
}) {
  return (
    <Link
      href={href}
      className="tap mono flex items-center justify-center gap-2 rounded-instrument border-[1.5px] border-hv/45 bg-hv/10 text-[11px] font-bold tracking-[1px] text-hv transition-colors hover:bg-hv/20"
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {icon === "drop" ? (
          <path d="M12 3s7 7.58 7 12a7 7 0 0 1-14 0c0-4.42 7-12 7-12z" />
        ) : (
          <>
            <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6z" />
            <path d="M9 4v14" />
            <path d="M15 6v14" />
          </>
        )}
      </svg>
      {label}
    </Link>
  );
}
