"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { ProfileForm } from "./ProfileForm";
import { useMyProfile } from "./useMyProfile";
import { useSync } from "./AppRuntime";

const LATER_KEY = "salbabayan.profile.later";

/*
 * Never over these: SOS must work before anything is typed, an official
 * logging in is not a resident being asked for a name, and the report screen
 * and ME tab already show the same form in the page.
 */
const NEVER_ON = ["/sos", "/official-login", "/report", "/profile"];

function laterThisSession(): boolean {
  try {
    return sessionStorage.getItem(LATER_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Asks a device with no name for one, the first time it opens the app.
 *
 * It can be put off (LATER, until the app is next opened): reading the
 * warning, the map and SOS must never wait on a form. Reports cannot be — the
 * report screen asks again, with no LATER, before anything is sent.
 */
export function ProfilePrompt() {
  const pathname = usePathname();
  const { profile, loaded } = useMyProfile();
  const { actor } = useSync();
  const [later, setLater] = useState(laterThisSession);

  if (!loaded || profile || later || NEVER_ON.includes(pathname)) return null;

  return (
    // Stops above the tab bar, so the SOS button stays reachable underneath.
    // Officials have no tab bar.
    <div
      className="fixed inset-x-0 top-0 z-50 flex items-end justify-center bg-paper/30 p-3 sm:items-center"
      style={{ bottom: actor === "official" ? 0 : "calc(74px + env(safe-area-inset-bottom))" }}
    >
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto" role="dialog" aria-modal="true">
        <ProfileForm
          onLater={() => {
            try {
              sessionStorage.setItem(LATER_KEY, "1");
            } catch {
              // Not remembered; it simply asks again on the next screen.
            }
            setLater(true);
          }}
        />
      </div>
    </div>
  );
}
