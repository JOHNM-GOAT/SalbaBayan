"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "./AppRuntime";

const HOLD_MS = 1800;

/**
 * Hold-to-cancel (FR-4.5).
 *
 * Cancelling a distress call is the one destructive action a frightened person
 * can take on this screen, usually while holding a phone in the dark with wet
 * hands. A tap — even a tap plus a confirm dialog — is too easy to do by
 * accident, and a dialog is worse than useless when someone is dismissing
 * everything in front of them without reading.
 *
 * A sustained hold cannot happen by accident, and the filling bar makes the
 * consequence legible without words. Releasing early aborts, and the progress
 * resets rather than resuming, so a half-press is never banked.
 */
export function HoldToCancel({ onCancel }: { onCancel: () => void }) {
  const t = useT();
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const startedAt = useRef<number | null>(null);
  const frame = useRef<number | null>(null);

  /*
   * `onCancel` is held in a ref so it is NOT an effect dependency.
   *
   * This is the whole bug, and it was not theoretical: the SOS screen runs a
   * one-second interval for the elapsed timer, so it re-renders every second
   * and hands down a fresh `onCancel` identity each time. With that identity
   * in the dependency array the effect tore down and re-ran every second — and
   * because the effect was also where the clock started, every re-run reset
   * the hold to zero. A 1.8s hold interrupted every 1.0s can never complete:
   * the bar filled to about half, snapped back, and started again for as long
   * as the person kept their thumb down. The one destructive action on the
   * screen was unreachable, and it looked like the app ignoring them.
   *
   * A ref rather than asking the caller for a `useCallback`, deliberately: a
   * control whose correctness depends on every caller remembering to memoise a
   * prop is a control that will break again the next time someone uses it.
   */
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
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
        onCancelRef.current();
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
        className="absolute inset-y-0 left-0 bg-alarm/25 transition-none"
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
        {holding ? t("sos.cancelling") : t("sos.hold_cancel")}
      </span>
    </button>
  );
}
