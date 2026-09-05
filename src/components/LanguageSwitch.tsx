"use client";

import { useSync, useT } from "./AppRuntime";
import { LANGUAGES } from "@/lib/i18n";

/**
 * Language switch (PRD §7.2).
 *
 * Segmented and always visible rather than buried in a settings screen. A
 * resident who cannot read the current language cannot navigate a menu to
 * change it — the control has to be legible without understanding the words
 * around it, which is why the labels are endonyms and the active state is
 * carried by colour and weight rather than by a word like "selected".
 *
 * Switching re-derives from the snapshot in memory: no fetch, no reload, works
 * offline (the §7.2 acceptance criterion).
 */
export function LanguageSwitch() {
  const { language, setLanguage } = useSync();
  const t = useT();

  return (
    <div
      className="flex overflow-hidden rounded-[3px] border-[1.5px] border-line-soft"
      role="group"
      aria-label={t("ui.language")}
    >
      {LANGUAGES.map(({ code, label }) => {
        const active = code === language;
        return (
          <button
            key={code}
            type="button"
            onClick={() => setLanguage(code)}
            aria-pressed={active}
            className={`mono px-2.5 py-1.5 text-[10px] font-bold tracking-[0.8px] transition-colors ${
              active
                ? "bg-hv text-hv-ink"
                : "bg-ink-800 text-paper-3 hover:text-paper"
            }`}
          >
            {label.slice(0, 3).toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
