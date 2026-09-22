"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSync, useT } from "./AppRuntime";
import { useMyRole } from "./useMyRole";
import { ACTORS, actorById, type ActorId } from "@/lib/actors";

/** Which views each granted role may switch between. */
const VIEWS: Record<"resident" | "volunteer" | "official", readonly ActorId[]> = {
  resident: [],
  volunteer: ["resident", "volunteer"],
  official: ["resident", "volunteer", "official"],
};

/**
 * Keeps the chosen view in step with the granted role, on every screen.
 * Mounted once in the layout; renders nothing. What a device may DO is decided
 * by the role RLS grants it — the view only changes navigation.
 */
export function ActorRouting() {
  const { actor, setActor } = useSync();
  const router = useRouter();
  const pathname = usePathname();
  const role = useMyRole();

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
   * resident advisory. Only from "/" and only for a non-resident view, so a
   * resident is never redirected and nobody is trapped: choosing RESIDENT sets
   * the view first, which makes this a no-op.
   */
  useEffect(() => {
    if (pathname !== "/" || actor === "resident") return;
    router.replace(actorById(actor).home);
  }, [pathname, actor, router]);

  return null;
}

/**
 * "View as" — on the ME tab. Lets staff see the app as a resident sees it, or
 * move between their own screens. Shown only to staff, and only for the views
 * their granted role covers; residents never see it.
 */
export function ActorSwitch() {
  const { actor, setActor } = useSync();
  const t = useT();
  const router = useRouter();
  const role = useMyRole();

  const views = role ? VIEWS[role] : [];
  if (views.length < 2) return null;

  return (
    <section className="grid gap-2 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3.5 py-3">
      <p className="lbl">{t("actor.label")}</p>
      <div
        className="flex overflow-hidden rounded-[3px] border-[1.5px] border-line-soft"
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
              className={`tap mono flex-1 px-2 text-[10px] font-bold tracking-[0.8px] transition-colors ${
                active ? "bg-hv text-hv-ink" : "bg-ink-900 text-paper-3 hover:text-paper"
              }`}
            >
              {t(a.key)}
            </button>
          );
        })}
      </div>
    </section>
  );
}
