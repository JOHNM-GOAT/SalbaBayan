"use client";

import { useEffect, useState } from "react";
import { useSync } from "./AppRuntime";
import { loadMyProfile, onProfileChanged, type Profile } from "@/lib/profile";

/**
 * This device's name, and whether that answer is in yet. `loaded` false means
 * "not known yet", which must not be shown as "no name": the prompt would
 * flash at people who already gave one.
 */
export function useMyProfile(): { profile: Profile | null; loaded: boolean } {
  const { userId } = useSync();
  const [state, setState] = useState<{ profile: Profile | null; loaded: boolean }>({
    profile: null,
    loaded: false,
  });

  useEffect(() => {
    if (!userId) return;
    let live = true;
    const read = () => {
      void loadMyProfile().then((profile) => {
        if (live) setState({ profile, loaded: true });
      });
    };
    read();
    const stop = onProfileChanged(read);
    return () => {
      live = false;
      stop();
    };
  }, [userId]);

  return state;
}
