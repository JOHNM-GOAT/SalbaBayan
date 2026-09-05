"use client";

import { useSync, useT } from "./AppRuntime";

/**
 * Purok selector (PRD §7.1 — the advisory is per-Purok, not per-barangay).
 *
 * A native <select> rather than a custom dropdown, deliberately. It is
 * keyboard- and screen-reader-correct for free, it renders as the platform's
 * own picker on a low-end Android handset, and it cannot break in the one
 * situation where this app has to work. The visible row is styling laid under
 * a transparent native control, so the picker is genuinely native.
 *
 * Switching Purok re-derives from the snapshot already in memory — no fetch,
 * so it works offline.
 */
export function PurokBar() {
  const { snapshot, purokId, setPurokId } = useSync();
  const t = useT();

  if (!snapshot) return null;

  const { barangay, puroks } = snapshot;
  const current = puroks.find((p) => p.id === purokId) ?? puroks[0];

  return (
    <div className="relative flex h-11 items-center border-b border-line-soft bg-ink-800 px-3.5">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-hv)"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
        aria-hidden
      >
        <path d="M12 22s7-7.58 7-13a7 7 0 0 0-14 0c0 5.42 7 13 7 13z" />
        <circle cx="12" cy="9" r="2.5" />
      </svg>

      <span className="ml-2 text-[13.5px] font-bold">{current?.name}</span>
      <span className="ml-2 flex-1 truncate text-[13px] text-paper-3">
        Brgy. {barangay.name}
      </span>

      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-paper-3)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
        aria-hidden
      >
        <path d="M6 9l6 6 6-6" />
      </svg>

      <select
        aria-label={t("ui.purok")}
        value={current?.id ?? ""}
        onChange={(event) => setPurokId(event.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {puroks.map((purok) => (
          <option key={purok.id} value={purok.id}>
            {purok.name}
          </option>
        ))}
      </select>
    </div>
  );
}
