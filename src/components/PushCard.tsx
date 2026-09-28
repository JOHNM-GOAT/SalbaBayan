"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "./AppRuntime";
import { isStaffRole, useMyRole } from "./useMyRole";
import { disablePush, enablePush, pushState, pushSupported, type PushState } from "@/lib/push";

/**
 * "Alerts when the app is closed" — the staff opt-in.
 *
 * Staff only, because staff are who this reaches: a rescue call goes to the
 * people who answer it, not to the barangay. And opt-in per device, pressed by
 * the person holding it, because a notification is a claim on somebody's
 * attention at an hour they did not choose. A browser would let us ask on page
 * load; that is the prompt everyone dismisses without reading, and once it is
 * dismissed it cannot be asked again.
 *
 * Every outcome is stated rather than hidden. A volunteer who thinks they will
 * be woken and will not is worse off than one who knows they will not — so a
 * phone that blocked notifications is told how to unblock them, and an iPhone
 * that has not been added to the Home Screen is told that is the reason.
 */
export function PushCard() {
  const t = useT();
  const staff = isStaffRole(useMyRole());
  const [state, setState] = useState<PushState>("unknown");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!staff) return;
    let live = true;
    void pushState().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [staff]);

  const toggle = useCallback(async () => {
    setBusy(true);
    try {
      setState(state === "on" ? await disablePush() : await enablePush());
    } finally {
      setBusy(false);
    }
  }, [state]);

  if (!staff) return null;

  const on = state === "on";
  const usable = pushSupported() && state !== "unsupported" && state !== "blocked";

  return (
    <section className="rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3.5 py-3">
      <p className="lbl">{t("push.title")}</p>

      <p className="mt-1.5 text-[12.5px] leading-snug text-paper-2">
        {state === "unsupported"
          ? t("push.unsupported")
          : state === "blocked"
            ? t("push.blocked")
            : t("push.body")}
      </p>

      {usable && (
        <div className="mt-3 flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => void toggle()}
            disabled={busy || state === "unknown"}
            className={`tap mono flex-1 rounded-instrument border-[1.5px] px-3 text-[11px] font-bold tracking-[1px] transition-colors disabled:opacity-50 ${
              on
                ? "border-line-soft text-paper-3 hover:text-paper"
                : "border-hv/45 bg-hv/10 text-hv hover:bg-hv/20"
            }`}
          >
            {on ? t("push.turn_off") : t("push.turn_on")}
          </button>

          {on && (
            <span className="mono flex shrink-0 items-center gap-1.5 text-[10px] font-bold tracking-[0.6px] text-clear">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 6L9 17l-5-5" />
              </svg>
              {t("push.on")}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
