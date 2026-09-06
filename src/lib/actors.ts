/**
 * The three actors (PRD §4) and the navigation each one gets.
 *
 * Resident, Volunteer and Official do genuinely different jobs, and until now
 * they all shared one home screen with every destination in the product piled
 * into a single row. That row was unreadable on a phone and, worse, it made a
 * resident scan past "COVERAGE" and "RESPONDER" to find the thing they came
 * for. Each actor now has its own home and its own five-item tab bar holding
 * only what that person actually does.
 *
 * IMPORTANT — this is presentation, not permission. Choosing an actor changes
 * which screens are offered, nothing else. Every screen still reads and writes
 * through the same RLS policies, so a resident who selects "Official" sees the
 * official's navigation and then gets exactly the rows RLS grants them, which
 * for the roster tables is none. The real boundary is in Postgres and it does
 * not move. That is what makes it safe to let anyone switch freely for a demo.
 */

export type ActorId = "resident" | "volunteer" | "official";

/** Which icon to draw. Kept as a name so this module stays free of JSX. */
export type NavIcon = "home" | "map" | "sos" | "drop" | "person" | "scan" | "count" | "check" | "grid";

export type NavItem = {
  href: string;
  /** Translation key for the label. */
  key: string;
  icon: NavIcon;
  /**
   * The raised centre control. At most one per actor, and it is the action
   * that person reaches for without thinking.
   */
  raised?: boolean;
  /**
   * Alarm colour, allowed ONLY where the control raises an actual alarm.
   * The design rule is that the severity ramp means severity and nothing else,
   * so a volunteer's scan button is high-vis cyan (interactive) rather than
   * red — it is frequent, not urgent.
   */
  alarm?: boolean;
};

export type Actor = {
  id: ActorId;
  /** Translation key for the switcher label. */
  key: string;
  home: string;
  nav: NavItem[];
};

export const ACTORS: readonly Actor[] = [
  {
    id: "resident",
    key: "actor.resident",
    home: "/",
    nav: [
      { href: "/", key: "nav.home", icon: "home" },
      { href: "/map", key: "nav.map", icon: "map" },
      { href: "/sos", key: "nav.sos", icon: "sos", raised: true, alarm: true },
      { href: "/report", key: "nav.report", icon: "drop" },
      { href: "/profile", key: "nav.me", icon: "person" },
    ],
  },
  {
    id: "volunteer",
    key: "actor.volunteer",
    home: "/volunteer",
    nav: [
      { href: "/volunteer", key: "nav.home", icon: "home" },
      { href: "/headcount", key: "nav.count", icon: "count" },
      // The volunteer's most-repeated action, so it takes the centre slot —
      // in cyan, because scanning a card is routine, not an emergency.
      { href: "/checkin", key: "nav.scan", icon: "scan", raised: true },
      { href: "/map", key: "nav.map", icon: "map" },
      { href: "/profile", key: "nav.me", icon: "person" },
    ],
  },
  {
    id: "official",
    key: "actor.official",
    home: "/official",
    nav: [
      { href: "/official", key: "nav.home", icon: "home" },
      { href: "/readiness", key: "nav.ready", icon: "check" },
      { href: "/responder", key: "nav.rescue", icon: "sos", raised: true },
      { href: "/coverage", key: "nav.coverage", icon: "grid" },
      { href: "/profile", key: "nav.me", icon: "person" },
    ],
  },
];

export function isActorId(value: unknown): value is ActorId {
  return ACTORS.some((a) => a.id === value);
}

export function actorById(id: ActorId): Actor {
  // Non-null: ACTORS covers every member of the union, and `id` is that union.
  return ACTORS.find((a) => a.id === id)!;
}

/**
 * The actor a device should start as, from the role RLS actually grants it.
 * A volunteer's phone opens on the volunteer home without anyone choosing it;
 * the switcher exists to override this, not to establish it.
 */
export function actorForRole(role: "resident" | "volunteer" | "official"): ActorId {
  return role;
}

/**
 * Which nav item a pathname belongs to, for the active state.
 *
 * Longest matching href wins so that a nested route highlights its parent
 * rather than falling through to "/", which every path would otherwise match.
 */
export function activeHref(actor: Actor, pathname: string): string | null {
  let best: string | null = null;
  for (const item of actor.nav) {
    const hit =
      item.href === "/"
        ? pathname === "/"
        : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (hit && (best === null || item.href.length > best.length)) best = item.href;
  }
  return best;
}
