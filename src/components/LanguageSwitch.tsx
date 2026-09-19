"use client";

import { useMemo } from "react";
import { useSync, useT } from "./AppRuntime";
import { LANGUAGES, isLanguage, translatedLanguages } from "@/lib/i18n";

/**
 * Language picker (PRD §7.2).
 *
 * A dropdown, because the Philippines has far more languages than a row of
 * buttons can hold. Always visible in the header rather than buried in
 * settings: a resident who cannot read the current language cannot navigate a
 * menu to change it.
 *
 * The visible part is a short code (ENG, ILO) — it has to fit a phone header —
 * and a native <select> sits invisibly on top of it. Tapping opens the phone's
 * own picker, which every screen reader and every small phone already handles,
 * listing each language by the name its speakers use.
 *
 * The list is split honestly in two, from the data rather than a hardcoded
 * list: languages the app is translated into, and languages that can be chosen
 * but are not translated yet, labelled with the language they will actually be
 * shown in. Choosing one of the second group is still remembered, so the day
 * its strings are added the resident sees them without choosing again.
 *
 * Switching re-derives from the snapshot in memory: no fetch, no reload, works
 * offline (the §7.2 acceptance criterion).
 */
export function LanguageSwitch() {
  const { language, setLanguage, snapshot } = useSync();
  const t = useT();

  const translated = useMemo(
    () => translatedLanguages(snapshot?.translations ?? {}),
    [snapshot],
  );

  const fallbackCode = snapshot?.barangay.default_language ?? "tl";
  const fallback =
    LANGUAGES.find((l) => l.code === fallbackCode)?.label ?? fallbackCode;

  const ready = LANGUAGES.filter((l) => translated.has(l.code));
  const pending = LANGUAGES.filter((l) => !translated.has(l.code));

  return (
    <div className="relative">
      <span
        className="mono flex items-center gap-1 rounded-[3px] border-[1.5px] border-line-soft bg-ink-800 px-2.5 py-1.5 text-[10px] font-bold tracking-[0.8px] text-paper"
        aria-hidden
      >
        {language.toUpperCase().slice(0, 3)}
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </span>

      <select
        value={language}
        onChange={(event) => {
          if (isLanguage(event.target.value)) setLanguage(event.target.value);
        }}
        aria-label={t("ui.language")}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <optgroup label={t("ui.lang_translated")}>
          {ready.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label === l.english ? l.label : `${l.label} (${l.english})`}
            </option>
          ))}
        </optgroup>
        <optgroup label={t("ui.lang_other", { n: fallback })}>
          {pending.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label === l.english ? l.label : `${l.label} (${l.english})`}
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}
