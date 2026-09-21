"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSync, useT } from "./AppRuntime";
import { useMyRole } from "./useMyRole";
import { useShellWidth } from "./Shell";
import { ACTORS, actorById, type ActorId } from "@/lib/actors";

/** Which views each granted role may switch between. */
const VIEWS: Record<"resident" | "volunteer" | "official", readonly ActorId[]> = {
  resident: [],
  volunteer: ["resident", "volunteer"],
  official: ["resident", "volunteer", "official"],
};

/**
 * "View as" — lets staff see the app as a resident sees it, or switch between
 * their own screens (PRD §4: Resident, Volunteer, Official).
 *
 * Shown only to staff, and only for the views their granted role covers. It
 * changes navigation and nothing else: what a device may DO is decided by the
 * role RLS grants it (set_demo_role, the old self-promotion path, was dropped
 * in migration 0023). Residents never see it, so nobody is offered an
 * official's screens they would then be refused on.
 */
export function ActorSwitch() {
  const { actor, setActor } = useSync();
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const width = useShellWidth();
  const role = useMyRole();

  const views = role ? VIEWS[role] : [];

  /*
   * A device whose role no longer covers the chosen view (a volunteer removed,
   * an official logged out) goes back to the resident view, rather than being
   * left on screens that now refuse every action.
   */
  useEffect(() => {
    if (role === null || actor === "resident") return;
    if (!VIEWS[role].includes(actor)) {
      setActor("resident");
      router.replace(actorById("resident").home);
    }
  }, [role, actor, setActor, router]);

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
   * Never on the SOS screen: a control that navigates away must not sit a few
   * millimetres above the live status of a distress call.
   */
  if (pathname === "/sos" || views.length < 2) return null;

  return (
    <div className="shrink-0 border-b border-line-soft bg-ink-900">
      <div className={`mx-auto flex w-full items-center gap-2 px-3.5 py-1.5 ${width}`}>
        <span className="mono shrink-0 text-[8.5px] font-bold tracking-[1px] text-paper-3">
          {t("actor.label")}
        </span>

        <div
          className="flex flex-1 overflow-hidden rounded-[3px] border-[1.5px] border-line-soft"
          role="group"
          aria-label={t("actor.label")}
        >
          {ACTORS.filter((a) => views.includes(a.id)).map((a) => {
            const active = a.id === actor;
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setActor(a.id);
                  // Land on that view's home, or the new tab bar could not get back.
                  router.push(actorById(a.id).home);
                }}
                className={`mono flex-1 px-2 py-1.5 text-[9.5px] font-bold tracking-[0.8px] transition-colors ${
                  active ? "bg-hv text-hv-ink" : "bg-ink-800 text-paper-3 hover:text-paper"
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
