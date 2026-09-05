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

  useEffect(() => {
    if (!holding) return;

    startedAt.current = Date.now();
    const tick = () => {
      const held = Date.now() - (startedAt.current ?? Date.now());
      const next = Math.min(1, held / HOLD_MS);
      setProgress(next);

      if (next >= 1) {
        setHolding(false);
        setProgress(0);
        onCancel();
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [holding, onCancel]);

  const stop = () => {
    setHolding(false);
    setProgress(0);
  };

  return (
    <button
      type="button"
      // Pointer events cover mouse, touch and pen with one path. `onPointerLeave`
      // matters: dragging a thumb off the control must abort, not complete.
      onPointerDown={() => setHolding(true)}
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
