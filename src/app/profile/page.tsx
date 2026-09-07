"use client";

import { useSync, useT } from "@/components/AppRuntime";
import { useMyRole } from "@/components/useMyRole";

/**
 * "Ako" — this device (design: `stage-2/design/artboards/DeviceRole.dc.html`).
 *
 * The screen that answers "what am I, and how do I become a volunteer". The
 * app has no login by design (Q2), so a person cannot be told their account;
 * what they can be told is their device code, which is the thing an official
 * needs in order to grant them a role. That is the whole purpose of this
 * screen and the reason the code is rendered large enough to read aloud across
 * a room.
 *
 * The role shown here is the one RLS actually grants, deliberately NOT the
 * actor selected in the demo switcher. If those two disagree the person needs
 * to see the real one — this is the only screen in the product where the
 * distinction is the point rather than an implementation detail.
 */
export default function ProfilePage() {
  const { userId, snapshot, purokId, queued, blocked, actor } = useSync();
  const t = useT();

  const role = useMyRole();

  const purok = snapshot?.puroks.find((p) => p.id === purokId);

  /*
   * The first segment of the uuid. Long enough to be unique across a
   * barangay's handful of devices, short enough to read out over a radio —
   * and it is not a secret: it identifies a row an official may already read.
   */
  const deviceCode = userId ? userId.slice(0, 8).toUpperCase() : null;

  return (
    <main className="flex flex-1 flex-col gap-3 p-3.5">
      <section className="rounded-instrument border-[1.5px] border-line-soft bg-ink-800 p-4">
        <p className="lbl">{t("me.device_code")}</p>
        <p className="mono mt-1.5 text-[28px] leading-none font-bold tracking-[2px] text-hv">
          {deviceCode ?? "—"}
        </p>
        <p className="mt-2 text-[11.5px] leading-snug text-paper-2">
          {t("me.device_hint")}
        </p>
      </section>

      <dl className="grid gap-2 @xl:grid-cols-2">
        <div className="rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3.5 py-3">
          <dt className="lbl">{t("me.role")}</dt>
          <dd className="mt-1 text-[14px] font-bold">
            {role ? t(`actor.${role}`) : "—"}
          </dd>
        </div>

        <div className="rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3.5 py-3">
          <dt className="lbl">{t("me.purok")}</dt>
          <dd className="mt-1 text-[14px] font-bold">{purok?.name ?? "—"}</dd>
        </div>
      </dl>

      {/*
       * Shown only when the selected view and the granted role differ, because
       * that is the moment someone is about to be confused by an empty screen
       * and blame the app rather than their permissions.
       */}
      {role && role !== actor && (
        <p className="mono rounded-instrument border-[1.5px] border-caution bg-ink-800 px-3 py-2.5 text-[10px] leading-relaxed tracking-[0.5px] text-caution">
          {t("me.actor_mismatch")}
        </p>
      )}

      <section className="rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3.5 py-3">
        <p className="lbl">{t("me.unsent")}</p>
        <p className="mono mt-1 text-[13px] font-bold">
          <span className={queued > 0 ? "text-caution" : "text-clear"}>
            {t("ui.queued", { n: queued })}
          </span>
          {blocked > 0 && (
            <span className="text-alarm"> · {t("ui.blocked", { n: blocked })}</span>
          )}
        </p>
      </section>
    </main>
  );
}
