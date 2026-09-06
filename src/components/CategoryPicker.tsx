"use client";

import { useT } from "./AppRuntime";
import { CATEGORIES, type Category } from "@/lib/hazards";

/**
 * What did you see (PRD §7.7, FR-7.1).
 *
 * Icon-first, matching the approved report artboard. No core path here
 * requires reading (§8, literacy) — the pictures carry the meaning and the
 * labels confirm it.
 */

const ICONS: Record<Category, React.ReactNode> = {
  flooding: (
    <path d="M12 3s7 7.58 7 12a7 7 0 0 1-14 0c0-4.42 7-12 7-12z" />
  ),
  fallen_tree: (
    <>
      <path d="M4 20l7-12M11 8l3-5M11 8l4 2" />
      <path d="M2 20h20" />
    </>
  ),
  blocked_road: (
    <>
      <path d="M4 21L8 3M20 21L16 3" />
      <path d="M12 5v3M12 12v3M12 19v2" />
    </>
  ),
  downed_lines: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  other: (
    <>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </>
  ),
};

export function CategoryPicker({
  value,
  onChange,
}: {
  value: Category | null;
  onChange: (category: Category) => void;
}) {
  const t = useT();

  return (
    <div className="grid grid-cols-5 gap-2">
      {CATEGORIES.map((category) => {
        const active = value === category;
        return (
          <button
            key={category}
            type="button"
            onClick={() => onChange(category)}
            aria-pressed={active}
            className={`tap flex flex-col items-center justify-center gap-1.5 rounded-instrument border-[1.5px] py-2.5 transition-colors ${
              active
                ? "border-hv bg-hv-dim text-hv"
                : "border-line-soft bg-ink-800 text-paper-3"
            }`}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              {ICONS[category]}
            </svg>
            <span className="mono text-[8.5px] font-bold tracking-[0.5px]">
              {t(`cat.${category}`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
