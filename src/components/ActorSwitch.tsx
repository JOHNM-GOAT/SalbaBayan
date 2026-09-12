"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSync, useT } from "./AppRuntime";
import { setDemoRole } from "@/lib/supabase";
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
 * It is labelled DEMO on screen, deliberately and permanently — and that label
 * now carries more weight than it used to.
 *
 * This USED to change navigation and nothing else, on the argument that a
 * control which changed what you can see would have to be an authentication
 * flow. The argument was sound and the result was a demo that could not show
 * the volunteer's central action: selecting VOLUNTEER gave you the volunteer's
 * tab bar and then refused to let you mark a hazard fixed, because the role RLS
 * checks lives in the database and the switcher never touched it. Every device
 * in the room had to be hand-granted a role first.
 *
 * So switching now calls `set_demo_role`, which grants the device the role it
 * selected. That IS a self-promotion path: anyone who opens the app can make
 * themselves an official. It is confined to one droppable function so it can be
 * closed in a single statement — see migration 0017, which carries the full
 * argument and the one line that removes it. If that function is dropped, this
 * component keeps working and quietly goes back to changing navigation only.
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

  /*
   * Never on the SOS screen.
   *
   * This is a demo affordance that NAVIGATES AWAY, sitting a few millimetres
   * above the live status of a distress call. A resident watching their own
   * SOS timer, in the dark, with wet hands, must not be one stray thumb from
   * an official's dashboard. The request would survive — it is already durable
   * — but the person would lose the screen telling them help is coming, at the
   * moment they most need to see it.
   */
  if (pathname === "/sos") return null;

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
                  /*
                   * Not awaited. The tab bar and the destination should change
                   * under the thumb immediately; the grant lands a moment later
                   * and announces itself, and every screen holding a role
                   * re-reads then (see onRoleChanged). Making the navigation
                   * wait on a round trip would make the demo feel broken on
                   * exactly the connection this product is built for.
                   */
                  void setDemoRole(a.id);
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
