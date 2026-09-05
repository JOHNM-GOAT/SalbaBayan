/**
 * Field diagnostics surface (PRD §7.3, §14).
 *
 * Attaches a small read-mostly API to `window.salbabayan` so the write queue
 * can be inspected and exercised from a browser console.
 *
 * Why this is deliberate rather than a debugging leftover:
 *
 *   - The queue is the one part of this app whose failure is invisible. A
 *     resident sees "report accepted" either way; only the device knows a row
 *     has been stuck for six hours. Someone at the barangay hall needs to be
 *     able to look.
 *   - It adds no attack surface. Everything here is per-device local data plus
 *     calls the page can already make — the anon key ships in the bundle by
 *     design, and the real boundary is RLS in Postgres, which this cannot
 *     touch. `scripts/rls-test.mjs` is what holds that line.
 *   - It gives the Phase 2 gate something real to test. The resident-facing
 *     write screens do not exist until Phase 3, and the offline write contract
 *     needs verifying before features are built on top of it, not after.
 */

import {
  blockedWrites,
  discardBlocked,
  enqueueWrite,
  flushQueue,
  queuedWrites,
  retryBlocked,
  type QueueTable,
} from "./offlineQueue";
import { getCurrentUserId } from "./supabase";
import { readCachedAdvisory } from "./advisory";

export type Diagnostics = {
  queued: () => Promise<unknown[]>;
  blocked: () => Promise<unknown[]>;
  flush: () => Promise<{ sent: number; remaining: number }>;
  enqueue: (
    table: QueueTable,
    payload: Record<string, unknown>,
  ) => Promise<{ id: string; synced: boolean }>;
  retry: (id: string) => Promise<void>;
  discard: () => Promise<number>;
  status: () => Promise<Record<string, unknown>>;
};

export function installDiagnostics(): void {
  if (typeof window === "undefined") return;

  const api: Diagnostics = {
    queued: () => queuedWrites(),
    blocked: () => blockedWrites(),
    flush: () => flushQueue(),
    enqueue: (table, payload) => enqueueWrite(table, payload),
    retry: (id) => retryBlocked(id),
    discard: () => discardBlocked(),

    async status() {
      const [pending, stuck, uid, snapshot] = await Promise.all([
        queuedWrites(),
        blockedWrites(),
        getCurrentUserId(),
        readCachedAdvisory(),
      ]);

      return {
        online: navigator.onLine,
        userId: uid,
        // `queuedWrites` returns every row, blocked ones included. Reporting
        // that as "queued" would disagree with the sync strip, which counts
        // only what is still going to be sent.
        queued: pending.filter((row) => !row.blocked).length,
        blocked: stuck.length,
        cacheAgeMs: snapshot ? Date.now() - snapshot.fetchedAt : null,
        signalLevel: snapshot?.barangay.current_signal_level ?? null,
        serviceWorker: (await navigator.serviceWorker?.getRegistrations?.())
          ?.length ?? 0,
      };
    },
  };

  (window as unknown as { salbabayan: Diagnostics }).salbabayan = api;
}
