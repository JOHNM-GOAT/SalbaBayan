"use client";

import { useSyncExternalStore } from "react";
import { useSync } from "./AppRuntime";
import { centrePref, noStoredValue } from "@/lib/prefs";

/**
 * The evacuation centre this staff phone counts into, remembered on the phone
 * (lib/prefs.ts). Falls back to the first centre when nothing is chosen yet or
 * the chosen one was removed.
 */
export function useMyCentre() {
  const { snapshot } = useSync();
  const stored = useSyncExternalStore(centrePref.subscribe, centrePref.get, noStoredValue);
  const centres = snapshot?.centers ?? [];
  const centre = centres.find((c) => c.id === stored) ?? centres[0] ?? null;
  return { centres, centre, setCentre: centrePref.set };
}
