"use client";

import { useSync, useT } from "./AppRuntime";
import { signalStyle } from "@/lib/signal";

/**
 * The signal placard (PRD §7.1, FR-2.3).
 *
 * The single largest element on the screen, because it answers the question a
 * resident opens the app with. The cut corner and filled severity colour come
 * from the approved advisory design — it reads as signage rather than as a
 * notification card, which is the intent.
 */
export function SignalPlacard() {
  const { snapshot } = useSync();
  const t = useT();

  if (!snapshot) return null;

  const { barangay } = snapshot;
  const level = barangay.current_signal_level;
  const style = signalStyle(level);

  // Level 0 is a real state, not an empty one: nobody has raised a signal.
  // It gets the grey treatment and says so, rather than rendering a blank
  // placard a resident could read as "all clear".
  if (level === 0) {
    return (
      <section
        className={`${style.bg} ${style.ink} rounded-instrument px-4 py-3.5`}
        aria-label={t("ui.no_signal")}
      >
        <p className="font-display text-[15px] font-extrabold tracking-[0.6px]">
          {t("ui.no_signal")}
        </p>
        <p className="mt-1.5 text-[13px] leading-snug opacity-80">
          {t("ui.no_signal_body")}
        </p>
      </section>
    );
  }

  const storm = [
    barangay.storm_name ? `BAGYONG ${barangay.storm_name.toUpperCase()}` : null,
    barangay.wind_kph ? `${barangay.wind_kph} KPH` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      className={`${style.bg} ${style.ink} rounded-instrument px-[15px] py-[13px]`}
      // The notched corner is decorative signage language, not information.
      style={{
        clipPath:
          "polygon(0 0, calc(100% - 20px) 0, 100% 20px, 100% 100%, 0 100%)",
      }}
      aria-label={t("ui.signal_no", { n: level })}
    >
      {barangay.bulletin_no !== null && (
        <p className="mono text-[9.5px] font-bold tracking-[1.3px] opacity-70">
          {t("ui.bulletin", { n: barangay.bulletin_no })}
        </p>
      )}

      <div className="mt-1.5 flex items-end gap-3">
        <span
          className="font-display text-[62px] leading-[0.8] font-extrabold tracking-[-2px]"
          aria-hidden
        >
          {level}
        </span>
        <div className="flex-1 pb-1">
          <p className="font-display text-[15px] font-extrabold tracking-[0.6px]">
            {t("ui.signal_no", { n: level })}
          </p>
          {storm && (
            <p className="mono mt-0.5 text-[11.5px] font-semibold opacity-80">
              {storm}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
