import { enqueueUpdate, enqueueWrite, newClientId } from "./offlineQueue";
import { getCurrentUserId, getSupabase } from "./supabase";

/**
 * Alerts that arrive when the app is closed.
 *
 * Everything else this product does to raise an alarm needs somebody to be
 * looking at it already: the tab badge, the dashboard queue, the sound. At two
 * in the morning a phone is in a pocket with the screen off, and that is when
 * a river rises. This is the one path that reaches a volunteer who is asleep.
 *
 * Staff only, and opt-in per device. A notification is a capability over
 * somebody's attention at an hour they did not choose, so nobody is subscribed
 * without pressing the button themselves.
 */

export type PushState =
  /** No Service Worker, no PushManager, or iOS Safari outside an installed app. */
  | "unsupported"
  /** The person said no, or the browser decided for them. Only they can undo it. */
  | "blocked"
  /** Supported and permitted, but this device is not subscribed. */
  | "off"
  | "on"
  /** Not known yet — the registration has not been read. */
  | "unknown";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** The VAPID public key, from the database rather than a build-time env var. */
async function serverKey(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("push_settings")
    .select("vapid_public_key")
    .maybeSingle();
  return data?.vapid_public_key ?? null;
}

/**
 * base64url -> the bytes `applicationServerKey` wants.
 *
 * An ArrayBuffer rather than a Uint8Array: since TypeScript 5.7 a plain
 * `Uint8Array` is generic over its backing buffer and no longer satisfies
 * `BufferSource`, which is declared over `ArrayBuffer` alone.
 */
function keyBytes(base64url: string): ArrayBuffer {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buffer;
}

/** The browser's own view: is this device subscribed right now? */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    return existing ? "on" : "off";
  } catch {
    return "unknown";
  }
}

/**
 * Subscribe this device.
 *
 * Must be called from a tap: `Notification.requestPermission()` is only
 * granted from a user gesture, and a prompt that appears on page load is the
 * prompt everybody dismisses without reading.
 *
 * The row goes through the write queue like every other write in this app
 * (scripts/check-write-paths.mjs enforces that), which also means it survives
 * a subscription made in a dead spot: the browser registers immediately and
 * the server learns about it when there is a signal.
 */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";

  const key = await serverKey();
  if (!key) return "off";

  const uid = await getCurrentUserId();
  if (!uid) return "off";

  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      // Without this the browser would accept a payload-less subscription that
      // no third party could authenticate. Chrome refuses it outright.
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key),
    }));

  const json = subscription.toJSON();
  if (!json.keys?.p256dh || !json.keys?.auth) return "off";

  /*
   * Reuse the row this endpoint already has, if it has one. The queue upserts
   * on `id`, and `endpoint` is unique — so a new id for an endpoint already in
   * the table is a constraint violation, and the write would be blocked rather
   * than the subscription re-enabled.
   */
  const supabase = getSupabase();
  const { data: existing } = supabase
    ? await supabase
        .from("push_subscriptions")
        .select("id")
        .eq("endpoint", subscription.endpoint)
        .maybeSingle()
    : { data: null };

  if (existing?.id) {
    await enqueueUpdate("push_subscriptions", existing.id, {
      active: true,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    });
  } else {
    await enqueueWrite("push_subscriptions", {
      id: newClientId(),
      user_id: uid,
      endpoint: subscription.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      active: true,
    });
  }

  return "on";
}

/**
 * Stop this device receiving alerts.
 *
 * Both halves, and both matter. The browser subscription is dropped so nothing
 * can arrive even if a row is missed, and the row is switched off so the
 * sender stops trying. Doing only the first leaves the barangay's sender
 * hammering a dead endpoint; only the second leaves a volunteer who asked for
 * silence still being woken up until the next flush.
 */
export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return "off";

  const supabase = getSupabase();
  const { data: existing } = supabase
    ? await supabase
        .from("push_subscriptions")
        .select("id")
        .eq("endpoint", subscription.endpoint)
        .maybeSingle()
    : { data: null };

  if (existing?.id) await enqueueUpdate("push_subscriptions", existing.id, { active: false });

  await subscription.unsubscribe().catch(() => {});
  return "off";
}

/**
 * Ask the barangay's sender to wake the staff for this request.
 *
 * Called when the row actually lands in Postgres, not when the button was
 * pressed — those can be an hour apart through the write queue, and a
 * notification for a request the server has never heard of would send somebody
 * out to a map with nothing on it.
 *
 * Failure is deliberately quiet. The SOS is already filed and already visible
 * to any staff device with the app open; this is the extra reach, and losing
 * it must never look to the resident like their call did not go through.
 */
export async function notifyRescue(id: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    await supabase.functions.invoke("notify-rescue", { body: { id } });
  } catch {
    /* No signal, or the sender is down. The request stands either way. */
  }
}
