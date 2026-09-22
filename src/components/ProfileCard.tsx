"use client";

import { useState } from "react";
import { useT } from "./AppRuntime";
import { ProfileForm } from "./ProfileForm";
import { useMyProfile } from "./useMyProfile";

/** The ME tab: this device's name, and EDIT. */
export function ProfileCard() {
  const t = useT();
  const { profile, loaded } = useMyProfile();
  const [editing, setEditing] = useState(false);

  if (!loaded) return null;

  if (!profile || editing) {
    return (
      <ProfileForm
        initial={profile}
        title={t("profile.me")}
        onSaved={() => setEditing(false)}
        onLater={editing ? () => setEditing(false) : undefined}
      />
    );
  }

  return (
    <section className="grid gap-1.5 rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3.5 py-3">
      <div className="flex items-center gap-2">
        <p className="lbl flex-1">{t("profile.me")}</p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mono text-[10px] font-bold tracking-[0.8px] text-hv"
        >
          {t("profile.edit")}
        </button>
      </div>
      <p className="text-[15px] font-bold">
        {profile.first_name} {profile.last_name}
      </p>
      {profile.address && <p className="text-[12px] text-paper-2">{profile.address}</p>}
    </section>
  );
}
