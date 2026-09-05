"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSync, useT } from "@/components/AppRuntime";
import { HoldToCancel } from "@/components/HoldToCancel";
import {
  cancelSOS,
  elapsedSince,
  isActive,
  allMyRequests,
  raiseSOS,
  startPositionWatch,
  subscribeRescue,
  type Fix,
  type RescueRequest,
} from "@/lib/sos";

/**
 * One-tap SOS (PRD §7.4).
 *
 * Two states, and the screen is only ever one of them: the button, or the
 * status of the request you already have. Never both — someone who has already
 * called for help does not need a second button, they need to know they were
 * heard.
 */
export default function SOSPage() {
  const { purokId } = useSync();
  const t = useT();

  const [request, setRequest] = useState<RescueRequest | null>(null);
  const [pendingLocal, setPendingLocal] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    // Merged: server rows plus anything still in the local write queue, so the
    // elapsed timer runs from the tap even with no network.
    const rows = await allMyRequests();
    const active = rows.find(isActive) ?? null;
    setRequest(active);
    if (active) setPendingLocal(false);
  }, []);

  useEffect(() => {
    // The fix is warmed as soon as the screen opens, not when the button is
    // pressed. A cold first fix indoors can take half a minute, and the tap
    // must never wait for it.
    const stopWatch = startPositionWatch((next, error) => {
      setFix(next);
      setGpsError(error);
    });

    queueMicrotask(() => void refresh());
    const stopLive = subscribeRescue(() => void refresh());
    const tick = window.setInterval(() => setNow(Date.now()), 1000);

    return () => {
      stopWatch();
      stopLive();
      window.clearInterval(tick);
    };
  }, [refresh]);

  async function onPress() {
    // Optimistic by design. The write is durable in IndexedDB before this
    // resolves, so showing "sent" immediately is the truth, not a guess.
    setPendingLocal(true);
    await raiseSOS(purokId);
    void refresh();
  }

  async function onCancel() {
    if (request) await cancelSOS(request.id);
    setRequest(null);
    setPendingLocal(false);
    void refresh();
  }

  const showStatus = request !== null || pendingLocal;

  return (
    <>
      {/* Hazard banding marks this screen as the alarm path, matching the
          physical signage vocabulary used for the leave-by deadline. */}
      <div
        className="h-2 shrink-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, var(--color-alarm) 0 8px, transparent 8px 16px)",
        }}
        aria-hidden
      />

      <div className="flex items-center gap-3 px-3.5 py-3">
        <Link href="/" aria-label="Back" className="shrink-0">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--color-paper-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </Link>
        <h1 className="font-display text-base font-extrabold tracking-[0.4px]">
          {t("sos.title")}
        </h1>
      </div>

      <main className="flex flex-1 flex-col gap-3 p-3.5">
        {!showStatus ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-6">
            <button
              type="button"
              onClick={onPress}
              className="flex size-52 items-center justify-center rounded-full bg-alarm ring-[14px] ring-alarm/20 transition-transform active:scale-95"
              aria-label={t("sos.press")}
            >
              <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="oklch(0.99 0.01 28)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 2v3" />
                <path d="M6 21v-6a6 6 0 0 1 12 0v6z" />
                <path d="M4 21h16" />
              </svg>
            </button>

            <div className="text-center">
              <p className="font-display text-[17px] font-extrabold tracking-[0.4px] text-alarm">
                {t("sos.press")}
              </p>
              <p className="mt-2 text-[13px] text-paper-2">{t("sos.press_hint")}</p>
            </div>

            {/*
              GPS readiness, stated but deliberately understated. It is
              informational, never a gate — no spinner, no "waiting for GPS",
              nothing that suggests the button should not be pressed yet. A
              request with no fix still carries the Purok.
            */}
            <p className="mono text-[10px] tracking-[0.7px] text-paper-3">
              {fix
                ? `GPS ±${Math.round(fix.accuracy)}M`
                : gpsError
                  ? `GPS: ${gpsError.toUpperCase()}`
                  : "GPS: HINAHANAP…"}
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center gap-2 py-3">
              <div className="flex size-28 items-center justify-center rounded-full bg-alarm ring-[10px] ring-alarm/20">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="oklch(0.99 0.01 28)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 2v3" />
                  <path d="M6 21v-6a6 6 0 0 1 12 0v6z" />
                  <path d="M4 21h16" />
                </svg>
              </div>
              <p className="mt-1 font-display text-[22px] font-extrabold tracking-[0.3px] text-alarm">
                {t("sos.sent")}
              </p>
              {/* Counting from the tap, not from delivery. A request that sat
                  in the queue for forty minutes says forty minutes. */}
              <p className="mono text-[13px] font-semibold tracking-[0.8px] text-paper-2">
                {request ? elapsedSince(request.ts, now) : "00:00"} ·{" "}
                {request?.status === "acknowledged"
                  ? t("sos.state_ack")
                  : t("sos.waiting")}
              </p>
            </div>

            <Stepper status={request?.status ?? "pending"} t={t} />

            <section
              className={`rounded-instrument border-l-4 bg-ink-800 p-3.5 ${
                request?.acknowledged_by ? "border-clear" : "border-line"
              }`}
            >
              <p className="lbl">
                {request?.acknowledged_by ? t("sos.seen") : t("sos.not_seen")}
              </p>
              {/*
                Three genuinely different states, and conflating any two of
                them would mislead someone in danger: a responder has it; it
                reached the barangay and is waiting; or it is still on this
                phone because there is no signal.
              */}
              <p className="mt-1.5 text-[13px] leading-snug font-semibold">
                {request?.acknowledged_by
                  ? "Rescue Team"
                  : request
                    ? t("sos.waiting")
                    : t("sos.queued_note")}
              </p>
            </section>

            <section className="rounded-instrument border-[1.5px] border-line-soft bg-ink-800 p-3.5">
              <p className="lbl">{t("sos.location")}</p>
              {request?.lat != null && request?.lng != null ? (
                <p className="mono mt-1.5 text-[12px] text-paper-2">
                  {request.lat.toFixed(4)} N · {request.lng.toFixed(4)} E
                  {request.accuracy_m ? ` · ±${Math.round(request.accuracy_m)} M` : ""}
                </p>
              ) : (
                /* An SOS with no fix is a supported outcome, not an error.
                   Saying which coarse location was sent instead is what keeps
                   it from reading as a failure. */
                <p className="mt-1.5 text-[12.5px] leading-snug text-caution">
                  {t("sos.no_gps")}
                </p>
              )}
              {gpsError && (
                <p className="mono mt-2 text-[10px] leading-snug text-paper-3">
                  GPS: {gpsError}
                </p>
              )}
            </section>

            <div className="mt-auto">
              <HoldToCancel onCancel={onCancel} />
            </div>
          </>
        )}
      </main>
    </>
  );
}

