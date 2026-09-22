"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/AppRuntime";
import { HoldToConfirm } from "@/components/HoldToConfirm";
import { useOfficialAccess } from "@/components/useOfficialAccess";
import {
  accessStatus,
  listUsers,
  setAccessCode,
  setAccessCodeEnabled,
  setOfficialPin,
  setUserRole,
  type AccessStatus,
  type AdminOutcome,
  type ManagedUser,
} from "@/lib/officialAccess";
import type { UserRole } from "@/lib/supabase";

const ROLES: UserRole[] = ["resident", "volunteer", "official"];

const RESULT: Record<Exclude<AdminOutcome, "done">, string> = {
  invalid: "acc.invalid",
  self: "roles.self",
  not_found: "roles.not_found",
  offline: "roles.offline",
  failed: "roles.failed",
};

/**
 * User Management — full administrators only (migration 0042). Every check is
 * made again on the server; this page only decides what to offer.
 */
export default function UsersPage() {
  const t = useT();
  const { isSuper } = useOfficialAccess();

  if (isSuper === null) return <main className="p-3.5 text-paper-3">…</main>;
  if (!isSuper) {
    return (
      <main className="p-3.5">
        <p className="rounded-instrument border-[1.5px] border-caution px-3 py-2.5 text-[12.5px] font-semibold text-caution">
          {t("acc.not_allowed")}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-3 p-3.5">
      <h1 className="font-display text-[20px] font-extrabold tracking-[0.3px]">{t("acc.users")}</h1>
      <AccessSettings />
      <UserList />
    </main>
  );
}

function Message({ result }: { result: { ok: boolean; text: string } | null }) {
  if (!result) return null;
  return (
    <p
      className={`mono text-[10.5px] font-bold tracking-[0.4px] ${result.ok ? "text-clear" : "text-alarm"}`}
      role="status"
    >
      {result.text}
    </p>
  );
}

function AccessSettings() {
  const t = useT();
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [pin, setPin] = useState("");
  const [code, setCode] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => setStatus(await accessStatus()), []);
  useEffect(() => {
    let live = true;
    void accessStatus().then((s) => {
      if (live) setStatus(s);
    });
    return () => {
      live = false;
    };
  }, []);

  const report = (outcome: AdminOutcome, ok: string) =>
    setResult(outcome === "done" ? { ok: true, text: t(ok) } : { ok: false, text: t(RESULT[outcome]) });

  const input =
    "tap mono w-full rounded-instrument border-[1.5px] border-line-soft bg-ink-900 px-3 text-[15px] text-paper focus:border-hv focus:outline-none";

  return (
    <section className="grid gap-3 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3.5 py-3">
      <p className="lbl">{t("acc.settings")}</p>

      <div className="flex items-end gap-2">
        <label className="grid flex-1 gap-1.5">
          <span className="lbl text-[9px]">{t("acc.set_pin")}</span>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            type="password"
            autoComplete="off"
            placeholder="••••"
            className={`${input} tracking-[8px]`}
          />
        </label>
        <button
          type="button"
          disabled={pin.length !== 4}
          onClick={() =>
            void setOfficialPin(pin).then((o) => {
              report(o, "acc.pin_saved");
              if (o === "done") setPin("");
            })
          }
          className="tap mono shrink-0 rounded-instrument bg-hv px-3 text-[10.5px] font-bold tracking-[0.8px] text-hv-ink disabled:opacity-35"
        >
          {t("acc.save_pin")}
        </button>
      </div>

      <div className="flex items-end gap-2">
        <label className="grid flex-1 gap-1.5">
          <span className="lbl text-[9px]">{t("acc.set_code")}</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={64}
            className={input}
          />
        </label>
        <button
          type="button"
          disabled={code.length < 8}
          onClick={() =>
            void setAccessCode(code).then((o) => {
              report(o, "acc.code_saved");
              if (o === "done") setCode("");
              void reload();
            })
          }
          className="tap mono shrink-0 rounded-instrument bg-hv px-3 text-[10.5px] font-bold tracking-[0.8px] text-hv-ink disabled:opacity-35"
        >
          {t("acc.save_code")}
        </button>
      </div>

      {status && (
        <div className="flex items-center gap-2.5">
          <span
            className={`mono flex-1 text-[10.5px] font-bold tracking-[0.6px] ${status.code_enabled ? "text-clear" : "text-paper-3"}`}
          >
            {status.code_enabled ? t("acc.code_enabled") : t("acc.code_disabled")}
          </span>
          <button
            type="button"
            onClick={() =>
              void setAccessCodeEnabled(!status.code_enabled).then((o) => {
                report(o, status.code_enabled ? "acc.code_disabled" : "acc.code_enabled");
                void reload();
              })
            }
            className="tap mono shrink-0 rounded-instrument border-[1.5px] border-line-soft px-3 text-[10.5px] font-bold tracking-[0.8px] text-paper-2"
          >
            {status.code_enabled ? t("acc.turn_off") : t("acc.turn_on")}
          </button>
        </div>
      )}

      <Message result={result} />
    </section>
  );
}

