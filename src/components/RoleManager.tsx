"use client";

import { useCallback, useEffect, useState } from "react";
import { useSync, useT } from "./AppRuntime";
import { HoldToConfirm } from "./HoldToConfirm";
import { QrScanner } from "./QrScanner";
import {
  deviceCodeOf,
  listStaff,
  setDeviceRole,
  type SetDeviceRoleOutcome,
  type StaffMember,
  type UserRole,
} from "@/lib/supabase";

const MESSAGE: Record<Exclude<SetDeviceRoleOutcome, "granted">, string> = {
  invalid: "roles.code_invalid",
  not_found: "roles.not_found",
  self: "roles.self",
  offline: "roles.offline",
  failed: "roles.failed",
};

/**
 * Officials give a device the volunteer or official role, or take it away,
 * by the code that device shows on its own ME tab. The database enforces who
 * may do this (set_device_role, migration 0032); this card is only shown to
 * officials so nobody else is offered a control that would be refused.
 *
 * Granting and removing are press-and-hold: an official can issue signals and
 * move the evacuation centre, so making one should not be a stray tap.
 */
export function RoleManager() {
  const { userId } = useSync();
  const t = useT();

  const [code, setCode] = useState("");
  const [role, setRole] = useState<UserRole>("volunteer");
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const reload = useCallback(async () => {
    const rows = await listStaff();
    if (rows) setStaff(rows);
  }, []);

  useEffect(() => {
    let live = true;
    void listStaff().then((rows) => {
      if (live && rows) setStaff(rows);
    });
    return () => {
      live = false;
    };
  }, []);

  const cleaned = code.replace(/[\s-]/g, "").toUpperCase();
  const valid = /^[0-9A-F]{8}$/.test(cleaned);

  const apply = async (target: string, newRole: UserRole) => {
    const outcome = await setDeviceRole(target, newRole);
    if (outcome === "granted") {
      setMessage({ text: t("roles.granted"), ok: true });
      setCode("");
      setRemoving(null);
      await reload();
    } else {
      setMessage({ text: t(MESSAGE[outcome]), ok: false });
    }
  };

  const roleButton = (value: UserRole) => (
    <button
      type="button"
      onClick={() => setRole(value)}
      aria-pressed={role === value}
      className={`tap mono flex-1 rounded-instrument border-[1.5px] text-[10.5px] font-bold tracking-[1px] ${
        role === value ? "border-hv bg-ink-900 text-hv" : "border-line-soft text-paper-3"
      }`}
    >
      {t(`actor.${value}`)}
    </button>
  );

  return (
    <section className="grid gap-3 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3.5 py-3">
      <div>
        <p className="lbl">{t("roles.title")}</p>
        <p className="mt-1 text-[11.5px] leading-snug text-paper-2">{t("roles.intro")}</p>
      </div>

      <div className="flex items-end gap-2">
      <label className="grid flex-1 gap-1.5">
        <span className="lbl">{t("roles.code")}</span>
        <input
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setMessage(null);
          }}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={12}
          placeholder="05BA59BA"
          className="tap mono w-full rounded-instrument border-[1.5px] border-line-soft bg-ink-900 px-3 text-[16px] tracking-[2px] text-paper uppercase placeholder:text-paper-3 focus:border-hv focus:outline-none"
        />
      </label>
        <button
          type="button"
          onClick={() => {
            setScanning((on) => !on);
            setMessage(null);
          }}
          aria-pressed={scanning}
          className={`tap mono shrink-0 rounded-instrument border-[1.5px] px-3 text-[10.5px] font-bold tracking-[1px] ${
            scanning ? "border-hv bg-ink-900 text-hv" : "border-line-soft text-paper-2"
          }`}
        >
          {t("roles.scan")}
        </button>
      </div>

      {scanning && (
        <QrScanner
          onDecode={(text) => {
            // The ME tab QR holds the bare 8-character device code.
            const scanned = text.replace(/[\s-]/g, "").toUpperCase();
            if (!/^[0-9A-F]{8}$/.test(scanned)) return;
            setCode(scanned);
            setScanning(false);
          }}
        />
      )}

      {code.trim() !== "" && !valid && (
        <p className="mono text-[10.5px] font-bold tracking-[0.5px] text-alarm" role="alert">
          {t("roles.code_invalid")}
        </p>
      )}

      <div className="grid gap-1.5">
        <span className="lbl">{t("roles.role")}</span>
        <div className="flex gap-2">
          {roleButton("volunteer")}
          {roleButton("official")}
        </div>
      </div>

      {valid ? (
        <HoldToConfirm
          label={t("roles.hold_grant")}
          holdingLabel={t("sos.cancelling")}
          tone="accent"
          onConfirm={() => void apply(cleaned, role)}
        />
      ) : (
        <button
          type="button"
          disabled
          className="tap rounded-instrument border-[1.5px] border-line-soft bg-ink-900 py-3 text-[13px] font-semibold text-paper-3 opacity-60"
        >
          {t("roles.hold_grant")}
        </button>
      )}

      {message && (
        <p
          className={`mono text-[10.5px] leading-relaxed font-bold tracking-[0.5px] ${message.ok ? "text-clear" : "text-alarm"}`}
          role="status"
        >
          {message.text}
        </p>
      )}

      <div className="grid gap-1.5 border-t-[1.5px] border-line-soft pt-3">
        <p className="lbl">{t("roles.staff")}</p>
        {staff === null ? (
          <p className="mono text-[11px] text-paper-3">—</p>
        ) : staff.length === 0 ? (
          <p className="text-[12px] text-paper-3">{t("roles.none")}</p>
        ) : (
          <ul className="grid gap-1.5">
            {staff.map((member) => {
              const isMe = member.userId === userId;
              const memberCode = deviceCodeOf(member.userId);
              return (
                <li
                  key={member.userId}
                  className="grid gap-2 rounded-[3px] border-[1.5px] border-line-soft bg-ink-900 px-3 py-2"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="mono text-[13px] font-bold tracking-[1.5px]">{memberCode}</span>
                    <span className="mono text-[10px] font-bold tracking-[0.8px] text-paper-2">
                      {t(`actor.${member.role}`)}
                    </span>
                    {isMe ? (
                      <span className="mono ml-auto text-[10px] font-bold tracking-[0.8px] text-hv">
                        {t("roles.you")}
                      </span>
                    ) : (
                      removing !== member.userId && (
                        <button
                          type="button"
                          onClick={() => {
                            setRemoving(member.userId);
                            setMessage(null);
                          }}
                          className="mono ml-auto text-[10px] font-bold tracking-[0.8px] text-alarm"
                        >
                          {t("roles.remove")}
                        </button>
                      )
                    )}
                  </div>
                  {removing === member.userId && (
                    <>
                      <HoldToConfirm
                        label={t("roles.hold_remove")}
                        holdingLabel={t("sos.cancelling")}
                        tone="alarm"
                        onConfirm={() => void apply(memberCode, "resident")}
                      />
                      <button
                        type="button"
                        onClick={() => setRemoving(null)}
                        className="mono text-[10.5px] font-bold tracking-[0.8px] text-paper-3"
                      >
                        {t("ce.cancel")}
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
