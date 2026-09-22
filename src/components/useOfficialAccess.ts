"use client";

import { useEffect, useState } from "react";
import { useSync } from "./AppRuntime";
import { isUnlocked, myAccess, onUnlockChanged } from "@/lib/officialAccess";
import { onRoleChanged } from "@/lib/supabase";

/**
 * Whether the official pages are unlocked on this device this session, and
 * whether it has full administration. `unlocked` and `isSuper` are null until
 * known, and callers must not treat unknown as "no" — an official would be
 * bounced to the PIN screen for the moment it takes to read.
 */
export function useOfficialAccess(): { unlocked: boolean | null; isSuper: boolean | null } {
  const { userId } = useSync();
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [isSuper, setIsSuper] = useState<boolean | null>(null);

  useEffect(() => {
    const read = () => setUnlocked(isUnlocked());
    queueMicrotask(read);
    return onUnlockChanged(read);
  }, []);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    const read = () => {
      void myAccess().then((access) => {
        if (live) setIsSuper(access?.isSuper ?? false);
      });
    };
    read();
    const stop = onRoleChanged(read);
    return () => {
      live = false;
      stop();
    };
  }, [userId]);

  return { unlocked, isSuper };
}
