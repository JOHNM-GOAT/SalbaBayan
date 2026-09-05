"use client";

import { useSync, useT } from "./AppRuntime";
import { LANGUAGES } from "@/lib/i18n";
import { signalStyle } from "@/lib/signal";
import type { PurokAdvisory } from "@/lib/advisory";

/**
 * The instruction (PRD §7.1, FR-2.5).
 *
 * "The single most important thing on the screen" in the approved design, and
 * the reason the product exists: a national signal number turned into one
 * sentence about what this resident should do.
 */
export function ActionCard({ advisory }: { advisory: PurokAdvisory }) {
  const { snapshot, language } = useSync();
  const t = useT();
  const style = signalStyle(advisory.signalLevel);

  /*
   * Coverage gap (FR-2.6). An unconfigured Purok x Signal cell renders as an
   * explicit statement that guidance is missing, never as an empty card. A
   * blank space here would be read as "nothing to do", which during a storm is
   * the most dangerous thing this screen could imply.
   */
  if (!advisory.protocol) {
    return (
      <section className="rounded-instrument border-l-4 border-caution bg-ink-800 p-3.5">
        <p className="lbl">{t("ui.what_to_do")}</p>
        <h2 className="mt-2 font-display text-[21px] leading-tight font-extrabold tracking-[0.2px] text-caution">
          {t("ui.no_protocol")}
        </h2>
        <p className="mt-2 text-[14.5px] leading-relaxed font-medium text-paper">
          {t("ui.no_protocol_body", { n: advisory.signalLevel })}
        </p>
      </section>
    );
  }

  const fallbackLabel =
    LANGUAGES.find((l) => l.code === snapshot?.barangay.default_language)
      ?.label ?? snapshot?.barangay.default_language;

  return (
    <section
      className={`rounded-instrument border-l-4 bg-ink-800 p-3.5 ${style.border}`}
    >
      <p className="lbl">{t("ui.what_to_do")}</p>

      <h2
        className={`mt-2 font-display text-[21px] leading-tight font-extrabold tracking-[0.2px] ${style.text}`}
      >
        {advisory.headline}
      </h2>

      <p className="mt-2 text-[14.5px] leading-relaxed font-medium text-paper text-pretty">
        {advisory.action}
      </p>

      {/*
       * FR-3.5: when the resident's language has no string for this protocol,
       * the fallback text is shown WITH an admission that it is a fallback.
       * Silently serving Tagalog to someone who asked for Cebuano would look
       * like the translation exists.
       */}
      {advisory.usedFallback && (
        <p className="mono mt-2 text-[10px] leading-snug font-semibold tracking-[0.4px] text-paper-3">
          {t("ui.showing_fallback", { n: fallbackLabel ?? language })}
        </p>
      )}

      {advisory.center && (
        <div className="mt-3 flex items-center gap-2.5 rounded-[3px] border-[1.5px] border-line-soft bg-ink-900 px-3 py-2.5">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-hv)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
            aria-hidden
          >
            <circle cx="6" cy="19" r="2" />
            <circle cx="18" cy="5" r="2" />
            <path d="M8 19h7a4 4 0 0 0 4-4v-1a4 4 0 0 0-4-4H9a4 4 0 0 1-4-4v-1" />
          </svg>
          <div className="flex-1">
            <p className="lbl text-[9px]">{t("ui.evac_center")}</p>
            <p className="text-[12.5px] font-semibold">{advisory.center.name}</p>
          </div>
        </div>
      )}

      {advisory.protocol.route && (
        <p className="mono mt-2 text-[11px] leading-snug text-paper-3">
          {advisory.protocol.route}
        </p>
      )}
    </section>
  );
}
