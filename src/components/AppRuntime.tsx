"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { ensureAnonymousSession, getMyRole, type UserRole } from "@/lib/supabase";
import {
  flushQueue,
  onQueueChanged,
  queuedCount,
  blockedCount,
  startQueueFlushListener,
} from "@/lib/offlineQueue";
import {
  readCachedAdvisory,
  refreshAdvisory,
  type AdvisorySnapshot,
} from "@/lib/advisory";
import { isLanguage, translate, type Language } from "@/lib/i18n";
import { actorPref, languagePref, noStoredValue, purokPref } from "@/lib/prefs";
import { actorForRole, isActorId, type ActorId } from "@/lib/actors";
import { startPhotoFlushListener } from "@/lib/photoQueue";
import { installDiagnostics } from "@/lib/diagnostics";

/**
 * Connection, sync and advisory state, made available to every screen.
 *
 * PRD §6 and FR-3.5: cache age and queued-write count are ALWAYS visible —
 * never a toast that disappears. That is why this lives in a provider rather
 * than being fetched per-screen: no screen is allowed to omit it.
 *
 * The advisory snapshot lives here too, so language and Purok changes are
 * derivations from data already in memory rather than refetches. That is what
 * lets both switch offline, with no reload (the §7.2 acceptance criterion).
 */
export type SyncState = {
  online: boolean;
  queued: number;
  /** Writes this device gave up on. Distinct from queued — they will not send. */
  blocked: number;
  /** ms since the last successful *network* read, or null if never synced. */
  cacheAgeMs: number | null;
  userId: string | null;
  snapshot: AdvisorySnapshot | null;
  /** True only before the first cache read resolves — not during a refetch. */
  loading: boolean;
  language: Language;
  setLanguage: (language: Language) => void;
  purokId: string | null;
  setPurokId: (purokId: string) => void;
  /** Which actor's screens to present. Presentation only — never a permission. */
  actor: ActorId;
  setActor: (actor: ActorId) => void;
  flushNow: () => void;
  refresh: () => void;
};

const SyncContext = createContext<SyncState>({
  online: true,
  queued: 0,
  blocked: 0,
  cacheAgeMs: null,
  userId: null,
  snapshot: null,
  loading: true,
  language: "tl",
  setLanguage: () => {},
  purokId: null,
  setPurokId: () => {},
  actor: "resident",
  setActor: () => {},
  flushNow: () => {},
  refresh: () => {},
});

export const useSync = () => useContext(SyncContext);

/**
 * Message lookup bound to the current snapshot and language.
 *
 * Returns the key itself when the snapshot has not loaded, which keeps the
 * first frame from flashing empty chrome and makes a missing key obvious on
 * screen instead of invisible.
 */
export function useT() {
  const { snapshot, language } = useSync();
  return useCallback(
    (key: string, vars?: { n?: string | number }) =>
      translate(
        snapshot?.translations ?? {},
        key,
        language,
        snapshot?.barangay.default_language ?? "tl",
        vars,
      ),
    [snapshot, language],
  );
}

/**
 * Connectivity read as an external store rather than mirrored into state.
 *
 * `navigator.onLine` is browser-owned and can already be false before React
 * hydrates, so copying it into state inside an effect meant the first paint
 * was always "online" and only corrected on a second render. Subscribing reads
 * the true value at render time instead.
 */
