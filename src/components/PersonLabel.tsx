"use client";

import { useT } from "./AppRuntime";
import type { NamedPerson } from "@/lib/profile";

/**
 * Who sent a report or SOS, for staff: the name, and whether a volunteer or
 * official has confirmed it. Residents never get names (RLS), so this only
 * ever renders on staff screens.
 */
export function PersonLabel({ person }: { person: NamedPerson | undefined }) {
  const t = useT();
  if (!person) {
    return (
      <span className="mono text-[10px] font-bold tracking-[0.6px] text-paper-3">
        {t("profile.no_name")}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate text-[12px] font-semibold">
        {person.first_name} {person.last_name}
      </span>
      <span
        className={`mono shrink-0 rounded-[2px] border px-1 text-[8.5px] font-bold tracking-[0.6px] ${
          person.confirmed_at ? "border-clear text-clear" : "border-caution text-caution"
        }`}
      >
        {person.confirmed_at ? t("profile.confirmed") : t("profile.unconfirmed")}
      </span>
    </span>
  );
}
