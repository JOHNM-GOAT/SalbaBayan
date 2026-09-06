"use client";

import { useSync } from "./AppRuntime";
import { LanguageSwitch } from "./LanguageSwitch";
import { SyncStrip } from "./SyncStrip";
import { useShellWidth } from "./Shell";
import { signalStyle } from "@/lib/signal";

/**
 * App chrome: severity rail, wordmark, language switch, sync strip.
 *
 * The rail is the ambient signal indicator that appears on every screen, so a
 * resident can tell the severity from across a room without reading. It is
 * grey until a signal level actually loads — never green, which would read as
 * "all clear" when the truth is "not yet known".
 */
export function AppHeader() {
  const { snapshot } = useSync();
  const level = snapshot?.barangay.current_signal_level;
  const rail = level === undefined ? "bg-ink-600" : signalStyle(level).bg;
  const width = useShellWidth();

  return (
    <header className="shrink-0">
      {/* Full-bleed by design: the rail is read from across a room. */}
      <div className={`h-[5px] shrink-0 ${rail}`} aria-hidden />

      <div className="border-b border-line-soft bg-ink-800">
        <div
          className={`mx-auto flex w-full items-center justify-between px-3.5 py-3 ${width}`}
        >
        <div className="flex items-center gap-2.5">
          <div className="flex size-6.5 items-center justify-center rounded-[3px] bg-hv text-hv-ink">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" />
              <path d="M12 8v5" />
              <path d="M12 16h.01" />
            </svg>
          </div>
          <span className="font-display text-base font-extrabold tracking-[0.4px]">
            SALBABAYAN
          </span>
        </div>

          <LanguageSwitch />
        </div>
      </div>

      <SyncStrip />
    </header>
  );
}