function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function AppRuntime({ children }: { children: React.ReactNode }) {
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    // SSR has no navigator. Assume online so first paint never flashes a false
    // offline warning at a resident who is in fact connected.
    () => true,
  );

  const [queued, setQueued] = useState(0);
  const [blocked, setBlocked] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AdvisorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  // Read at render time from the browser rather than copied into state, so the
  // first paint already reflects the resident's saved choice.
  const storedLanguage = useSyncExternalStore(
    languagePref.subscribe,
    languagePref.get,
    noStoredValue,
  );
  const storedPurok = useSyncExternalStore(
    purokPref.subscribe,
    purokPref.get,
    noStoredValue,
  );
  const storedActor = useSyncExternalStore(
    actorPref.subscribe,
    actorPref.get,
    noStoredValue,
  );

  /*
   * The role RLS actually grants this device, used only to pick which actor a
   * device starts as. A volunteer's phone should open on the volunteer home
   * without anyone choosing it. It is a default, not a gate — see lib/actors.
   */
  const [deviceRole, setDeviceRole] = useState<UserRole>("resident");

  useEffect(() => {
    if (!userId) return;
    void getMyRole().then(setDeviceRole);
  }, [userId]);

  /**
   * Cache-first, then revalidate.
   *
   * The cached snapshot is painted before the network is even attempted, which
   * is what meets NFR-3.1 (advisory renders in under a second on a cold offline
   * start). A failed refresh is not an error state — it just means the resident
   * keeps the last known advisory, with its age shown honestly.
   */
  const load = useCallback(async () => {
    const cached = await readCachedAdvisory();
    if (cached) {
      setSnapshot(cached);
      setLoading(false);
    }

    /*
     * Sign in BEFORE fetching, not alongside it.
     *
     * Every advisory policy is scoped `to authenticated`, so a read that races
     * the anonymous sign-in comes back as an empty array rather than an error
     * — indistinguishable from "this barangay has no data configured". On a
     * first-ever load that produced a permanent empty state until the resident
     * happened to reload. Awaiting identity first costs one round trip and
     * removes the race entirely.
     */
    const uid = await ensureAnonymousSession();
    setUserId(uid);

    const fresh = await refreshAdvisory();
    if (fresh) setSnapshot(fresh);
    setLoading(false);
  }, []);

  useEffect(() => {
    /*
     * The initial read. `load` only ever calls setState after an await, so
     * nothing here updates state synchronously during the effect — but the
     * lint rule cannot see across the async boundary and flags the call.
     * Deferring to a microtask makes the asynchrony explicit rather than
     * suppressing the warning, and costs one tick.
     */
    installDiagnostics();

    queueMicrotask(() => void load());

    // Refetch the moment connectivity returns, so a resident who regains
    // signal is not left reading a stale advisory until they think to reload.
    // Subscribing here rather than reacting to the `online` value keeps this
    // an effect that talks to an external system, which is what effects are
    // for — deriving it from state would re-run on unrelated renders.
    const onReconnect = () => void load();
    window.addEventListener("online", onReconnect);

    const stopFlush = startQueueFlushListener();
    // Photos retry on their own schedule — see lib/photoQueue.ts for why they
    // are not part of the ordered row queue.
    const stopPhotos = startPhotoFlushListener();
    const refreshCount = () => {
      void queuedCount().then(setQueued);
      void blockedCount().then(setBlocked);
    };
    const unsubscribe = onQueueChanged(refreshCount);
    refreshCount();

    // Drives both the cache-age readout and the leave-by countdown. One timer
    // for both, so they can never disagree about what time it is.
    const tick = window.setInterval(() => setNow(Date.now()), 1000);

    return () => {
      window.removeEventListener("online", onReconnect);
      stopFlush();
      stopPhotos();
      unsubscribe();
      window.clearInterval(tick);
    };
  }, [load]);

  const setLanguage = useCallback((language: Language) => {
    languagePref.set(language);
  }, []);

  const setPurokId = useCallback((id: string) => {
    purokPref.set(id);
  }, []);

  const setActor = useCallback((next: ActorId) => {
    actorPref.set(next);
  }, []);

  /**
   * The resident's explicit choice wins; otherwise the barangay's configured
   * default (FR-3.5), not a hard-coded language.
   */
  /* An explicit choice wins; otherwise the device's own role decides. */
  const actor: ActorId = isActorId(storedActor)
    ? storedActor
    : actorForRole(deviceRole);

  const language: Language = useMemo(() => {
    if (isLanguage(storedLanguage)) return storedLanguage;
    const configured = snapshot?.barangay.default_language;
    return isLanguage(configured) ? configured : "tl";
  }, [storedLanguage, snapshot]);

  const value: SyncState = {
    online,
    queued,
    blocked,
    cacheAgeMs: snapshot ? now - snapshot.fetchedAt : null,
    userId,
    snapshot,
    loading,
    language,
    setLanguage,
    // A stored Purok id from a previous barangay's data would resolve to
    // nothing, so it is validated against the snapshot before being trusted.
    purokId:
      snapshot?.puroks.find((p) => p.id === storedPurok)?.id ??
      snapshot?.puroks[0]?.id ??
      null,
    setPurokId,
    actor,
    setActor,
    flushNow: () => void flushQueue(),
    refresh: () => void load(),
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
