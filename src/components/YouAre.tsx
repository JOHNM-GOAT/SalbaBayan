"use client";

import Link from "next/link";
import { useT } from "./AppRuntime";
import { useMyProfile } from "./useMyProfile";

/**
 * "The barangay knows who you are."
 *
 * The name was saved, kept on the phone and sent to the barangay — and then
 * shown on exactly one screen, the ME tab, which a resident opens roughly
 * never. Everywhere it actually matters it was invisible: the app asks for a
 * name because "your name lets the barangay trust your reports and find you in
 * a rescue", and then gave no sign it had one. Somebody who typed their name
 * last week has no way to tell whether it stuck.
 *
 * So the home screen says it, on open, quietly. It is also the way back to
 * change it, which is the other thing a person wants from seeing their own
 * name on a screen.
 *
 * Nothing is drawn when there is no name yet. That case already has a screen
 * of its own — ProfilePrompt asks for one — and two things asking at once is
 * worse than either.
 */
export function YouAre() {
  const { profile, loaded } = useMyProfile();
  const t = useT();

  /* `loaded` false is "not known yet", never "no name": rendering the empty
     case during the read would flash a row at people who have one. */
  if (!loaded || !profile) return null;

  const name = `${profile.first_name} ${profile.last_name}`.trim();
  if (!name) return null;

  return (
    <Link
      href="/profile"
      aria-label={`${name} — ${t("nav.me")}`}
      className="tap flex h-11 items-center border-b border-line-soft bg-ink-800 px-3.5 transition-colors hover:bg-ink-700"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-paper-3)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
        aria-hidden
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
      </svg>

      <span className="ml-2 min-w-0 flex-1 truncate text-[13px] font-semibold text-paper-2">
        {name}
      </span>

      {/*
        The address is the part that finds a house in the dark, so it is worth
        a glance here — but only where there is room for it. On a phone the
        name alone is the confirmation; the ME tab carries the rest.
      */}
      {profile.address && (
        <span className="mono ml-2 hidden min-w-0 max-w-[45%] truncate text-[10.5px] text-paper-3 @sm:block">
          {profile.address}
        </span>
      )}

      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-paper-3)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="ml-2 shrink-0"
        aria-hidden
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </Link>
  );
}
