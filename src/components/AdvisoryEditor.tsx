"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSync, useT } from "@/components/AppRuntime";
import { useMyRole } from "@/components/useMyRole";
import { AdvisoryBanner } from "@/components/AdvisoryBanner";
import { HoldToConfirm } from "@/components/HoldToConfirm";
import { LeaveByStrip } from "@/components/LeaveByStrip";
import { SignalPlacard } from "@/components/SignalPlacard";
import {
  Skeleton,
  SkeletonLines,
  SkeletonRegion,
  useSkeletonGate,
} from "@/components/Skeleton";
import {
  confirmMode,
  defaultLeaveBy,
  fromLocalInputValue,
  leaveByRequired,
  toLocalInputValue,
  toPatchInput,
  validate,
  valuesFromBarangay,
  type AdvisoryValues,
  type Problem,
} from "@/lib/advisoryForm";
import {
  recentSignalHistory,
  setAdvisory,
  type SignalHistoryRow,
} from "@/lib/advisoryAdmin";
import { clockLabel, deviceLabel } from "@/lib/ledger";
import { signalStyle } from "@/lib/signal";

const LEVELS = [0, 1, 2, 3, 4, 5] as const;

const INPUT =
  "tap w-full rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3 text-[13.5px] text-paper placeholder:text-paper-3 focus:border-hv focus:outline-none";

/**
 * Change advisory, as an overlay over whatever the official is looking at —
 * the dashboard map stays underneath. A sheet from the bottom on a phone, a
 * centred panel on a wider screen. Escape or tapping outside closes it.
 */
export function AdvisoryModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portalled to <body>: it is opened from the sidebar, whose slide transform
  // would otherwise pin a `fixed` overlay inside the sidebar.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-paper/30 sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="advisory-title"
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-instrument border-t-[1.5px] border-line bg-ink-900 shadow-2xl sm:max-w-lg sm:rounded-instrument sm:border-[1.5px]"
      >
        <AdvisoryEditor onClose={onClose} />
      </section>
    </div>,
    document.body,
  );
}

/**
 * The official changes the advisory (PRD §4; spec 2026-09-15).
 *
 * Every resident's placard is drawn from what is confirmed here, so the screen
 * is built around not getting it wrong: a preview drawn with the real
 * components, a hold for every level change, and a deadline that must be in the
 * future. Saving goes through the offline queue, and the banner at the top says
 * plainly when a change has not reached anyone yet.
 */
