"use client";

import { useT } from "./AppRuntime";

/**
 * "Put the barangay back on the screen."
 *
 * The same control, in the same place, on all four maps — the resident's, the
 * hazard sheet's, the volunteer's and the official's. Somebody who has panned
 * away looking for a street has one gesture to learn, and it is the same one
 * wherever they are in the app.
 *
 * Placement is the caller's, because the top-right corner is not free on every
 * map: the rescue map has its queue button there and the dashboard its SHOW
 * ALL. Each passes a position that puts this in the top-right where that
 * corner is empty and directly under whatever is already there when it is not,
 * and on a phone drops it into the column of round controls above the zoom
 * buttons — where nothing is ever drawn over the map.
 */
export function BarangayButton({
  onClick,
  className,
}: {
  onClick: () => void;
  /** Where this sits on a given map. See the note above. */
  className: string;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("map.show_barangay")}
      title={t("map.show_barangay")}
      className={`tap absolute z-10 flex size-11 items-center justify-center rounded-[3px] border-[1.5px] border-line bg-ink-800/95 shadow-md ${className}`}
    >
      {/*
        Corner brackets round a dot: "bring it all back into view". Not a pin —
        a pin on these maps means a report, and the ramp of meanings this app
        keeps straight is worth more than a prettier icon.
      */}
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-hv)"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9" />
        <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9" />
        <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15" />
        <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
        <circle cx="12" cy="12" r="2.4" />
      </svg>
    </button>
  );
}
