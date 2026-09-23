"use client";

import { useT } from "./AppRuntime";
import { useTheme } from "./useTheme";

/**
 * Light / dark, beside the language switch. One tap, no menu: there are two
 * states and the icon shows the one it will move to.
 */
export function ThemeSwitch() {
  const t = useT();
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  const label = dark ? t("ui.theme_light") : t("ui.theme_dark");

  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={label}
      title={label}
      aria-pressed={dark}
      className="flex size-8 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] border-line-soft bg-ink-800 text-paper-2 hover:text-paper"
    >
      {dark ? (
        /* In the dark: the sun, which is where tapping goes. */
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" />
        </svg>
      )}
    </button>
  );
}
