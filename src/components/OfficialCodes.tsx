"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "./AppRuntime";
import { HoldToConfirm } from "./HoldToConfirm";
import {
  createOfficialCode,
  deleteOfficialCode,
  listOfficialCodes,
  type OfficialCode,
} from "@/lib/officialLogin";

/**
 * Officials make each other's login codes (migration 0037). A new code is
 * shown once, here, and never again; the list shows only its last two
 * characters and which phone is using it.
 */
export function OfficialCodes() {
  const t = useT();
  const [codes, setCodes] = useState<OfficialCode[] | null>(null);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ code: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    const rows = await listOfficialCodes();
    if (rows) setCodes(rows);
  }, []);

  useEffect(() => {
    let live = true;
    void listOfficialCodes().then((rows) => {
      if (live && rows) setCodes(rows);
    });
    return () => {
      live = false;
    };
  }, []);

  const create = async () => {
    const label = name.trim();
    if (!label) return;
    setFailed(false);
    const code = await createOfficialCode(label);
    if (!code) {
      setFailed(true);
      return;
    }
    setCreated({ code, name: label });
    setName("");
    await reload();
  };

  return (
    <section className="grid gap-3 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3.5 py-3">
      <div>
        <p className="lbl">{t("codes.title")}</p>
        <p className="mt-1 text-[11.5px] leading-snug text-paper-2">{t("codes.intro")}</p>
      </div>

      {created && (
        <div className="grid gap-1.5 rounded-instrument border-[1.5px] border-caution bg-ink-900 px-3 py-2.5" role="status">
          <p className="mono text-center text-[24px] font-bold tracking-[2px] select-all">{created.code}</p>
          <p className="text-[11.5px] leading-snug font-semibold text-caution">
            {t("codes.new", { n: created.name })}
          </p>
          <button
            type="button"
            onClick={() => setCreated(null)}
            className="mono text-[10.5px] font-bold tracking-[0.8px] text-paper-3"
          >
            OK
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <label className="grid flex-1 gap-1.5">
          <span className="lbl">{t("codes.name")}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            className="tap w-full rounded-instrument border-[1.5px] border-line-soft bg-ink-900 px-3 text-[13.5px] text-paper focus:border-hv focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() => void create()}
          disabled={name.trim() === ""}
          className="tap mono shrink-0 rounded-instrument bg-hv px-3 text-[10.5px] font-bold tracking-[1px] text-hv-ink disabled:opacity-35"
        >
          {t("codes.create")}
        </button>
      </div>

      {failed && (
        <p className="mono text-[10.5px] font-bold tracking-[0.5px] text-alarm" role="alert">
          {t("roles.failed")}
        </p>
      )}

      {codes === null ? (
        <p className="mono text-[11px] text-paper-3">—</p>
      ) : codes.length === 0 ? (
        <p className="text-[12px] text-paper-3">{t("codes.none")}</p>
      ) : (
        <ul className="grid gap-1.5">
          {codes.map((code) => (
            <li
              key={code.id}
              className="grid gap-2 rounded-[3px] border-[1.5px] border-line-soft bg-ink-900 px-3 py-2"
            >
              <div className="flex items-center gap-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-semibold">{code.label}</p>
                  <p className="mono text-[9.5px] tracking-[0.6px] text-paper-3">
                    ••••-••••-{code.hint} ·{" "}
                    {code.holder_code ? t("codes.on", { n: code.holder_code }) : t("codes.unused")}
                  </p>
                </div>
                {deleting !== code.id && (
                  <button
                    type="button"
                    onClick={() => setDeleting(code.id)}
                    className="mono shrink-0 text-[10px] font-bold tracking-[0.8px] text-alarm"
                  >
                    {t("roles.remove")}
                  </button>
                )}
              </div>
              {deleting === code.id && (
                <>
                  <HoldToConfirm
                    label={t("codes.hold_delete")}
                    holdingLabel={t("sos.cancelling")}
                    tone="alarm"
                    onConfirm={() => {
                      void deleteOfficialCode(code.id).then((ok) => {
                        setDeleting(null);
                        if (!ok) setFailed(true);
                        void reload();
                      });
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setDeleting(null)}
                    className="mono text-[10.5px] font-bold tracking-[0.8px] text-paper-3"
                  >
                    {t("ce.cancel")}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
