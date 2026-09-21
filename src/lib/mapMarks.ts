import * as maplibregl from "maplibre-gl";
import { resolveColour } from "./signal";
import type { Category } from "./hazards";

/**
 * The marks both maps draw — the evacuation map and the hazard sheet — so the
 * two read as one map rather than two.
 *
 * Places (hazards, the evacuation centre) are teardrop pins anchored at their
 * tip: the tip is the exact reported point, and the head sits above it, so a
 * pin never hides the spot it marks. The device's own position is a blue dot,
 * the convention of every map app, so it cannot be read as a place.
 *
 * Category is carried by the icon, not only by colour: roughly a tenth of
 * Filipino men cannot separate red from green.
 */

export const HAZARD_ICON: Record<Category, string> = {
  flooding: "<path d='M12 3s7 7.58 7 12a7 7 0 0 1-14 0c0-4.42 7-12 7-12z'/>",
  fallen_tree:
    "<path d='M12 22v-5'/><path d='M12 17l-6-5h3.2L5 7.5h3.2L12 2l3.8 5.5H19L15.8 12H19z'/>",
  blocked_road: "<path d='M3 20h18'/><path d='M8.5 20 12 4l3.5 16'/><path d='M9.6 12h4.8'/>",
  downed_lines: "<path d='M13 2 4 14h6l-1 8 9-12h-6z'/>",
  other: "<path d='M12 7v6'/><path d='M12 17h.01'/><circle cx='12' cy='12' r='9'/>",
};

export const CENTRE_ICON =
  "<path d='M3 11.5 12 4l9 7.5'/><path d='M5.5 10v10h13V10'/><path d='M10 20v-5.5h4V20'/>";

/** The pin body: 28 wide, 36 tall, tip at (14, 36). */
const TEARDROP = "M14 1C6.8 1 1 6.7 1 13.8 1 23.2 14 35 14 35s13-11.8 13-21.2C27 6.7 21.2 1 14 1z";

/** A teardrop pin as markup, for the map and for the legend alike. */
export function teardropSvg(colour: string, icon: string, height = 36): string {
  const ground = resolveColour("var(--color-ink-900)");
  const fill = resolveColour(colour);
  const width = (height * 28) / 36;
  return (
    `<svg width="${width}" height="${height}" viewBox="0 0 28 36" aria-hidden="true" style="display:block;overflow:visible">` +
    `<path d="${TEARDROP}" fill="${fill}" stroke="${ground}" stroke-width="2"/>` +
    `<svg x="7" y="6.5" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${ground}"` +
    ` stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>` +
    `</svg>`
  );
}

/** A pin element. Interactive pins are buttons; the rest ignore the pointer. */
export function pinElement({
  colour,
  icon,
  label,
  height = 36,
  onClick,
}: {
  colour: string;
  icon: string;
  label: string;
  height?: number;
  onClick?: () => void;
}): HTMLElement {
  const el = document.createElement(onClick ? "button" : "div");
  if (el instanceof HTMLButtonElement) el.type = "button";
  el.setAttribute("aria-label", label);
  el.style.cssText = [
    "padding:0",
    "border:0",
    "background:none",
    "line-height:0",
    "filter:drop-shadow(0 1.5px 2px rgba(0,0,0,0.35))",
    onClick ? "cursor:pointer" : "pointer-events:none",
  ].join(";");
  el.innerHTML = teardropSvg(colour, icon, height);
  if (onClick) el.addEventListener("click", onClick);
  return el;
}

/** A marker anchored at the pin's tip, so the tip is the exact point. */
export function pinMarker(el: HTMLElement, lng: number, lat: number): maplibregl.Marker {
  return new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]);
}

export function hazardColour(tone: "alarm" | "caution"): string {
  return `var(--color-${tone})`;
}

/** The device's own position: a blue dot with a white rim and a soft halo. */
export function youElement(onClick?: () => void, label = ""): HTMLElement {
  const blue = resolveColour("var(--color-you)");
  const el = document.createElement(onClick ? "button" : "div");
  if (el instanceof HTMLButtonElement) el.type = "button";
  if (label) el.setAttribute("aria-label", label);
  if (onClick) el.addEventListener("click", onClick);
  el.style.cssText = [
    "padding:0",
    "width:16px",
    "height:16px",
    "border-radius:50%",
    `background:${blue}`,
    "border:3px solid #fff",
    `box-shadow:0 0 0 7px color-mix(in oklab, ${blue} 22%, transparent), 0 1px 3px rgba(0,0,0,0.35)`,
    onClick ? "cursor:pointer" : "pointer-events:none",
  ].join(";");
  return el;
}
