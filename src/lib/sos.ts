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
import { getCurrentUserId, getSupabase } from "./supabase";

export type RescueStatus = "pending" | "acknowledged" | "rescued" | "cancelled";

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

/**
 * Start warming a GPS fix.
 *
 * Called when the SOS screen opens, not when the button is pressed, because a
 * cold first fix indoors can take 30 seconds or more and the tap must not wait
 * for it. By the time someone has decided to press the button there is usually
 * a fix ready; if there is not, the request goes without one.
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

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      lastFix = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        at: Date.now(),
      };
      onFix?.(lastFix, null);
    },
    (error) => onFix?.(lastFix, error.message),
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
  );

  return () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
  };
}

/** The best fix so far, or null. Never blocks. */
export function currentFix(): Fix | null {
  return lastFix;
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
export async function queuedRequests(): Promise<RescueRequest[]> {
  const rows = await queuedWrites();
  return rows
    .filter((row) => row.table === "rescue_requests" && !row.blocked)
    .map((row) => {
      const p = row.payload as Partial<RescueRequest>;
      return {
        id: row.id,
        purok_id: p.purok_id ?? null,
        lat: p.lat ?? null,
        lng: p.lng ?? null,
        accuracy_m: p.accuracy_m ?? null,
        status: "pending" as RescueStatus,
        ts: p.ts ?? new Date(row.createdAt).toISOString(),
        notes: p.notes ?? null,
        requested_by: p.requested_by ?? null,
        acknowledged_by: null,
      };
    });
}

/**
 * Everything this device has raised, server rows and still-queued ones
 * together. Server rows win on id collision: once a request has landed, the
 * server knows things the local copy cannot, such as who acknowledged it.
 */
export async function allMyRequests(): Promise<RescueRequest[]> {
  const [remote, local] = await Promise.all([myRequests(), queuedRequests()]);
  const byId = new Map<string, RescueRequest>();
  for (const row of local) byId.set(row.id, row);
  for (const row of remote) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => b.ts.localeCompare(a.ts));
}

/** Active means still needing a responder: pending or acknowledged. */
export const isActive = (r: RescueRequest) =>
  r.status === "pending" || r.status === "acknowledged";

/**
 * Every active request, oldest wait first (FR-4.6). Staff only — RLS returns
 * nothing to a resident, so this is safe to call unconditionally.
 */
export async function activeQueue(): Promise<RescueRequest[]> {
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
export function subscribeRescue(onChange: () => void): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};

  const channel = supabase
    .channel("rescue-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "rescue_requests" },
      () => onChange(),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
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
