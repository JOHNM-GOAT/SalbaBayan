"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSync, useT } from "@/components/AppRuntime";
import { useMyRole } from "@/components/useMyRole";
import { useOfficialAccess } from "@/components/useOfficialAccess";
import { actorById } from "@/lib/actors";
import {
  redeemAccessCode,
  unlockWithPin,
  type CodeOutcome,
  type PinOutcome,
} from "@/lib/officialAccess";

const PIN_MESSAGE: Record<Exclude<PinOutcome, "unlocked">, string> = {
  wrong: "acc.pin_wrong",
  offline: "roles.offline",
  failed: "roles.failed",
};
const CODE_MESSAGE: Record<Exclude<CodeOutcome, "official">, string> = {
  wrong: "acc.code_wrong",
  locked: "acc.code_locked",
  disabled: "acc.code_off",
  offline: "roles.offline",
  failed: "roles.failed",
};

/**
 * Official login. Officials type /lgu (any case), which redirects here.
 *
 * An official device enters the shared 4-digit PIN, asked again every time the
 * app is opened. A device that is not an official is told so, whatever PIN it
 * types — the server answers false for anyone else (migration 0042). The
 * access code, for setting up and testing, is behind a small link.
 */
export default function OfficialLoginPage() {
  const { setActor } = useSync();
  const t = useT();
  const router = useRouter();
  const role = useMyRole();
  const { unlocked } = useOfficialAccess();

  const [pin, setPin] = useState("");
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setActor("official");
    router.replace(actorById("official").home);
  };

  // Already an unlocked official: straight through.
  useEffect(() => {
    if (role === "official" && unlocked) open();
    // `open` is recreated each render; the decision only depends on these two.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, unlocked]);

  const submitPin = async () => {
    if (busy || !/^\d{4}$/.test(pin)) return;
    setBusy(true);
    setError(null);
    const outcome = await unlockWithPin(pin);
    setBusy(false);
    setPin("");
    if (outcome === "unlocked") open();
    else setError(t(PIN_MESSAGE[outcome]));
  };

  const submitCode = async () => {
    if (busy || code === "") return;
    setBusy(true);
    setError(null);
    const outcome = await redeemAccessCode(code);
    setBusy(false);
    setCode("");
    if (outcome === "official") open();
    else setError(t(CODE_MESSAGE[outcome]));
  };

  const isOfficial = role === "official";

  return (
    <main className="flex flex-1 flex-col gap-3 p-3.5">
      <section className="mx-auto grid w-full max-w-sm gap-3 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 p-4">
        <h1 className="font-display text-[20px] font-extrabold tracking-[0.4px]">{t("login.title")}</h1>

        {role === null ? (
          <p className="mono text-[11px] text-paper-3">…</p>
        ) : isOfficial ? (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submitPin();
            }}
          >
            <label className="grid gap-1.5">
              <span className="lbl">{t("acc.pin")}</span>
              <input
                value={pin}
                onChange={(event) => {
                  setPin(event.target.value.replace(/\D/g, "").slice(0, 4));
                  setError(null);
                }}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                placeholder="••••"
                className="tap mono w-full rounded-instrument border-[1.5px] border-line-soft bg-ink-900 px-3 text-center text-[24px] tracking-[10px] text-paper placeholder:text-paper-3 focus:border-hv focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={busy || pin.length !== 4}
              className="tap rounded-instrument bg-hv text-[13px] font-bold text-hv-ink disabled:opacity-35"
            >
              {busy ? "…" : t("acc.unlock")}
            </button>
          </form>
        ) : (
          <p className="rounded-instrument border-[1.5px] border-caution px-3 py-2.5 text-[12.5px] leading-snug font-semibold text-caution">
            {t("acc.not_official")}
          </p>
        )}

        {error && (
          <p className="mono text-[10.5px] font-bold tracking-[0.5px] text-alarm" role="alert">
            {error}
          </p>
        )}

        {/* The access code: for setting up and testing, so it stays out of the way. */}
        <div className="border-t border-line-soft pt-2.5">
          {!showCode ? (
            <button
              type="button"
              onClick={() => setShowCode(true)}
              className="mono text-[10px] font-bold tracking-[0.7px] text-paper-3"
            >
              {t("acc.code_toggle")}
            </button>
          ) : (
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void submitCode();
              }}
            >
              <label className="grid gap-1.5">
                <span className="lbl">{t("acc.code")}</span>
                <input
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value);
                    setError(null);
                  }}
                  type="password"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  maxLength={64}
                  className="tap mono w-full rounded-instrument border-[1.5px] border-line-soft bg-ink-900 px-3 text-[15px] text-paper focus:border-hv focus:outline-none"
                />
              </label>
              <button
                type="submit"
                disabled={busy || code === ""}
                className="tap rounded-instrument border-[1.5px] border-hv text-[12px] font-bold text-hv disabled:opacity-35"
              >
                {busy ? "…" : t("login.submit")}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
