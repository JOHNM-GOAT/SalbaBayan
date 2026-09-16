"use client";

import { useT } from "./AppRuntime";
import { usePendingAdvisory } from "./usePendingAdvisory";
import { flushQueue, retryBlocked } from "@/lib/offlineQueue";
import { clockLabel } from "@/lib/ledger";

/**
 * An advisory change that has not reached residents, said plainly.
 *
 * The placard above this keeps showing the SERVER's level on purpose. An
 * official who changed the signal offline must not look at their own screen,
 * see Signal 4, and believe the barangay has been told. The unsent level lives
 * here instead, next to the instruction that matters while it is unsent: use
 * the megaphone.
 *
 * State colours only — `caution` while queued, `alarm` when refused. Never the
 * signal ramp, which means severity and nothing else.
 */
export function AdvisoryBanner({ barangayId }: { barangayId: string | null }) {
  const t = useT();
  const pending = usePendingAdvisory(barangayId);

  if (pending.state === "none") return null;

  // Level 0 is "the signal was lifted", which reads wrongly as "Signal 0".
  const lifted = pending.level === 0;

  if (pending.state === "queued") {
    return (
      <p
        role="status"
        className="rounded-instrument border-[1.5px] border-caution bg-ink-800 px-3 py-2.5 text-[12.5px] leading-snug font-semibold text-caution"
      >
        {lifted ? t("adv.not_sent_lift") : t("adv.not_sent", { n: pending.level })}
        <span className="mono mt-1 block text-[10px] font-bold tracking-[0.6px] text-paper-3">
          {t("adv.set")} {clockLabel(pending.tappedAt)}
        </span>
      </p>
    );
  }

  return (
    <div
      role="alert"
      className="rounded-instrument border-[1.5px] border-alarm bg-ink-800 px-3 py-2.5"
    >
      <p className="text-[12.5px] leading-snug font-semibold text-alarm">
        {lifted ? t("adv.refused_lift") : t("adv.refused", { n: pending.level })}
      </p>

      {/* The queue's own words. An official deciding whether to retry or to
          fix the form needs to know which rule refused it. */}
      {pending.reason && (
        <p className="mono mt-1 text-[10px] leading-relaxed text-paper-3">
          {pending.reason}
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          // `retryBlocked` only clears the flag; without the flush the change
          // would sit until the next 30-second poll.
          void retryBlocked(pending.queueId).then(() => flushQueue());
        }}
        className="tap mono mt-2 rounded-[3px] border-[1.5px] border-hv px-3 text-[10px] font-bold tracking-[0.7px] text-hv"
      >
        {t("adv.retry")}
      </button>
    </div>
  );
}
