/**
 * Measure Realtime propagation to an INDEPENDENT client (PRD §7.7 AC, NFR-3.3).
 *
 * The acceptance criterion is a latency claim: a report reaches every connected
 * client within five seconds. This measures exactly that and nothing else —
 * from the moment the row is accepted by Postgres to the moment a separate
 * client, with its own session and its own websocket, is told about it.
 *
 * Two distinct Supabase clients are used deliberately. Two browser tabs would
 * not do: they share an origin and therefore share IndexedDB, so a second tab
 * can "see" a report by reading the first tab's local write queue without any
 * server involvement at all. That mistake made an earlier run of this gate look
 * like it passed when nothing had crossed the network.
 *
 * Run:  node scripts/realtime-latency.mjs
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const newClient = () => createClient(URL_, KEY);

/** Client A: the observer. Separate session, separate socket. */
const observer = newClient();
await observer.auth.signInAnonymously();

/** Client B: the reporter. */
const reporter = newClient();
const { data: auth } = await reporter.auth.signInAnonymously();
const reporterId = auth?.user?.id;

const { data: purok } = await reporter
  .from("puroks")
  .select("id")
  .limit(1)
  .single();

const marker = `latency-probe-${Date.now()}`;
let sentAt = 0;
let settled = false;

function finish(code, payload) {
  if (settled) return;
  settled = true;
  console.log(JSON.stringify(payload, null, 2));
  process.exit(code);
}

observer
  .channel("latency-probe")
  .on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "hazard_reports" },
    (payload) => {
      if (payload.new?.description !== marker) return;

      const ms = Date.now() - sentAt;
      finish(ms <= 5000 ? 0 : 1, {
        observerReceived: true,
        latencyMs: ms,
        withinFiveSeconds: ms <= 5000,
        note: "measured on a client with its own session and websocket",
      });
    },
  )
  .subscribe(async (status) => {
    if (status !== "SUBSCRIBED") return;

    sentAt = Date.now();
    const { error } = await reporter.from("hazard_reports").insert({
      id: crypto.randomUUID(),
      purok_id: purok.id,
      category: "downed_lines",
      description: marker,
      status: "open",
      reported_by: reporterId,
      ts: new Date().toISOString(),
    });

    if (error) finish(1, { insertFailed: error.message });
  });

setTimeout(() => finish(1, { observerReceived: false, timedOutAfterSeconds: 20 }), 20_000);
