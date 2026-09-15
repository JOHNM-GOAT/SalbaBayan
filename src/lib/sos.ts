/**
 * One-tap SOS (PRD §7.4, FR-4.1..4.6).
 *
 * The governing rule for this file: nothing may stand between the tap and a
 * durable record of it. Not the network, not GPS, not a login, not a
 * confirmation dialog. Everything else — a precise fix, delivery, a responder
 * — arrives afterwards and is reported honestly as it does.
 */

import {
  enqueueUpdate,
  enqueueWrite,
  newClientId,
  queuedWrites,
} from "./offlineQueue";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getCurrentUserId, getSupabase } from "./supabase";
import {
  mergeRequests,
  queuedInserts,
  queuedPatches,
  type RescueStatus,
} from "./rescueMerge";

/* Re-exported from the pure module so there is one definition, not two that
   can drift — the same arrangement as lib/ledger.ts and lib/token.ts. */
export type { RescueStatus };

export type RescueRequest = {
  id: string;
  purok_id: string | null;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  status: RescueStatus;
  /** When the resident tapped — NOT when the row arrived. Drives the timer. */
  ts: string;
  notes: string | null;
  requested_by: string | null;
  acknowledged_by: string | null;
};

/* ---------------------------------------------------------------------------
 * Position
 * ------------------------------------------------------------------------ */

export type Fix = { lat: number; lng: number; accuracy: number; at: number };

let lastFix: Fix | null = null;
let watchId: number | null = null;
const fixListeners = new Set<(fix: Fix | null, error: string | null) => void>();

/**
 * How old a fix may be before it stops describing where you are now.
 *
 * `currentFix` is read at the moment a report is filed, and `lastFix` outlives
 * the screen that produced it — so without this a hazard filed at the far end
 * of the barangay could be stamped with the coordinates of wherever the
 * resident happened to be when they last opened the map. A pin that is
 * confidently in the wrong street is worse than a report with no pin at all,
 * because the second one says so and the first one does not.
 */
const FIX_MAX_AGE_MS = 5 * 60_000;

/**
 * Start warming a GPS fix.
 *
 * Called when a screen that may need a position opens, not when the button is
 * pressed, because a cold first fix indoors can take 30 seconds or more and the
 * tap must not wait for it. By the time someone has decided to press the button
 * there is usually a fix ready; if there is not, the request goes without one.
 *
 * ONE watch, many callers — the same shape `subscribeRescue` and
 * `subscribeHazards` grew, and for a worse reason than either of them.
 * `watchId` is module-global, so a second caller used to overwrite it and the
 * first watch leaked for the life of the tab; worse, the FIRST caller's cleanup
 * then cleared the SECOND caller's watch. Next.js can mount an incoming route
 * before unmounting the outgoing one, so walking from the map to the SOS screen
 * could silently kill the SOS screen's watch and leave the one screen that most
 * needs a position without one. Refcounting removes the whole class: callers
 * never have to know how many other screens are watching.
 *
 * Requires a secure context — HTTPS or localhost. Over a plain-HTTP LAN address
 * (testing on a phone against a dev machine) browsers refuse silently, which is
 * why failures here are surfaced rather than swallowed.
 */
export function startPositionWatch(
  onFix?: (fix: Fix | null, error: string | null) => void,
): () => void {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    onFix?.(null, "walang GPS sa device na ito");
    return () => {};
  }

  if (!window.isSecureContext) {
    // Worth stating plainly rather than reporting as a permission failure: the
    // browser is refusing the API outright, and no amount of granting helps.
    onFix?.(null, "kailangan ng HTTPS para sa GPS");
    return () => {};
  }

  if (onFix) {
    fixListeners.add(onFix);
    // A late subscriber gets the warm fix immediately rather than waiting for
    // the next satellite update, which can be seconds away and is the whole
    // reason the watch is started early.
    if (lastFix) onFix(lastFix, null);
  }

  if (watchId === null) {
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        lastFix = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          at: Date.now(),
        };
        // Copied before notifying: a listener may unsubscribe in response.
        for (const listener of [...fixListeners]) listener(lastFix, null);
      },
      (error) => {
        for (const listener of [...fixListeners]) listener(lastFix, error.message);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }

  return () => {
    if (onFix) fixListeners.delete(onFix);

    // Stop the receiver only when nobody is left. Holding it open for a screen
    // that has closed is a real cost on a phone that may need its battery for
    // another two days.
    if (fixListeners.size === 0 && watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  };
}

/**
 * The best fix so far, or null if there is none or it has gone stale.
 * Never blocks — a report is never held up waiting for a satellite.
 */
export function currentFix(): Fix | null {
  if (!lastFix) return null;
  return Date.now() - lastFix.at <= FIX_MAX_AGE_MS ? lastFix : null;
}

