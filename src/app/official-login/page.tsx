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

/** Four digits are the PIN. The access code is always 8+ characters (0042), so the two never collide. */
const isPin = (value: string) => /^\d{4}$/.test(value);

/**
 * Official login. Officials type /lgu (any case), which redirects here.
 *
 * One box:
 *   - the 4-digit PIN logs an official phone in as an OFFICIAL. A phone that
 *     is not already an official is refused, whatever PIN it types — the
 *     server answers false for anyone else (migration 0042).
 *   - the access code logs any phone in with FULL ACCESS (user management);
 *     the app still calls it "Official".
 */
export default function OfficialLoginPage() {
  const { setActor } = useSync();
  const t = useT();
  const router = useRouter();
  const role = useMyRole();
  const { unlocked, isSuper } = useOfficialAccess();

  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setActor("official");
    router.replace(actorById("official").home);
  };

  // Already an unlocked official, or a full-access one (never asked for the PIN): straight through.
  useEffect(() => {
    if (role === "official" && (unlocked || isSuper)) open();
    // `open` is recreated each render; the decision only depends on these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, unlocked, isSuper]);

  const submit = async () => {
    const entry = value.trim();
    if (busy || entry === "") return;
    setError(null);

    if (isPin(entry)) {
      // Said here as well as refused by the server: a resident typing a PIN
      // should learn why, not just that it was "wrong".
      if (role !== "official") {
        setError(t("acc.not_official"));
        setValue("");
        return;
      }
      setBusy(true);
      const outcome = await unlockWithPin(entry);
      setBusy(false);
      setValue("");
      if (outcome === "unlocked") open();
      else setError(t(PIN_MESSAGE[outcome]));
      return;
    }

    setBusy(true);
    const outcome = await redeemAccessCode(entry);
    setBusy(false);
    setValue("");
    if (outcome === "official") open();
    else setError(t(CODE_MESSAGE[outcome]));
  };

  return (
    <main className="flex flex-1 flex-col gap-3 p-3.5">
      <section className="mx-auto grid w-full max-w-sm gap-3 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 p-4">
        <h1 className="font-display text-[20px] font-extrabold tracking-[0.4px]">{t("login.title")}</h1>

        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="grid gap-1.5">
            <span className="lbl">{t("acc.pin_or_code")}</span>
            <input
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={64}
              className="tap mono w-full rounded-instrument border-[1.5px] border-line-soft bg-ink-900 px-3 text-center text-[20px] tracking-[4px] text-paper focus:border-hv focus:outline-none"
            />
          </label>

          {error && (
            <p className="mono text-[10.5px] leading-relaxed font-bold tracking-[0.4px] text-alarm" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || value.trim() === "" || role === null}
            className="tap rounded-instrument bg-hv text-[13px] font-bold text-hv-ink disabled:opacity-35"
          >
            {busy ? "…" : t("login.submit")}
          </button>
        </form>
      </section>
    </main>
  );
}
