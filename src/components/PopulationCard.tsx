"use client";

import { useSync, useT } from "./AppRuntime";

/**
 * The barangay's population, for officials.
 *
 * Always shown with its source. It is a published figure (832 for #5
 * Callaguip, from PhilAtlas), not a live count, and an official planning an
 * evacuation must not mistake it for the number of people in the barangay
 * tonight. The live counts are the headcount and the check-ins.
 */
export function PopulationCard() {
  const { snapshot } = useSync();
  const t = useT();

  const barangay = snapshot?.barangay;
  if (!barangay || barangay.population == null) return null;

  return (
    <section className="rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3.5 py-3">
      <p className="lbl">{t("off.population")}</p>
      <p className="mono mt-1 text-[30px] leading-none font-bold">
        {barangay.population.toLocaleString("en-PH")}
      </p>
      {barangay.population_source && (
        <p className="mono mt-1.5 text-[9.5px] tracking-[0.6px] text-paper-3">
          {t("off.source")} {barangay.population_source}
        </p>
      )}
    </section>
  );
}