/** True while a position watch is running, so a screen can say whether a
    report it files is going to carry a location. */
export function hasPositionWatch(): boolean {
  return watchId !== null;
}

/* ---------------------------------------------------------------------------
 * Raising a request
 * ------------------------------------------------------------------------ */

/**
 * Raise an SOS. Returns as soon as the request is durable on this device.
 *
 * `ts` is set here, from the client clock, and that is deliberate: it is the
 * moment the person actually pressed the button. A request queued offline for
 * forty minutes must show a forty-minute wait on the responder map. Letting
 * Postgres default it to arrival time would reset every offline request's
 * clock to zero — the exact failure the Phase 3 gate checks for.
 */
export async function raiseSOS(purokId: string | null, notes?: string) {
  const fix = currentFix();

  return enqueueWrite("rescue_requests", {
    id: newClientId(),
    purok_id: purokId,
    // Null is a supported outcome, not an error. See migration 0006: blocking
    // a distress call on a satellite fix is the wrong trade.
    lat: fix?.lat ?? null,
    lng: fix?.lng ?? null,
    accuracy_m: fix?.accuracy ?? null,
    status: "pending",
    ts: new Date().toISOString(),
    notes: notes ?? null,
  });
}

/**
 * Cancel. Separate from raising so the UI can require a deliberate hold
 * (FR-4.5) — a panicked mis-tap must not be able to withdraw a distress call.
 */
export async function cancelSOS(id: string): Promise<boolean> {
  // Through the queue, not straight to Supabase. A resident may well cancel
  // while offline — they got out on their own, or a neighbour reached them —
  // and a cancel that evaporates sends a rescue team through a storm to
  // someone already safe, using capacity somebody else needs.
  await enqueueUpdate("rescue_requests", id, { status: "cancelled" });
  return true;
}

/* ---------------------------------------------------------------------------
 * Reading
 * ------------------------------------------------------------------------ */

/**
 * This device's requests. RLS already scopes the result to
 * `requested_by = auth.uid()`, so there is no client-side filter to forget.
 */
export async function myRequests(): Promise<RescueRequest[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const uid = await getCurrentUserId();
  if (!uid) return [];

  const { data, error } = await supabase
    .from("rescue_requests")
    .select("id,purok_id,lat,lng,accuracy_m,status,ts,notes,requested_by,acknowledged_by")
    .order("ts", { ascending: false })
    .limit(10);

  if (error) return [];
  return (data ?? []) as RescueRequest[];
}

/**
 * Requests still sitting in the local write queue, presented as if they were
 * rows.
 *
 * Without this the SOS screen is blind to its own request while offline:
 * `myRequests` reads the server, the server cannot be reached, so the screen
 * has nothing to time and the resident watches a frozen 00:00 on a distress
 * call they just raised. The queued payload already carries the tap time, so
 * the timer can run correctly from the moment of the press, with or without a
 * network.
 *
 * Status is always `pending` here by definition — a row nobody has received
 * cannot have been acknowledged.
 */
/** One place that knows how a queued insert becomes a displayable request. */
const buildQueued = (
  p: Record<string, unknown>,
  id: string,
  ts: string,
): RescueRequest => ({
  id,
  purok_id: (p.purok_id as string) ?? null,
  lat: (p.lat as number) ?? null,
  lng: (p.lng as number) ?? null,
  accuracy_m: (p.accuracy_m as number) ?? null,
  // A row nobody has received cannot have been acknowledged.
  status: 'pending' as RescueStatus,
  ts,
  notes: (p.notes as string) ?? null,
  requested_by: (p.requested_by as string) ?? null,
  acknowledged_by: null,
});

export async function queuedRequests(): Promise<RescueRequest[]> {
  const rows = await queuedWrites();
  return queuedInserts<RescueRequest>(rows, buildQueued);
}

/**
 * Everything this device has raised, server rows and the queue together.
 *
 * See lib/rescueMerge.ts for why queued updates are applied as patches rather
 * than materialised as requests — doing the latter made a cancelled SOS
 * reappear with its timer restarting from zero.
 */
export async function allMyRequests(): Promise<RescueRequest[]> {
  const [remote, rows] = await Promise.all([myRequests(), queuedWrites()]);
  const local = queuedInserts<RescueRequest>(rows, buildQueued);
  return mergeRequests<RescueRequest>(remote, local, queuedPatches(rows));
}

export const isActive = (r: RescueRequest) =>
  r.status === "pending" || r.status === "acknowledged";

/**
 * Every active request the SERVER knows about. Staff only — RLS returns
 * nothing to a resident, so this is safe to call unconditionally.
 *
 * Not what the responder screen renders; see `fullActiveQueue`.
 */
