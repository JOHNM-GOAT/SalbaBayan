/**
 * Signal-level presentation.
 *
 * The severity ramp means SEVERITY and nothing else (see globals.css). It is
 * never used for a button, a link, or a piece of chrome — so it lives in one
 * table here rather than being reached for ad hoc across components.
 *
 * Class names are written out in full because Tailwind scans source text: a
 * constructed `bg-signal-${n}` produces no CSS at all.
 */

export type SignalStyle = {
  /** Filled placard background. */
  bg: string;
  /** Text on that filled background — the ramp's light end needs dark ink. */
  ink: string;
  /** The ramp colour as text, for headlines and countdowns. */
  text: string;
  border: string;
  /** Raw token, for the hazard-stripe gradient and the severity rail. */
  cssVar: string;
};

/**
 * Level 0 is "no active signal", and it is grey on purpose. A green level 0
 * would read as "all clear" when the truth is "nobody has set this yet" —
 * the same reason `current_signal_level` is `not null default 0` rather than
 * nullable.
 */
export const SIGNAL_STYLES: Record<number, SignalStyle> = {
  0: {
    bg: "bg-ink-600",
    ink: "text-paper",
    text: "text-paper-2",
    border: "border-ink-600",
    cssVar: "var(--color-ink-600)",
  },
  1: {
    bg: "bg-signal-1",
    ink: "text-ink-900",
    text: "text-signal-1",
    border: "border-signal-1",
    cssVar: "var(--color-signal-1)",
  },
  2: {
    bg: "bg-signal-2",
    ink: "text-ink-900",
    text: "text-signal-2",
    border: "border-signal-2",
    cssVar: "var(--color-signal-2)",
  },
  3: {
    bg: "bg-signal-3",
    ink: "text-ink-900",
    text: "text-signal-3",
    border: "border-signal-3",
    cssVar: "var(--color-signal-3)",
  },
  4: {
    bg: "bg-signal-4",
    ink: "text-paper",
    text: "text-signal-4",
    border: "border-signal-4",
    cssVar: "var(--color-signal-4)",
  },
  5: {
    bg: "bg-signal-5",
    ink: "text-paper",
    text: "text-signal-5",
    border: "border-signal-5",
    cssVar: "var(--color-signal-5)",
  },
};

export function signalStyle(level: number): SignalStyle {
  return SIGNAL_STYLES[level] ?? SIGNAL_STYLES[0];
}

/**
 * Time remaining, rendered the way a countdown to a deadline should read.
 *
 * Past deadlines return null rather than a negative duration: once the moment
 * has passed, "-14m" is noise. The caller shows an expired state instead.
 */
export function formatRemaining(target: Date, now: number): string | null {
  const ms = target.getTime() - now;
  if (ms <= 0) return null;

  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Wall-clock time in the form the design uses: `6:00 PM`. */
export function formatClock(date: Date): string {
  return date
    .toLocaleTimeString("en-PH", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toUpperCase();
}
