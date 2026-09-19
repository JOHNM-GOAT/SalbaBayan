"use client";

import { useState } from "react";
import { useSync, useT } from "./AppRuntime";
import { isStaffRole, useMyRole } from "./useMyRole";
import { enqueueUpdate } from "@/lib/offlineQueue";

/**
 * The barangay's household count — the baseline the readiness dashboard
 * measures registrations against.
 *
 * Volunteers can set it as well as officials: they are the ones going house to
 * house. The database lets a volunteer change this one number and nothing else
 * on the barangay row (migration 0026), so this card is the whole of what a
 * volunteer may edit there.
 *
 * Saved through the offline queue like every write. The number typed stays in
 * the field after saving, rather than snapping back to the server's value until
 * the write lands — which would look like the save was ignored.
 */
export function HouseholdsCard() {
  const { snapshot } = useSync();
  const t = useT();
  const role = useMyRole();

  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!snapshot || role === null || !isStaffRole(role)) return null;

  const current = snapshot.barangay.expected_households;
  const value = draft ?? (current === null ? "" : String(current));
  const trimmed = value.trim();
  const parsed = /^\d+$/.test(trimmed) && Number(trimmed) >= 1 ? Number(trimmed) : null;
  const invalid = trimmed !== "" && parsed === null;
  const changed = parsed !== null && parsed !== current;

  return (
    <section className="rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3.5 py-3">
      <p className="lbl">{t("hh.title")}</p>
      <p className="mt-1 text-[12px] leading-snug text-paper-2">{t("hh.hint")}</p>

      <div className="mt-2 flex gap-2">
        <input
          inputMode="numeric"
          value={value}
          placeholder={t("hh.unset")}
          aria-label={t("hh.title")}
          onChange={(event) => {
            setDraft(event.target.value);
            setSaved(false);
          }}
          className="tap min-w-0 flex-1 rounded-instrument border-[1.5px] border-line-soft bg-ink-900 px-3 text-[14px] text-paper placeholder:text-paper-3 focus:border-hv focus:outline-none"
        />
        <button
          type="button"
          disabled={!changed}
          onClick={() => {
            if (parsed === null) return;
            void enqueueUpdate("barangays", snapshot.barangay.id, {
              expected_households: parsed,
            });
            setSaved(true);
          }}
          className="tap rounded-instrument bg-hv px-4 text-[12px] font-bold text-hv-ink disabled:opacity-35"
        >
          {t("hh.save")}
        </button>
      </div>

      {invalid && (
        <p className="mono mt-1.5 text-[10px] font-bold tracking-[0.5px] text-alarm" role="alert">
          {t("hh.invalid")}
        </p>
      )}
      {saved && !invalid && (
        <p className="mono mt-1.5 text-[10px] tracking-[0.5px] text-paper-3" role="status">
          {t("hh.saved")}
        </p>
      )}
    </section>
  );
}
