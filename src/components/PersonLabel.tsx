"use client";

import { useT } from "./AppRuntime";
import type { NamedPerson } from "@/lib/profile";

/**
 * Who sent a report or SOS, for staff: the name the device gave. Names are
 * taken as given; nobody has to confirm them. Residents never get names (RLS),
 * so this only ever renders on staff screens.
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
    <span className="block truncate text-[12px] font-semibold">
      {person.first_name} {person.last_name}
    </span>
  );
}
