"use client";

import { useT } from "./AppRuntime";
import { DEPTHS, type Depth } from "@/lib/water";

/**
 * The body-referenced depth scale (PRD §7.6, FR-6.1).
 *
 * Each option is a figure with the water drawn at the matching height. The
 * picture is the question — someone can answer it without reading the label,
 * which matters because the people most likely to be standing in floodwater
 * are not always the people most comfortable reading a form.
 *
 * Colour comes from the state palette (clear/caution/alarm), never the signal
 * ramp. Chest-deep water is dangerous, but it is not a storm signal level, and
 * reusing the ramp would blur the one rule the colour system has.
 */

/** Water surface height for each step, as a fraction of the figure box. */
const WATER_TOP: Record<Depth, number> = {
  knee: 0.72,
  waist: 0.52,
  chest: 0.36,
  above_head: 0.06,
};

const TONE: Record<Depth, string> = {
  knee: "var(--color-clear)",
  waist: "var(--color-caution)",
  chest: "var(--color-alarm)",
  above_head: "var(--color-signal-5)",
};

function Figure({ depth, active }: { depth: Depth; active: boolean }) {
  const top = WATER_TOP[depth] * 100;
  const colour = TONE[depth];

  return (
    <svg viewBox="0 0 60 74" className="h-[74px] w-full" aria-hidden>
      {/* Water first, so the body reads as standing IN it rather than beside
          it. Above-head covers the figure entirely, which is the point. */}
      <rect
        x="4"
        y={top * 0.74}
        width="52"
        height={74 - top * 0.74}
        fill={colour}
        opacity={active ? 0.32 : 0.16}
      />
      <rect
        x="4"
        y={top * 0.74}
        width="52"
        height="2"
        fill={colour}
        opacity={active ? 1 : 0.55}
      />

      <g
        stroke={active ? "var(--color-paper)" : "var(--color-paper-3)"}
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      >
        <circle cx="30" cy="13" r="6" fill={active ? "var(--color-paper)" : "var(--color-paper-3)"} stroke="none" />
        <path d="M30 20v24" />
        <path d="M30 26l-9 8M30 26l9 8" />
        <path d="M30 44l-8 17M30 44l8 17" />
      </g>
    </svg>
  );
}

export function DepthPicker({
  value,
  onChange,
}: {
  value: Depth | null;
  onChange: (depth: Depth) => void;
}) {
  const t = useT();

  return (
    <div className="grid grid-cols-4 gap-2">
      {DEPTHS.map((depth) => {
        const active = value === depth;
        return (
          <button
            key={depth}
            type="button"
            onClick={() => onChange(depth)}
            aria-pressed={active}
            className={`flex flex-col items-center gap-1.5 overflow-hidden rounded-instrument border-[1.5px] pt-2 pb-2 transition-colors ${
              active
                ? "border-caution bg-caution/10"
                : "border-line-soft bg-ink-800"
            }`}
          >
            <Figure depth={depth} active={active} />
            <span
              className={`mono text-[9.5px] font-bold tracking-[0.7px] ${
                active ? "text-caution" : "text-paper-3"
              }`}
            >
              {t(`water.${depth}`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
