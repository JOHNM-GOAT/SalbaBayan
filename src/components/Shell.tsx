"use client";

import { useSync } from "./AppRuntime";

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
/*
 * Width follows the ACTOR, not the route, and that distinction was learned the
 * hard way. Route-based widths meant an official moving HOME -> READY -> GRID
 * watched the column jump between 34rem and 76rem — and since the header and
 * tab bar align to that column, the navigation resized under their finger
 * between taps. Nothing about a person's screen should change size because
 * they looked at a different part of it.
 *
 * So: the official works from a laptop at the barangay hall (PRD §4) and gets
 * the wide shell everywhere. The resident and the volunteer are holding phones
 * — a resident in the rain, a volunteer at a centre door — and their screens
 * are designed at that size, so on a larger display they become a centred
 * column rather than a stretched one. Stretching a 44px control to 1400px does
 * not make it easier to hit.
 */
const WIDE_ACTORS = new Set(["official"]);

/** The Tailwind max-width this actor's content is held to. */
export function useShellWidth(): string {
  const { actor } = useSync();
  return WIDE_ACTORS.has(actor) ? "max-w-[76rem]" : "max-w-[34rem]";
}

/**
 * Wraps page content. Kept as `flex flex-1 flex-col` because the evacuation
 * map sizes itself through an unbroken flex chain from `min-h-dvh` down to its
 * container — a single `height: auto` anywhere in that chain collapses it to
 * zero and the map renders blank. Adding a level here is safe only because
 * this one keeps the chain intact.
 *
 * `@container` is what makes the actor-based width above safe. Pages lay
 * themselves out against THIS column's width (`@2xl:`, `@4xl:`) rather than
 * the viewport's, so a two-column grid appears when there are two columns'
 * worth of room. Viewport breakpoints would have put the responder's map and
 * queue side by side inside a 34rem column the moment the window passed
 * 1024px, which is exactly the squashed layout they were added to prevent.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const width = useShellWidth();
  return (
    <div className={`@container mx-auto flex w-full flex-1 flex-col ${width}`}>
      {children}
    </div>
  );
}
