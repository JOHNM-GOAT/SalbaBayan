/**
 * RLS boundary test — the Phase 0 gate (PRD §15).
 *
 * Runs against the live REST API rather than impersonating roles in SQL,
 * because the REST surface is what an attacker actually reaches. A policy that
 * looks right in psql but leaks through PostgREST is still a leak.
 *
 * Run:  node scripts/rls-test.mjs
 * Reads NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY from .env.local
 */

import { readFileSync } from "node:fs";

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

let pass = 0;
let fail = 0;

function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ""}`);
  }
}

async function rest(path, { jwt, method = "GET", body } = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    /* empty body is fine */
  }
  return { status: res.status, body: parsed };
}

async function signInAnonymously() {
  const res = await fetch(`${URL_}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`anonymous sign-in failed: ${json.msg}`);
  return json.access_token;
}

const rows = (r) => (Array.isArray(r.body) ? r.body.length : -1);

console.log("\nRLS boundary test — SalbaBayan\n");

// -- 1. No session at all -----------------------------------------------------
console.log("Unauthenticated (no JWT) — every policy is scoped `to authenticated`:");
for (const t of ["protocols", "translations", "residents", "rescue_requests"]) {
  const r = await rest(`${t}?select=*`);
  check(`${t} returns nothing`, rows(r) === 0, `got ${rows(r)} rows`);
}

// -- 2. Resident: signed in anonymously, no user_roles row --------------------
const jwt = await signInAnonymously();
console.log("\nResident (anonymous session, no role granted):");

const readable = ["protocols", "translations", "barangays", "puroks", "evac_centers"];
for (const t of readable) {
  const r = await rest(`${t}?select=*`, { jwt });
  check(`can read ${t}`, rows(r) > 0, `got ${rows(r)} rows`);
}

// The privacy claim (NFR-4.3, §9): vulnerability tags are staff-only.
const hidden = ["residents", "documents", "checkins"];
for (const t of hidden) {
  const r = await rest(`${t}?select=*`, { jwt });
  check(`CANNOT read ${t}`, rows(r) === 0, `LEAK: got ${rows(r)} rows`);
}

// -- 3. Writes ---------------------------------------------------------------
console.log("\nResident writes:");
const purok = (await rest("puroks?select=id&limit=1", { jwt })).body?.[0]?.id;

const allowed = await rest("water_reports", {
  jwt,
  method: "POST",
  body: {
    id: crypto.randomUUID(),
    purok_id: purok,
    location_label: "rls-test",
    level_category: "knee",
  },
});
check("can submit a water report", allowed.status === 201, `status ${allowed.status}`);

// The app stamps the owner column (see OWNER_COLUMN in lib/offlineQueue.ts).
// Without it the insert succeeds but the row is unreadable to its author.
const me = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).sub;
const sosId = crypto.randomUUID();
const sos = await rest("rescue_requests", {
  jwt,
  method: "POST",
  body: {
    id: sosId,
    purok_id: purok,
    lat: 14.28,
    lng: 121.41,
    accuracy_m: 12,
    requested_by: me,
  },
});
check("can raise an SOS", sos.status === 201, `status ${sos.status}`);

// The requirement that actually matters (FR-4.3): the resident must be able to
// watch their own request move pending -> acknowledged -> rescued.
const mine = await rest(`rescue_requests?id=eq.${sosId}&select=id,status`, { jwt });
check("can read back their own SOS", rows(mine) === 1, `got ${rows(mine)} rows`);

// ...but not anyone else's.
const otherJwt = await signInAnonymously();
const theirs = await rest(`rescue_requests?id=eq.${sosId}&select=id`, { jwt: otherJwt });
check("CANNOT read another resident's SOS", rows(theirs) === 0, `LEAK: got ${rows(theirs)} rows`);

console.log("\nResident must NOT be able to:");
const proto = await rest("protocols", {
  jwt,
  method: "POST",
  body: { purok_id: purok, signal_level: 1, action_key: "action.stay_alert" },
});
check("write protocols (official only)", proto.status === 401 || proto.status === 403,
  `status ${proto.status}`);

const head = await rest("headcounts", {
  jwt,
  method: "POST",
  body: { id: crypto.randomUUID(), evac_center_id: null, delta: 1 },
});
check("write headcounts (staff only)", head.status >= 400, `status ${head.status}`);

/* ---------------------------------------------------------------------------
 * The demo self-promotion path (migration 0017)
 *
 * Every check above passes whether or not `set_demo_role` exists, because none
 * of them call it — a resident who never promotes themselves is still correctly
 * fenced out of protocols, headcounts and other people's SOS. That is exactly
 * why this section is here. A security suite that stays silent about a function
 * letting any device make itself an official is a suite that reports "18
 * passed" over an open door.
 *
 * So this does not pass or fail. It REPORTS, every run, which state the
 * database is in.
 * ------------------------------------------------------------------------ */

console.log("\nDemo role switch (migration 0017):");

const promoteJwt = await signInAnonymously();
const promote = await fetch(`${URL_}/rest/v1/rpc/set_demo_role`, {
  method: "POST",
  headers: {
    apikey: KEY,
    Authorization: `Bearer ${promoteJwt}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ target: "official" }),
});

if (promote.status === 404) {
  console.log("  CLOSED  set_demo_role is not installed — roles are granted by officials only.");
} else if (promote.ok) {
  console.log("  OPEN    a fresh anonymous device just made itself an OFFICIAL.");
  console.log("          This is deliberate and demo-only. Before a real barangay uses");
  console.log("          this build, run:  drop function public.set_demo_role(public.user_role);");

  // Left promoted would poison later runs and the live demo, so put it back.
  await fetch(`${URL_}/rest/v1/rpc/set_demo_role`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${promoteJwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ target: "resident" }),
  });
} else {
  console.log(`  UNKNOWN set_demo_role answered ${promote.status}.`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
