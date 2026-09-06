/**
 * Concurrency gate for the headcount ledger (PRD §7.8 AC).
 *
 * "Two simultaneous +1 taps from different devices both land as separate rows,
 * and the total reflects both."
 *
 * This is the test that distinguishes an append-only ledger from a stored
 * counter. Against a `count` column, two clients that both read 68 and both
 * write 69 lose a person with no error anywhere — the failure only surfaces
 * later, during a roll call, in a building that may be flooding. Against a
 * ledger, two taps are two INSERTs with nothing shared to overwrite.
 *
 * Two genuinely separate clients are used, each with its own anonymous session,
 * for the reason recorded in Phase 6: two browser tabs share an origin and
 * therefore share IndexedDB, so they can appear to agree without anything
 * crossing the network.
 *
 * Two phases, because `insert_headcounts` requires staff and roles are granted
 * by an official:
 *   node scripts/headcount-concurrency.mjs --enrol   → prints uids to grant
 *   node scripts/headcount-concurrency.mjs --run     → fires the concurrent taps
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
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
const STATE = new URL("../.headcount-test.json", import.meta.url);

const mode = process.argv[2] ?? "--run";

/* ------------------------------------------------------------------ enrol */

if (mode === "--enrol") {
  const sessions = [];
  for (const label of ["device-A", "device-B"]) {
    const client = createClient(URL_, KEY);
    const { data, error } = await client.auth.signInAnonymously();
    if (error) {
      console.error(`${label} sign-in failed:`, error.message);
      process.exit(1);
    }
    sessions.push({
      label,
      uid: data.user.id,
      refresh_token: data.session.refresh_token,
    });
  }

  writeFileSync(STATE, JSON.stringify(sessions, null, 2));
  console.log("Two devices enrolled. Grant them volunteer, then run --run:\n");
  console.log(
    sessions
      .map((s) => `insert into public.user_roles (user_id, role) values ('${s.uid}', 'volunteer');`)
      .join("\n"),
  );
  process.exit(0);
}

/* -------------------------------------------------------------------- run */

if (!existsSync(STATE)) {
  console.error("No enrolled devices. Run with --enrol first.");
  process.exit(1);
}

const sessions = JSON.parse(readFileSync(STATE, "utf8"));

/** Restore each device's own session, so both are distinct identities. */
const devices = [];
for (const s of sessions) {
  const client = createClient(URL_, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.refreshSession({
    refresh_token: s.refresh_token,
  });
  if (error) {
    console.error(`${s.label} could not resume its session:`, error.message);
    console.error("Re-run with --enrol and re-grant the roles.");
    process.exit(1);
  }
  devices.push({ ...s, client });
}

const { data: centre } = await devices[0].client
  .from("evac_centers")
  .select("id,name,capacity")
  .limit(1)
  .single();

const before = await devices[0].client
  .from("headcounts")
  .select("delta")
  .eq("evac_center_id", centre.id);

const totalBefore = (before.data ?? []).reduce((s, r) => s + r.delta, 0);

/*
 * Fire both at once. `Promise.all` over two already-authenticated clients puts
 * the two inserts in flight together — which is the whole point. A sequential
 * pair would pass against a stored counter too, and prove nothing.
 */
const results = await Promise.all(
  devices.map((d) =>
    d.client
      .from("headcounts")
      .insert({
        id: crypto.randomUUID(),
        evac_center_id: centre.id,
        delta: 1,
        ts: new Date().toISOString(),
        recorded_by: d.uid,
      })
      .select("id"),
  ),
);

const failures = results
  .map((r, i) => (r.error ? `${devices[i].label}: ${r.error.message}` : null))
  .filter(Boolean);

const after = await devices[0].client
  .from("headcounts")
  .select("delta,recorded_by")
  .eq("evac_center_id", centre.id);

const rows = after.data ?? [];
const totalAfter = rows.reduce((s, r) => s + r.delta, 0);
const distinctRecorders = new Set(
  rows.filter((r) => devices.some((d) => d.uid === r.recorded_by)).map((r) => r.recorded_by),
).size;

const bothLanded = totalAfter - totalBefore === 2 && distinctRecorders === 2;

console.log(
  JSON.stringify(
    {
      centre: centre.name,
      totalBefore,
      totalAfter,
      delta: totalAfter - totalBefore,
      distinctRecordersAmongTestDevices: distinctRecorders,
      insertFailures: failures,
      bothTapsLanded: bothLanded,
    },
    null,
    2,
  ),
);

process.exit(bothLanded ? 0 : 1);
