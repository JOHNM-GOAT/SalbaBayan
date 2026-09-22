"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "./AppRuntime";
import { useOfficialAccess } from "./useOfficialAccess";
import { lockOfficialPages } from "@/lib/officialAccess";

/** ME tab, officials only: lock the official pages, and User Management for full administrators. */
export function OfficialAccessCard() {
  const t = useT();
  const router = useRouter();
  const { unlocked, isSuper } = useOfficialAccess();

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
    </section>
  );
}
