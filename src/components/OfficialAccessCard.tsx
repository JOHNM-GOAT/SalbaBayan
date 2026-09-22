"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./AppRuntime";
import { HoldToConfirm } from "./HoldToConfirm";
import { useOfficialAccess } from "./useOfficialAccess";
import { leaveFullAccess, lockOfficialPages } from "@/lib/officialAccess";

/**
 * ME tab, officials only: lock the official pages; for full-access officials,
 * User Management and LOG OUT (the device becomes a resident's again).
 */
export function OfficialAccessCard() {
  const t = useT();
  const router = useRouter();
  const { unlocked, isSuper } = useOfficialAccess();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <section className="grid gap-2 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3.5 py-3">
      {isSuper && (
        <Link
          href="/users"
          className="tap mono flex items-center justify-center rounded-instrument bg-hv text-[10.5px] font-bold tracking-[1px] text-hv-ink"
        >
          {t("acc.users")}
        </Link>
      )}
      {unlocked ? (
        <button
          type="button"
          onClick={() => {
            lockOfficialPages();
            router.replace("/");
          }}
          className="tap mono rounded-instrument border-[1.5px] border-line-soft text-[10.5px] font-bold tracking-[1px] text-paper-2"
        >
          {t("acc.lock")}
        </button>
      ) : (
        <Link
          href="/official-login"
          className="tap mono flex items-center justify-center rounded-instrument border-[1.5px] border-hv text-[10.5px] font-bold tracking-[1px] text-hv"
        >
          {t("acc.unlock")}
        </Link>
      )}

      {isSuper &&
        (!confirmLogout ? (
          <button
            type="button"
            onClick={() => setConfirmLogout(true)}
            className="tap mono rounded-instrument border-[1.5px] border-alarm text-[10.5px] font-bold tracking-[1px] text-alarm"
          >
            {t("login.logout")}
          </button>
        ) : (
          <>
            <HoldToConfirm
              label={t("acc.logout_hint")}
              holdingLabel={t("sos.cancelling")}
              tone="alarm"
              onConfirm={() => {
                void leaveFullAccess().then((ok) => {
                  if (!ok) {
                    setFailed(true);
                    return;
                  }
                  router.replace("/");
                });
              }}
            />
            <button
              type="button"
              onClick={() => setConfirmLogout(false)}
              className="mono text-[10.5px] font-bold tracking-[0.8px] text-paper-3"
            >
              {t("ce.cancel")}
            </button>
          </>
        ))}

      {failed && (
        <p className="mono text-[10.5px] font-bold tracking-[0.5px] text-alarm" role="alert">
          {t("roles.failed")}
        </p>
      )}
    </section>
  );
}