/** pending → acknowledged → rescued, as a three-step readout (FR-4.4). */
function Stepper({
  status,
  t,
}: {
  status: string;
  t: (key: string) => string;
}) {
  const steps = [
    { key: "pending", label: t("sos.state_pending"), done: true },
    {
      key: "acknowledged",
      label: t("sos.state_ack"),
      done: status === "acknowledged" || status === "rescued",
    },
    { key: "rescued", label: t("sos.state_rescued"), done: status === "rescued" },
  ];

  return (
    <section className="flex items-center rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3 py-3.5">
      {steps.map((step, i) => (
        <div key={step.key} className="flex flex-1 items-center">
          <div className="flex flex-1 flex-col items-center gap-1.5">
            <span
              className={`flex size-6 items-center justify-center rounded-full ${
                step.done ? "bg-alarm" : "border-[1.5px] border-line"
              }`}
            >
              {step.done && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="oklch(0.99 0.01 28)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
            </span>
            <span
              className={`mono text-[9px] font-bold tracking-[0.8px] ${
                step.done ? "text-alarm" : "text-paper-3"
              }`}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <span
              className={`mb-4 h-px w-6 shrink-0 ${step.done ? "bg-alarm" : "bg-line"}`}
              aria-hidden
            />
          )}
        </div>
      ))}
    </section>
  );
}
