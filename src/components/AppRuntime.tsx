"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { ensureAnonymousSession } from "@/lib/supabase";
import {
  flushQueue,
  onQueueChanged,
  queuedCount,
  startQueueFlushListener,
} from "@/lib/offlineQueue";

/**
 * Connection and sync state, made available to every screen.
 *
 * PRD §6 and FR-3.5: cache age and queued-write count are ALWAYS visible —
 * never a toast that disappears. That is why this lives in a provider rather
 * than being fetched per-screen: no screen is allowed to omit it.
 */
export type SyncState = {
  online: boolean;
  queued: number;
  /** ms since the last successful server read, or null if never synced. */
  cacheAgeMs: number | null;
  userId: string | null;
  flushNow: () => void;
};

const SyncContext = createContext<SyncState>({
  online: true,
  queued: 0,
  cacheAgeMs: null,
  userId: null,
  flushNow: () => {},
});

export const useSync = () => useContext(SyncContext);

const LAST_SYNC_KEY = "salbabayan.lastSyncAt";

export function markSynced(): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  } catch {
    // Storage can be unavailable (private mode). Cache age simply reads as
    // unknown, which the UI renders honestly rather than guessing.
  }
}

export function AppRuntime({ children }: { children: React.ReactNode }) {
  // Start optimistic: navigator.onLine is unavailable during SSR, and assuming
  // offline would flash a false warning on every first paint.
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [cacheAgeMs, setCacheAgeMs] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);

    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);

    // Silent anonymous sign-in: no screen, no credentials, but a real uid for
    // RLS to key off. Failing soft is correct — offline, the cached session
    // (if any) still carries the identity.
    void ensureAnonymousSession().then(setUserId);

    const stopFlush = startQueueFlushListener();
    const refreshCount = () => void queuedCount().then(setQueued);
    const unsubscribe = onQueueChanged(refreshCount);
    refreshCount();

    const tick = window.setInterval(() => {
      const raw = localStorage.getItem(LAST_SYNC_KEY);
      setCacheAgeMs(raw ? Date.now() - Number(raw) : null);
    }, 1000);

    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      stopFlush();
      unsubscribe();
      window.clearInterval(tick);
    };
  }, []);

  const value: SyncState = {
    online,
    queued,
    cacheAgeMs,
    userId,
    flushNow: () => void flushQueue(),
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
