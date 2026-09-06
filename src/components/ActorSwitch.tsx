"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSync, useT } from "./AppRuntime";
import { useShellWidth } from "./Shell";
import { ACTORS, actorById } from "@/lib/actors";

/**
 * Switches which actor's screens are presented (PRD §4: Resident, Volunteer,
 * Official).
 *
 * This exists so the three roles can be walked through end to end on one
 * device without three phones and three role grants — which is what a demo of
 * this product needs, and what a barangay evaluating it will ask to see.
 *
 * It is labelled DEMO on screen, deliberately and permanently. Switching here
 * changes navigation and nothing else: every screen still reads and writes
 * through the same RLS policies, so selecting "Official" on a resident's
 * device shows the official's tab bar and then, correctly, no roster data. A
 * control that changed what you can see would have to be an authentication
 * flow; this one only changes what you are offered, and saying so on the
 * control itself is cheaper than explaining it after someone assumes wrong.
 */
export function ActorSwitch() {
  const { actor, setActor } = useSync();
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const width = useShellWidth();

  /*
   * A volunteer's or official's device opens on its own home rather than the
   * resident advisory. Only from "/" and only for a non-resident actor, so a
   * resident is never redirected and nobody is trapped: choosing RESIDENT in
   * the switcher sets the actor first, which makes this a no-op.
   *
   * `replace`, not `push`, so the back button does not bounce between the two.
   */
  useEffect(() => {
    if (pathname !== "/" || actor === "resident") return;
    router.replace(actorById(actor).home);
  }, [pathname, actor, router]);

  return (
    <div className="shrink-0 border-b border-line-soft bg-ink-900">
      <div className={`mx-auto flex w-full items-center gap-2 px-3.5 py-1.5 ${width}`}>
        <span className="mono shrink-0 rounded-[2px] border border-line px-1.5 py-px text-[8.5px] font-bold tracking-[1px] text-paper-3">
          {t("actor.demo")}
        </span>

        <div
          className="flex flex-1 overflow-hidden rounded-[3px] border-[1.5px] border-line-soft"
          role="group"
          aria-label={t("actor.label")}
        >
          {ACTORS.map((a) => {
            const active = a.id === actor;
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setActor(a.id);
                  // Land on that actor's home, or the switch would leave the
                  // person on a screen their new tab bar cannot get back to.
                  router.push(actorById(a.id).home);
                }}
                className={`mono flex-1 px-2 py-1.5 text-[9.5px] font-bold tracking-[0.8px] transition-colors ${
                  active
                    ? "bg-hv text-hv-ink"
                    : "bg-ink-800 text-paper-3 hover:text-paper"
                }`}
              >
                {t(a.key)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
