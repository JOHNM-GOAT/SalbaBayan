"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSync, useT } from "./AppRuntime";
import { useShellWidth } from "./Shell";
import { actorById, activeHref, type NavIcon, type NavItem } from "@/lib/actors";
import { useRescueWaiting } from "./useRescueWaiting";

/**
 * The tab bar (design: `stage-2/design/artboards/Main.dc.html`).
 *
 * Ported from the artboard rather than re-invented, so the geometry matches
 * the approved design exactly: 74px tall, items aligned to the top with 9px of
 * padding, and the centre control lifted 19px out of the bar so it reads as
 * the primary action before anything is read at all.
 *
 * Which five items appear depends on the actor — see lib/actors.ts. The colour
 * rules still hold: high-vis cyan marks the current tab because cyan means
 * interactive, and alarm red appears on exactly one control in the product,
 * the resident's SOS, because it is the only one that raises an alarm.
 */

const ICONS: Record<NavIcon, { d: string[]; circle?: [number, number, number]; width: number }> = {
  home: { d: ["M3 11l9-8 9 8", "M5 10v10h14V10"], width: 2.2 },
  map: { d: ["M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6z", "M9 4v14", "M15 6v14"], width: 2 },
  sos: { d: ["M12 2v3", "M6 21v-6a6 6 0 0 1 12 0v6z", "M4 21h16"], width: 2.3 },
  drop: { d: ["M12 3s7 7.58 7 12a7 7 0 0 1-14 0c0-4.42 7-12 7-12z"], width: 2 },
  person: { d: ["M4 20c0-4 4-6 8-6s8 2 8 6"], circle: [12, 8, 4], width: 2 },
  scan: {
    d: ["M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8", "M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8", "M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16", "M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16", "M4 12h16"],
    width: 2.2,
  },
  count: { d: ["M4 20c0-3.3 3.6-5 8-5s8 1.7 8 5", "M17 5l2 2 3-3"], circle: [12, 7, 3.5], width: 2 },
  check: { d: ["M9 11l2.5 2.5L16 9", "M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z"], width: 2.1 },
  grid: { d: ["M3 4h18v16H3z", "M3 10h18", "M3 15h18", "M9 4v16", "M15 4v16"], width: 1.9 },
};

function Icon({ name, size }: { name: NavIcon; size: number }) {
  const spec = ICONS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={spec.width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {spec.circle && (
        <circle cx={spec.circle[0]} cy={spec.circle[1]} r={spec.circle[2]} />
      )}
      {spec.d.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export function BottomNav() {
  const { actor } = useSync();
  const t = useT();
  const pathname = usePathname();
  const width = useShellWidth();

  const current = actorById(actor);
  const active = activeHref(current, pathname);
  const rescue = useRescueWaiting();

  /*
   * Three outcomes, and the difference between the last two is the point:
   *
   *   - people waiting  -> the number, in alarm colour
   *   - nobody waiting  -> nothing, an all-clear this device actually earned
   *   - cannot say      -> a hollow dot, because offline or unpermitted is NOT
   *                        the same as zero, and a tab has no room to explain
   *                        it. The responder screen says which it is.
   */
  function badge(item: NavItem) {
    if (item.badge !== "rescue" || !rescue.isStaff) return null;

    if (rescue.count === null) {
      return (
        <span
          className="absolute -top-1 -right-1 size-2.5 rounded-full border-[1.5px] border-ink-800 bg-caution"
          aria-hidden
        />
      );
    }

    if (rescue.count === 0) return null;

    return (
      <span
        className="mono absolute -top-1.5 -right-1.5 min-w-[17px] rounded-full border-[1.5px] border-ink-800 bg-alarm px-1 text-center text-[9.5px] leading-[14px] font-bold text-[oklch(0.99_0.01_28)]"
        aria-hidden
      >
        {rescue.count}
      </span>
    );
  }

  /** The badge is decorative; the count belongs in the tab's accessible name. */
  function badgeLabel(item: NavItem): string | null {
    if (item.badge !== "rescue" || !rescue.isStaff) return null;
    return rescue.count === null
      ? `${t(item.key)} — ${t("vol.waiting_unknown")}`
      : `${t(item.key)} — ${rescue.count} ${t("vol.waiting")}`;
  }

  function tab(item: NavItem) {
    const isActive = item.href === active;
    const label = t(item.key);

    /*
     * The raised centre control. `-mt-[19px]` lifts it out of the bar and the
     * 2.5px ink-800 border cuts it back out of the bar's own fill, which is
     * what makes it read as sitting on top rather than overlapping.
     */
    if (item.raised) {
      return (
        <Link
          key={item.href}
          href={item.href}
          aria-label={badgeLabel(item) ?? label}
          aria-current={isActive ? "page" : undefined}
          className="-mt-[19px] flex shrink-0 basis-[66px] flex-col items-center gap-1"
        >
          <span
            className={`relative flex size-[50px] items-center justify-center rounded-instrument border-[2.5px] border-ink-800 ${
              item.alarm
                ? "bg-alarm text-[oklch(0.99_0.01_28)]"
                : "bg-hv text-hv-ink"
            }`}
          >
            <Icon name={item.icon} size={22} />
            {badge(item)}
          </span>
          <span
            className={`mono text-[9.5px] font-bold tracking-[1px] ${
              item.alarm ? "text-alarm" : "text-hv"
            }`}
          >
            {label}
          </span>
        </Link>
      );
    }

    return (
      <Link
        key={item.href}
        href={item.href}
        aria-label={badgeLabel(item) ?? undefined}
        aria-current={isActive ? "page" : undefined}
        className={`flex flex-1 flex-col items-center gap-1 transition-colors ${
          isActive ? "text-hv" : "text-paper-3 hover:text-paper-2"
        }`}
      >
        <Icon name={item.icon} size={20} />
        <span
          className={`text-[9.5px] tracking-[0.4px] ${
            isActive ? "font-extrabold" : "font-bold"
          }`}
        >
          {label}
        </span>
      </Link>
    );
  }

  return (
    /*
     * `sticky bottom-0` rather than `fixed`: it stays pinned to the bottom of
     * the viewport while content scrolls, but still occupies layout, so no
     * screen needs a magic padding-bottom to avoid being covered by it — and
     * none can forget to.
     */
    <nav className="sticky bottom-0 z-20 shrink-0 border-t-[1.5px] border-line bg-ink-800">
      <div
        className={`mx-auto flex w-full items-start px-1 pt-[9px] pb-[env(safe-area-inset-bottom)] ${width}`}
        style={{ minHeight: 74 }}
      >
        {current.nav.map(tab)}
      </div>
    </nav>
  );
}
