"use client";

import { usePathname } from "next/navigation";

/**
 * The responsive shell.
 *
 * Every screen in this app was designed at phone width, and that is not a
 * limitation to grow out of — a resident holding a phone in the rain is the
 * primary case, and the thumb-zone geometry the controls depend on only works
 * at that size. So on a wider screen the answer is a **centred column**, not a
 * stretched one. Stretching a 44px control to 1400px does not make it easier
 * to hit; it just makes the line lengths unreadable and the layout look
 * broken.
 *
 * The exception is the staff screens. PRD §4 says the official "works from a
 * laptop at the barangay hall", and NFR-5.3 assumes phones *and* laptops. On
 * those routes the extra width buys something real — the rescue queue beside
 * its map instead of scrolled away below it, the coverage matrix without a
 * horizontal scroll — so they opt into a wider shell and rearrange into
 * columns at `lg:`. Width is only taken where it is used.
 */
const WIDE_ROUTES = new Set([
  "/responder", // dispatch — the rescue queue beside its live map
  "/coverage", // pre-season configuration — 8 Puroks x 5 levels, no sideways scroll
  "/readiness", // pre-season configuration — checks in two columns
  "/map", // a map is worth every pixel it is given, on any device
]);

/*
 * Deliberately NOT wide: `/headcount` and `/checkin`. Both are operated by a
 * volunteer standing at an evacuation centre holding a phone — the +1/-1
 * controls and the camera framing are the design, and stretching them across a
 * laptop would serve nobody who actually uses those screens. `/`, `/sos` and
 * `/report` are resident screens for the same reason.
 */

/** The Tailwind max-width this route's content should be held to. */
export function useShellWidth(): string {
  const pathname = usePathname();
  return WIDE_ROUTES.has(pathname) ? "max-w-[76rem]" : "max-w-[34rem]";
}

/**
 * Wraps page content. Kept as `flex flex-1 flex-col` because the evacuation
 * map sizes itself through an unbroken flex chain from `min-h-dvh` down to its
 * container — a single `height: auto` anywhere in that chain collapses it to
 * zero and the map renders blank. Adding a level here is safe only because
 * this one keeps the chain intact.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const width = useShellWidth();
  return (
    <div className={`mx-auto flex w-full flex-1 flex-col ${width}`}>
      {children}
    </div>
  );
}
