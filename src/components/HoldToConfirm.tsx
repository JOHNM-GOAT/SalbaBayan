"use client";

import { useEffect, useRef, useState } from "react";

const HOLD_MS = 1800;

/**
 * A control that acts only after a sustained hold.
 *
 * Extracted from the SOS screen's hold-to-cancel (FR-4.5) when changing the
 * barangay's signal needed the same protection. Both are actions a mis-tap must
 * not be able to take: withdrawing a distress call, and telling a whole
 * barangay to evacuate or to go home. A tap — even a tap plus a confirm dialog —
 * is too easy to do by accident, and a dialog is dismissed unread by someone
 * working fast.
 *
 * A sustained hold cannot happen by accident, and the filling bar makes the
 * consequence legible without words. Releasing early aborts, and the progress
 * resets rather than resuming, so a half-press is never banked.
 *
 * The fill is `alarm` for SOS and `accent` for everything else. It is never a
 * severity colour: the signal ramp means severity and nothing else, and a
 * button filling in Signal 4's orange would be the ramp used as decoration.
 */
export function HoldToConfirm({
  label,
  holdingLabel,
  tone,
  onConfirm,
}: {
  label: string;
  holdingLabel: string;
  tone: "alarm" | "accent";
  onConfirm: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const startedAt = useRef<number | null>(null);
  const frame = useRef<number | null>(null);

  /*
   * `onConfirm` is held in a ref so it is NOT an effect dependency.
   *
   * This was a real bug, not a theoretical one. The SOS screen re-renders every
   * second for its elapsed timer and hands down a fresh callback each time. With
   * that identity in the dependency array the effect tore down and re-ran every
   * second — and because the effect was also where the clock started, every
   * re-run reset the hold to zero. A 1.8s hold interrupted every 1.0s can never
   * complete. The advisory screen re-renders on every keystroke, so it would hit
   * the same wall.
   *
   * A ref rather than asking callers for `useCallback`, deliberately: a control
   * whose correctness depends on every caller remembering to memoise a prop is a
   * control that breaks the next time someone uses it.
   */
  const onConfirmRef = useRef(onConfirm);
  useEffect(() => {
    onConfirmRef.current = onConfirm;
  });

  useEffect(() => {
    if (!holding) return;

    const tick = () => {
      // `startedAt` is stamped at pointer-down, not here, so that even a
      // legitimate re-run of this effect cannot restart the clock.
      const held = Date.now() - (startedAt.current ?? Date.now());
      const next = Math.min(1, held / HOLD_MS);
      setProgress(next);

      if (next >= 1) {
        setHolding(false);
        setProgress(0);
        onConfirmRef.current();
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [holding]);

  const start = () => {
    startedAt.current = Date.now();
    setHolding(true);
  };

  const stop = () => {
    startedAt.current = null;
    setHolding(false);
    setProgress(0);
  };

  return (
    <button
      type="button"
      // Pointer events cover mouse, touch and pen with one path. `onPointerLeave`
      // matters: dragging a thumb off the control must abort, not complete.
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      className="tap relative w-full overflow-hidden rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-4 py-3 text-center select-none"
    >
      <span
        // Written out in full: Tailwind scans source text, so a class built
        // from `tone` would produce no CSS at all.
        className={`absolute inset-y-0 left-0 transition-none ${
          tone === "alarm" ? "bg-alarm/25" : "bg-hv/25"
        }`}
        style={{ width: `${progress * 100}%` }}
        aria-hidden
      />
      <span className="relative flex items-center justify-center gap-2 text-[13px] font-semibold text-paper-2">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        {holding ? holdingLabel : label}
      </span>
    </button>
  );
}