async function remoteActiveQueue(): Promise<RescueRequest[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("rescue_requests")
    .select("id,purok_id,lat,lng,accuracy_m,status,ts,notes,requested_by,acknowledged_by")
    .in("status", ["pending", "acknowledged"])
    .order("ts", { ascending: true });

  if (error) return [];
  return (data ?? []) as RescueRequest[];
}

/**
 * Every active request, oldest wait first (FR-4.6), with this device's own
 * un-flushed acknowledgements and rescues applied.
 *
 * The merge is the whole point, and its absence was a real bug rather than a
 * missing nicety. `acknowledge` and `markRescued` go through the write queue —
 * deliberately, so a momentary drop at the barangay hall cannot lose an
 * acknowledgement a resident is watching for on their own screen — but this
 * function read the server and nothing else. So the `.then(refresh)` after a
 * tap re-read a row that had not changed yet, and ACKNOWLEDGE appeared to do
 * nothing at all. The responder taps again. And again.
 *
 * That is the same failure as "I marked it fixed and it still says
 * UNRESOLVED", which `mergeHazards` was written for, and as the cancelled SOS
 * that came back, which `mergeRequests` was written for. Both of those were
 * fixed on the resident's side. This is the third face of it, on the one screen
 * where the delay costs a dispatch rather than a re-tap.
 *
 * Queued INSERTS are deliberately not folded in: this is the barangay's queue
 * of other people's requests, and a request this device raised but has not yet
 * sent is not something the hall can act on. `mergeRequests` is given an empty
 * local list for exactly that reason.
 */
export async function activeQueue(): Promise<RescueRequest[]> {
  const [remote, rows] = await Promise.all([remoteActiveQueue(), queuedWrites()]);

  const merged = mergeRequests<RescueRequest>([], remote, queuedPatches(rows));

  return (
    merged
      // A request this device has locally marked rescued or cancelled leaves the
      // working queue immediately. Leaving it in would send someone twice.
      .filter(isActive)
      // `mergeRequests` sorts newest first, which is right for a resident
      // reading their own history and wrong here: FR-4.6 is longest wait first.
      .sort((a, b) => a.ts.localeCompare(b.ts))
  );
}

/**
 * Responder actions. These also go through the queue — not because the
 * responder desk is expected to be offline (it is not), but because a
 * momentary drop must not silently lose an acknowledgement that a resident is
 * watching for on their own screen.
 */
export async function acknowledge(id: string): Promise<boolean> {
  const uid = await getCurrentUserId();
  await enqueueUpdate("rescue_requests", id, {
    status: "acknowledged",
    acknowledged_by: uid,
  });
  return true;
}

export async function markRescued(id: string): Promise<boolean> {
  await enqueueUpdate("rescue_requests", id, { status: "rescued" });
  return true;
}

/**
 * Live updates via Realtime (FR-4.6, NFR-3.3: under 5s). Returns an
 * unsubscribe. Falls back to nothing when there is no client — callers keep
 * whatever they last read rather than showing an empty queue.
 */
let liveChannel: RealtimeChannel | null = null;
const liveListeners = new Set<() => void>();

export function subscribeRescue(onChange: () => void): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};

  /*
   * ONE channel, many listeners.
   *
   * supabase-js hands back the same channel object for a repeated topic, and
   * once `.subscribe()` has run you cannot add further `postgres_changes`
   * bindings to it — it throws. That became reachable the moment the rescue
   * count moved onto the tab bar: the badge subscribes on every screen, so on
   * `/responder` and `/sos` there are two simultaneous subscribers to
   * "rescue-live" and the second one blew up the page.
   *
   * Multiplexing rather than giving each caller its own channel name: a
   * per-caller channel would open a second websocket subscription for the same
   * rows, which costs a Realtime connection per mounted component for no gain.
   */
  liveListeners.add(onChange);

  if (!liveChannel) {
    liveChannel = supabase
      .channel("rescue-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rescue_requests" },
        () => {
          // Copied first: a listener may unsubscribe while being notified.
          for (const listener of [...liveListeners]) listener();
        },
      )
      .subscribe();
  }

  return () => {
    liveListeners.delete(onChange);

    // Tear the channel down only when nobody is left, and drop the reference
    // first so a subscriber arriving mid-teardown builds a fresh one.
    if (liveListeners.size === 0 && liveChannel) {
      const channel = liveChannel;
      liveChannel = null;
      void supabase.removeChannel(channel);
    }
  };
}

/* ---------------------------------------------------------------------------
 * Presentation
 * ------------------------------------------------------------------------ */

/** `MM:SS` under an hour, `H:MM:SS` beyond. Counts from the tap. */
export function elapsedSince(iso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function waitMinutes(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}
