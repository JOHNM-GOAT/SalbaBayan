"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./AppRuntime";
import { HoldToConfirm } from "./HoldToConfirm";
import { logoutOfficial, myOfficialCode } from "@/lib/officialLogin";

/**
 * On the ME tab of a phone that logged in with an official code: who it is
 * logged in as, and LOG OUT. Officials granted by device code have no code
 * session, so this shows nothing for them.
 */
export function OfficialSession() {
  const t = useT();
  const router = useRouter();
  const [label, setLabel] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void myOfficialCode().then((name) => {
      if (live) setLabel(name);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!label) return null;

  return (
    <section className="grid gap-2.5 rounded-instrument border-[1.5px] border-hv bg-ink-800 px-3.5 py-3">
      <p className="mono text-[11px] font-bold tracking-[0.6px] text-hv">
        {t("login.as", { n: label })}
      </p>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="tap mono rounded-instrument border-[1.5px] border-line-soft text-[10.5px] font-bold tracking-[1px] text-paper-2"
        >
          {t("login.logout")}
        </button>
      ) : (
        <>
          <HoldToConfirm
            label={t("login.hold_logout")}
            holdingLabel={t("sos.cancelling")}
            tone="alarm"
            onConfirm={() => {
              void logoutOfficial().then((ok) => {
                if (!ok) {
                  setFailed(true);
                  return;
                }
                setLabel(null);
                router.replace("/");
              });
            }}
          />
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="mono text-[10.5px] font-bold tracking-[0.8px] text-paper-3"
          >
            {t("ce.cancel")}
          </button>
        </>
      )}
      {failed && (
        <p className="mono text-[10.5px] font-bold tracking-[0.5px] text-alarm" role="alert">
          {t("roles.failed")}
        </p>
      )}
    </section>
  );
}