function UserList() {
  const t = useT();
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [editing, setEditing] = useState<{ code: string; role: UserRole } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async (term: string) => {
    const rows = await listUsers(term);
    if (rows) setUsers(rows);
  }, []);

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      void listUsers(search).then((rows) => {
        if (live && rows) setUsers(rows);
      });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [search]);

  return (
    <section className="grid gap-2.5 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3.5 py-3">
      <p className="text-[11.5px] leading-snug text-paper-2">{t("acc.users_intro")}</p>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("acc.search")}
        className="tap w-full rounded-instrument border-[1.5px] border-line-soft bg-ink-900 px-3 text-[13.5px] text-paper placeholder:text-paper-3 focus:border-hv focus:outline-none"
      />
      <Message result={result} />

      {users === null ? (
        <p className="mono text-[11px] text-paper-3">…</p>
      ) : users.length === 0 ? (
        <p className="text-[12px] text-paper-3">{t("acc.none")}</p>
      ) : (
        <ul className="grid gap-1.5">
          {users.map((user) => {
            const name =
              user.first_name || user.last_name
                ? `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim()
                : t("profile.no_name");
            const target = editing?.code === user.device_code ? editing.role : null;
            return (
              <li key={user.device_code} className="grid gap-2 rounded-[3px] border-[1.5px] border-line-soft bg-ink-900 px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">{name}</p>
                    <p className="mono text-[9.5px] tracking-[0.5px] text-paper-3">
                      {user.device_code}
                      {user.first_name && ` · ${user.confirmed ? t("profile.confirmed") : t("profile.unconfirmed")}`}
                      {user.is_super && ` · ${t("acc.via_code")}`}
                    </p>
                  </div>
                  {user.is_me ? (
                    <span className="mono text-[10px] font-bold tracking-[0.8px] text-hv">{t("roles.you")}</span>
                  ) : (
                    <div className="flex shrink-0 overflow-hidden rounded-[3px] border-[1.5px] border-line-soft" role="group">
                      {ROLES.map((role) => (
                        <button
                          key={role}
                          type="button"
                          aria-pressed={(target ?? user.role) === role}
                          onClick={() => {
                            setResult(null);
                            setEditing(role === user.role ? null : { code: user.device_code, role });
                          }}
                          className={`mono px-2 py-1.5 text-[9px] font-bold tracking-[0.5px] ${
                            (target ?? user.role) === role ? "bg-hv text-hv-ink" : "text-paper-3"
                          }`}
                        >
                          {t(`actor.${role}`)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {target && (
                  <HoldToConfirm
                    label={t("acc.hold_role", { n: t(`actor.${target}`) })}
                    holdingLabel={t("sos.cancelling")}
                    tone={target === "resident" ? "alarm" : "accent"}
                    onConfirm={() =>
                      void setUserRole(user.device_code, target).then((o) => {
                        setEditing(null);
                        setResult(o === "done" ? { ok: true, text: t("acc.role_saved") } : { ok: false, text: t(RESULT[o]) });
                        void reload(search);
                      })
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
