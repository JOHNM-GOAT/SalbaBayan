"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSync, useT } from "@/components/AppRuntime";
import { useMyRole } from "@/components/useMyRole";
import { actorById } from "@/lib/actors";
import { loginWithCode, type LoginOutcome } from "@/lib/officialLogin";

const MESSAGE: Record<Exclude<LoginOutcome, "official">, string> = {
  wrong: "login.wrong",
  locked: "login.locked",
  offline: "roles.offline",
  failed: "roles.failed",
};

/**
 * Official login. Officials type /lgu (any case), which redirects here. Not linked from anywhere a
 * resident looks. The address hides nothing — the personal code is the only
 * protection, checked and rate-limited on the server (migration 0037).
 */
export default function OfficialLoginPage() {
  const { setActor } = useSync();
  const t = useT();
  const router = useRouter();
  const role = useMyRole();

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const openOfficial = () => {
    setActor("official");
    router.push(actorById("official").home);
  };

  const submit = async () => {
    if (busy || code.trim() === "") return;
    setBusy(true);
    setError(null);
    const outcome = await loginWithCode(code);
    setBusy(false);
    if (outcome === "official") {
      setDone(true);
      setCode("");
      openOfficial();
    } else {
      setError(t(MESSAGE[outcome]));
    }
  };

  const isOfficial = role === "official";

  return (
    <main className="flex flex-1 flex-col gap-3 p-3.5">
      <section className="grid gap-3 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 p-4">
        <div>
          <h1 className="font-display text-[20px] font-extrabold tracking-[0.4px]">{t("login.title")}</h1>
          <p className="mt-1 text-[12px] leading-snug text-paper-2">{t("login.intro")}</p>
        </div>

        {isOfficial || done ? (
          <>
            <p className="mono text-[11px] font-bold tracking-[0.5px] text-clear" role="status">
              {t("login.done")}
            </p>
            <button
              type="button"
              onClick={openOfficial}
              className="tap rounded-instrument bg-hv text-[13px] font-bold text-hv-ink"
            >
              {t("login.go")}
            </button>
          </>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="grid gap-1.5">
              <span className="lbl">{t("login.code")}</span>
              <input
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  setError(null);
                }}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={16}
                placeholder="XXXX-XXXX-XX"
                className="tap mono w-full rounded-instrument border-[1.5px] border-line-soft bg-ink-900 px-3 text-[18px] tracking-[2px] text-paper uppercase placeholder:text-paper-3 focus:border-hv focus:outline-none"
              />
            </label>

            {error && (
              <p className="mono text-[10.5px] font-bold tracking-[0.5px] text-alarm" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || code.trim() === ""}
              className="tap rounded-instrument bg-hv text-[13px] font-bold text-hv-ink disabled:opacity-35"
            >
              {busy ? "…" : t("login.submit")}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