export function AdvisoryEditor({ onClose }: { onClose: () => void }) {
  const { snapshot, loading } = useSync();
  const t = useT();
  const role = useMyRole();

  /** Null until the official edits something; the form then shows `current`. */
  const [draft, setDraft] = useState<AdvisoryValues | null>(null);

  /*
   * A clock, so a deadline that passes while the screen is open is caught
   * before it is issued. Thirty seconds is fine-grained enough for a deadline
   * measured in hours.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  /** `undefined` = not read yet; `null` = could not be read. */
  const [history, setHistory] = useState<SignalHistoryRow[] | null | undefined>(
    undefined,
  );

  const barangay = snapshot?.barangay ?? null;
  const barangayId = barangay?.id ?? null;
  const isOfficial = role === "official";

  // Re-read when the snapshot changes: that is how a change which has just
  // landed — pushed by the realtime subscription — shows up in the list.
  useEffect(() => {
    if (!barangayId || !isOfficial) return;
    let live = true;
    queueMicrotask(() => {
      void recentSignalHistory(barangayId).then((rows) => {
        if (live) setHistory(rows);
      });
    });
    return () => {
      live = false;
    };
  }, [barangayId, isOfficial, snapshot]);

  const waitingForRole = useSkeletonGate(role !== null);
  const waitingForSnapshot = useSkeletonGate(!loading);

  const header = (
    <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line-soft bg-ink-900 px-4 py-3">
      <h2 id="advisory-title" className="flex-1 font-display text-base font-extrabold tracking-[0.4px]">
        {t("off.change_advisory")}
      </h2>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("hz.close")}
        className="-mr-1 px-1 text-[22px] leading-none text-paper-3 hover:text-paper"
      >
        ×
      </button>
    </div>
  );

  const placeholder = (
    <SkeletonRegion>
      <Skeleton className="h-[132px] rounded-instrument" />
      <Skeleton className="h-[220px] rounded-instrument" />
    </SkeletonRegion>
  );

  /*
   * Not an official — or not known to be one yet. An unverified role never gets
   * the control; after the placeholder's time is up this states the rule rather
   * than claiming anything about the person holding the phone.
   */
  if (!isOfficial) {
    return (
      <>
        {header}
        <div className="flex flex-col gap-3 p-4">
          {role === null && waitingForRole ? (
            placeholder
          ) : (
            <p className="mono mt-8 text-center text-[11px] leading-relaxed tracking-[0.6px] text-paper-3">
              {t("adv.officials_only")}
            </p>
          )}
        </div>
      </>
    );
  }

  if (!barangay) {
    return (
      <>
        {header}
        <div className="flex flex-col gap-3 p-4">
          {waitingForSnapshot ? (
            placeholder
          ) : (
            <p className="mono mt-8 text-center text-[11px] leading-relaxed tracking-[0.6px] text-paper-3">
              {t("ui.no_cache")}
            </p>
          )}
        </div>
      </>
    );
  }

  const current = valuesFromBarangay(barangay);
  const values = draft ?? current;
  const problems = validate(values, now);
  const mode = confirmMode(current, values, now);

  const update = (patch: Partial<AdvisoryValues>) =>
    setDraft({ ...values, ...patch });

  const chooseLevel = (level: number) =>
    update({
      level,
      evacuateBy: defaultLeaveBy(values.level, level, values.evacuateBy, now),
    });

  const confirm = () => {
    void setAdvisory({ barangayId: barangay.id, ...toPatchInput(values) });
    // Back to the server's values. Until the change lands those are the OLD
    // ones, which is the truth; the banner says what is on its way.
    setDraft(null);
  };

  // Written as literal calls so scripts/check-translations.mjs can see each key.
  const problemText = (problem: Problem) =>
    problem === "leave_by_missing"
      ? t("adv.leave_by_required")
      : problem === "leave_by_past"
        ? t("adv.deadline_passed")
        : problem === "bulletin_invalid"
          ? t("adv.bulletin_invalid")
          : t("adv.wind_invalid");

  // `toPatchInput` refuses an invalid number, so the preview waits for valid ones.
  const numbersValid = !problems.some(
    (p) => p === "bulletin_invalid" || p === "wind_invalid",
  );
  const preview = numbersValid ? toPatchInput(values) : null;

  return (
    <>
      {header}

      <div className="flex flex-col gap-4 p-4">
        <AdvisoryBanner barangayId={barangay.id} />

        {/* What residents are reading right now — the server's truth. */}
        <p className="mono text-[11px] tracking-[0.6px] text-paper-2">
          <span className="lbl mr-2">{t("adv.now")}</span>
          {barangay.current_signal_level === 0
            ? t("ui.no_signal")
            : t("ui.signal_no", { n: barangay.current_signal_level })}
          {barangay.signal_set_at && (
            <>
              {" · "}
              {t("adv.set")} {clockLabel(barangay.signal_set_at)}
            </>
          )}
        </p>

        <section>
          <p className="lbl mb-2">{t("adv.new_level")}</p>
          <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label={t("adv.new_level")}>
            {LEVELS.map((level) => {
              const selected = values.level === level;
              return (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={level === 0 ? t("ui.no_signal") : t("ui.signal_no", { n: level })}
                  onClick={() => chooseLevel(level)}
                  className={`tap flex flex-col items-center justify-center gap-1 rounded-instrument border-[1.5px] font-display text-[18px] font-extrabold ${
                    selected
                      ? "border-hv bg-hv text-hv-ink"
                      : "border-line-soft bg-ink-800 text-paper"
                  }`}
                >
                  {level}
                  {/* Severity shown as information beside the number. The
                      button itself stays neutral: the ramp is never a control. */}
                  <span
                    aria-hidden
                    className="h-[3px] w-5 rounded-full"
                    style={{ background: signalStyle(level).cssVar }}
                  />
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid gap-3">
          <label className="grid gap-1.5">
            <span className="lbl">{t("adv.storm")}</span>
            <input
              className={INPUT}
              value={values.stormName}
              onChange={(event) => update({ stormName: event.target.value })}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5">
              <span className="lbl">{t("adv.bulletin")}</span>
              <input
                className={INPUT}
                inputMode="numeric"
                value={values.bulletinNo}
                onChange={(event) => update({ bulletinNo: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="lbl">{t("adv.wind")}</span>
              <input
                className={INPUT}
                inputMode="numeric"
                value={values.windKph}
                onChange={(event) => update({ windKph: event.target.value })}
              />
            </label>
          </div>

          {leaveByRequired(values.level) && (
            <label className="grid gap-1.5">
              <span className="lbl">{t("ui.leave_by")}</span>
              <input
                className={INPUT}
                type="datetime-local"
                value={values.evacuateBy ? toLocalInputValue(values.evacuateBy) : ""}
                // Parsed here and nowhere else: the displayed value has lost its
                // seconds, so re-reading it would change an untouched deadline.
                onChange={(event) =>
                  update({ evacuateBy: fromLocalInputValue(event.target.value) })
                }
              />
            </label>
          )}

          {problems.length > 0 && (
            <ul className="grid gap-1" role="alert">
              {problems.map((problem) => (
                <li key={problem} className="mono text-[10.5px] font-bold tracking-[0.5px] text-alarm">
                  {problemText(problem)}
                </li>
              ))}
            </ul>
          )}
        </section>

        {preview && (
          <section className="grid gap-2">
            <p className="lbl">{t("adv.preview")}</p>
            <SignalPlacard
              barangay={{
                ...barangay,
                current_signal_level: preview.level,
                storm_name: preview.stormName,
                bulletin_no: preview.bulletinNo,
                wind_kph: preview.windKph,
                evacuate_by: preview.evacuateBy?.toISOString() ?? null,
              }}
            />
            {leaveByRequired(preview.level) && preview.evacuateBy && (
              <LeaveByStrip deadline={preview.evacuateBy} signalLevel={preview.level} />
            )}
          </section>
        )}

        {mode === "hold" ? (
          <HoldToConfirm
            label={
              values.level === 0
                ? t("adv.hold_lift")
                : t("adv.hold_issue", { n: values.level })
            }
            holdingLabel={t("sos.cancelling")}
            tone="accent"
            onConfirm={confirm}
          />
        ) : (
          <button
            type="button"
            disabled={mode === "disabled"}
            onClick={confirm}
            className="tap rounded-instrument bg-hv py-3 font-display text-[14px] font-extrabold tracking-[0.3px] text-hv-ink disabled:opacity-35"
          >
            {t("adv.save_details")}
          </button>
        )}

        <section className="grid gap-1.5">
          <p className="lbl">{t("adv.history")}</p>
          {history === undefined ? (
            <SkeletonLines rows={2} />
          ) : history === null ? (
            <p className="mono text-[11px] text-paper-3">{t("adv.history_offline")}</p>
          ) : history.length === 0 ? (
            <p className="mono text-[11px] text-paper-3">
              {barangay.current_signal_level} · {t("adv.before_history")}
            </p>
          ) : (
            <ul className="grid gap-1">
              {history.map((row) => (
                <li
                  key={row.id}
                  className="mono flex flex-wrap items-baseline gap-x-2.5 text-[11px] text-paper-2"
                >
                  <span className="text-[13px] font-bold text-paper">{row.level}</span>
                  <span>{row.set_at ? clockLabel(row.set_at) : "—"}</span>
                  <span>{deviceLabel(row.set_by)}</span>
                  <span className="text-paper-3">
                    {t("adv.sent")} {clockLabel(row.received_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
