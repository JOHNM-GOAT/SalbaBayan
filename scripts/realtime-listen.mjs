/**
 * A genuinely separate Realtime client, for the Phase 6 gate.
 *
 * Two browser tabs are NOT two devices: they share an origin, and therefore
 * share IndexedDB, localStorage and the Service Worker cache. A second tab
 * "seeing" a report can be reading the first tab's local write queue directly,
 * with no server involved at all — which is exactly what happened on the first
 * attempt at this gate and made it look like it passed.
 *
 * This process has its own Supabase client, its own anonymous session and its
 * own websocket. Nothing it prints can come from the reporter's device.
 *
 * Run:  node scripts/realtime-listen.mjs <substring> [timeoutSeconds]
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

const needle = process.argv[2] ?? "";
const timeoutMs = Number(process.argv[3] ?? 60) * 1000;

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

// Realtime honours RLS, so this client needs an identity like any other.
const { error: authError } = await supabase.auth.signInAnonymously();
if (authError) {
  console.error("anonymous sign-in failed:", authError.message);
  process.exit(1);
}

let armedAt = 0;

const channel = supabase
  .channel("gate-listener")
  .on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "hazard_reports" },
    (payload) => {
      const row = payload.new ?? {};
      if (needle && !String(row.description ?? "").includes(needle)) return;

      const elapsed = ((Date.now() - armedAt) / 1000).toFixed(2);
      console.log(
        JSON.stringify({
          received: true,
          secondsAfterArmed: Number(elapsed),
          category: row.category,
          description: row.description,
          status: row.status,
        }),
      );
      process.exit(0);
    },
  )
  .subscribe((status) => {
    if (status === "SUBSCRIBED") {
      armedAt = Date.now();
      console.log("LISTENING");
    }
  });

setTimeout(() => {
  console.log(JSON.stringify({ received: false, timedOutAfterSeconds: timeoutMs / 1000 }));
  void supabase.removeChannel(channel);
  process.exit(1);
}, timeoutMs);
