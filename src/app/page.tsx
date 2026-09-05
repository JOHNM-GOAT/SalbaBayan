import { SyncStrip } from "@/components/SyncStrip";

/**
 * Phase 0 shell.
 *
 * Deliberately minimal: the Phase 0 gate is "a full page reload in airplane
 * mode boots the app shell to a blank-but-functional layout". The advisory
 * itself is Phase 1. What must work here is the chrome — severity rail,
 * header, and the persistent sync strip — with no network.
 */
export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col bg-ink-900">
      {/* Severity rail — ambient signal level on every screen. Grey until a
          barangay signal level is loaded, never a default colour that could
          read as "safe". */}
      <div className="h-[5px] shrink-0 bg-ink-600" />

      <header className="shrink-0 border-b border-line-soft bg-ink-800">
        <div className="flex items-center justify-between px-3.5 py-3">
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
        </div>
        <SyncStrip />
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="lbl">PHASE 0 — FOUNDATION</p>
        <p className="max-w-xs text-sm text-paper-2">
          App shell boots. Offline queue and anonymous session are live.
          Advisory arrives in Phase 1.
        </p>
      </main>
    </div>
  );
}
