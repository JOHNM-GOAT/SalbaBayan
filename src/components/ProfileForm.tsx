"use client";

import { useState } from "react";
import { useT } from "./AppRuntime";
import { cleanName, saveMyProfile, type Profile } from "@/lib/profile";

/**
 * First name, last name (both required), address (optional), with the privacy
 * notice the Data Privacy Act asks for at the point of collection.
 */
export function ProfileForm({
  initial,
  onSaved,
  onLater,
  title,
}: {
  initial?: Profile | null;
  onSaved?: () => void;
  /** Shown only where skipping is allowed (never on the report screen). */
  onLater?: () => void;
  title?: string;
}) {
  const t = useT();
  const [first, setFirst] = useState(initial?.first_name ?? "");
  const [last, setLast] = useState(initial?.last_name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [busy, setBusy] = useState(false);

  const valid = cleanName(first) !== "" && cleanName(last) !== "";

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    options: { autoComplete: string; placeholder?: string; max: number },
  ) => (
    <label className="grid gap-1.5">
      <span className="lbl">{label}</span>
      <input
        value={value}
        onChange={(event) => set(event.target.value)}
        autoComplete={options.autoComplete}
        placeholder={options.placeholder}
        maxLength={options.max}
        className="tap w-full rounded-instrument border-[1.5px] border-line-soft bg-ink-900 px-3 text-[14px] text-paper placeholder:text-paper-3 focus:border-hv focus:outline-none"
      />
    </label>
  );

  return (
    <form
      className="grid gap-3 rounded-instrument border-[1.5px] border-hv bg-ink-800 px-3.5 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || busy) return;
        setBusy(true);
        void saveMyProfile({ first_name: first, last_name: last, address }).then((ok) => {
          setBusy(false);
          if (ok) onSaved?.();
        });
      }}
    >
      <div>
        <p className="font-display text-[17px] font-extrabold tracking-[0.3px]">
          {title ?? t("profile.title")}
        </p>
        <p className="mt-1 text-[12px] leading-snug text-paper-2">{t("profile.intro")}</p>
      </div>

      {field(t("profile.first"), first, setFirst, { autoComplete: "given-name", max: 60 })}
      {field(t("profile.last"), last, setLast, { autoComplete: "family-name", max: 60 })}
      {field(t("profile.address"), address, setAddress, {
        autoComplete: "street-address",
        placeholder: t("profile.address_hint"),
        max: 160,
      })}

      <p className="text-[10.5px] leading-snug text-paper-3">{t("profile.privacy")}</p>

      <button
        type="submit"
        disabled={!valid || busy}
        className="tap rounded-instrument bg-hv text-[13px] font-bold text-hv-ink disabled:opacity-35"
      >
        {t("profile.save")}
      </button>

      {onLater && (
        <button
          type="button"
          onClick={onLater}
          className="mono text-[10.5px] font-bold tracking-[0.8px] text-paper-3"
        >
          {t("profile.later")}
        </button>
      )}
    </form>
  );
}
