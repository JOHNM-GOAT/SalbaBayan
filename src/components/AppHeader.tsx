"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useSync, useT } from "./AppRuntime";
import { LanguageSwitch } from "./LanguageSwitch";
import { SyncStrip } from "./SyncStrip";
import { useShellWidth } from "./Shell";
import { signalStyle } from "@/lib/signal";
import { dashboardMenu } from "@/lib/dashboardMenu";

/**
 * App chrome: severity rail, wordmark, language switch, sync strip.
 *
 * The rail is the ambient signal indicator that appears on every screen, so a
 * resident can tell the severity from across a room without reading. It is
 * grey until a signal level actually loads — never green, which would read as
 * "all clear" when the truth is "not yet known".
 */
export function AppHeader() {
  const { snapshot, actor } = useSync();
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
          {/* The barangay's mark. Plain <img>: one small PNG, no layout shift
              (the size is fixed here), and nothing for the optimizer to do. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={26} height={26} className="size-6.5 shrink-0 object-contain" />
          <span className="font-display text-base font-extrabold tracking-[0.4px]">
            SALBABAYAN
          </span>
        </div>

          <div className="flex items-center gap-1.5">
            <LanguageSwitch />
            {actor === "official" && <OfficialLinks />}
          </div>
        </div>
      </div>

      <SyncStrip />
    </header>
  );
}

const ICON_BUTTON =
  "flex size-8 items-center justify-center rounded-[3px] border-[1.5px] border-line-soft bg-ink-800 text-paper-2 hover:text-paper";

/**
 * Officials have no tab bar. The header carries what it held: ME, a way back
 * to the dashboard from any other screen, and on the dashboard the menu that
 * opens its right sidebar.
 */
function OfficialLinks() {
  const t = useT();
  const pathname = usePathname();
  const menuOpen = useSyncExternalStore(dashboardMenu.subscribe, dashboardMenu.get, () => false);
  const onDashboard = pathname === "/official";

  return (
    <>
      {!onDashboard && (
        <Link href="/official" aria-label={t("dash.home")} title={t("dash.home")} className={ICON_BUTTON}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6z" />
            <path d="M9 4v14" />
            <path d="M15 6v14" />
          </svg>
        </Link>
      )}
      <Link
        href="/profile"
        aria-label={t("nav.me")}
        title={t("nav.me")}
        aria-current={pathname === "/profile" ? "page" : undefined}
        className={`${ICON_BUTTON} ${pathname === "/profile" ? "border-hv text-hv" : ""}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
        </svg>
      </Link>
      {onDashboard && (
        <button
          type="button"
          onClick={() => dashboardMenu.set(!menuOpen)}
          aria-label={t("dash.menu")}
          title={t("dash.menu")}
          aria-expanded={menuOpen}
          aria-controls="dashboard-menu"
          className={`${ICON_BUTTON} ${menuOpen ? "border-hv bg-hv text-hv-ink hover:text-hv-ink" : ""}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      )}
    </>
  );
}
