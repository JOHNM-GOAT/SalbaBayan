/**
 * Ring every staff phone when somebody calls for help.
 *
 * The one thing this product could not do. The tab badge, the dashboard queue
 * and the alarm sound all need the app to be open, and at two in the morning —
 * which is when a river rises — a phone is in a pocket with the screen off. A
 * warning system that can only warn the people already looking at it is not
 * finished, and this is the part that finishes it.
 *
 * Called by the resident's own device the moment the request lands in
 * Postgres, not by a database trigger. That sounds backwards and is not: the
 * write goes through an offline queue, so "when the row exists" and "when the
 * button was pressed" can be an hour apart, and the client is the only thing
 * that knows which of its queued writes just succeeded. It also keeps the
 * whole path in one place instead of splitting it across pg_net, a trigger and
 * a stored service key.
 *
 * Trusting the caller is therefore the thing to get right, and it is not
 * assumed anywhere below: the caller's own JWT is verified, and the request it
 * names must exist, be theirs, and still be waiting. A device cannot make this
 * ring for somebody else's emergency, or for one that is already over.
 */

import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "no session" }, 401);

  /* Who is asking. Verified against the auth server rather than decoded from
     the token, because a decoded token proves nothing about its signature. */
  const asCaller = createClient(URL_, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: who } = await asCaller.auth.getUser();
  const uid = who?.user?.id;
  if (!uid) return json({ error: "no session" }, 401);

  let id: string | undefined;
  try {
    id = (await req.json())?.id;
  } catch {
    return json({ error: "bad body" }, 400);
  }
  if (!id) return json({ error: "no request id" }, 400);

  const admin = createClient(URL_, SERVICE_KEY);

  /*
   * The request must be real, the caller's own, and still open.
   *
   * Read with the service role and then checked against `uid` by hand rather
   * than read as the caller: RLS would already limit this to their own rows,
   * but relying on that would make the ownership test invisible at the point
   * it matters. This is the sentence that stops one device ringing every staff
   * phone in the barangay whenever it likes.
   */
  const { data: request } = await admin
    .from("rescue_requests")
    .select("id,requested_by,status,purok_id")
    .eq("id", id)
    .maybeSingle();

  if (!request || request.requested_by !== uid) return json({ error: "not yours" }, 403);
  if (request.status !== "pending") return json({ sent: 0, reason: "not waiting" });

  /* Staff only. A rescue call is not broadcast to the barangay. */
  const { data: staff } = await admin
    .from("user_roles")
    .select("user_id")
    .in("role", ["volunteer", "official"]);

  const staffIds = (staff ?? []).map((r) => r.user_id).filter((u) => u !== uid);
  if (staffIds.length === 0) return json({ sent: 0, reason: "no staff" });

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth")
    .in("user_id", staffIds);

  if (!subs || subs.length === 0) return json({ sent: 0, reason: "nobody subscribed" });

  const { data: creds } = await admin.rpc("push_credentials");
  const key = Array.isArray(creds) ? creds[0] : creds;
  if (!key?.private_key) return json({ error: "no vapid key" }, 500);

  webpush.setVapidDetails(key.subject, key.public_key, key.private_key);

  /* The area name, so a responder waking up knows where before opening
     anything. Nothing identifying: a name on a lock screen is a name anyone
     who picks up that phone can read. */
  let area = "";
  if (request.purok_id) {
    const { data: purok } = await admin
      .from("puroks")
      .select("name")
      .eq("id", request.purok_id)
      .maybeSingle();
    area = purok?.name ?? "";
  }

  const payload = JSON.stringify({ kind: "sos", id: request.id, area });

  const results = await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 1800, urgency: "high" },
        );
        return { endpoint: s.endpoint, ok: true, gone: false };
      } catch (error) {
        /*
         * 404 and 410 mean the browser threw this subscription away — the app
         * was uninstalled, or the push service rotated it. Anything else is
         * this attempt failing, not the endpoint being dead, and deleting on
         * those would quietly unsubscribe a volunteer because of one bad
         * night on the network.
         */
        const status = (error as { statusCode?: number })?.statusCode;
        return { endpoint: s.endpoint, ok: false, gone: status === 404 || status === 410 };
      }
    }),
  );

  const dead = results.filter((r) => r.gone).map((r) => r.endpoint);
  if (dead.length > 0) {
    await admin.from("push_subscriptions").delete().in("endpoint", dead);
  }

  return json({
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    pruned: dead.length,
  });
});
