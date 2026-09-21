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

// The app stamps the owner column (see OWNER_COLUMN in lib/offlineQueue.ts).
// Without it the insert succeeds but the row is unreadable to its author.
const me = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).sub;

const allowed = await rest("water_reports", {
  jwt,
  method: "POST",
  body: {
    id: crypto.randomUUID(),
    purok_id: purok,
    location_label: "rls-test",
    level_category: "knee",
    reported_by: me,
  },
});
check("can submit a water report", allowed.status === 201, `status ${allowed.status}`);
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

/*
 * The owner-omission bypass (migration 0019).
 *
 * 0007 found this on rescue_requests — a rate limit counted rows by owner, and
 * leaving the owner out of the JSON body meant the rows counted against nobody.
 * The identical clause sat on hazard_reports and water_reports for another
 * sixteen migrations, where the cost is different but not smaller: an
 * unattributed hazard report cannot be resolved by ANY non-staff account,
 * because `resolve_hazards` matches on `reported_by = auth.uid()` and there is
 * no uid to match. A script could fill an unmoderated map with pins no resident
 * could take down.
 *
 * Checked on both tables, and checked by actually attempting the bypass rather
 * than by reading the policy, because the REST surface is what an attacker
 * reaches.
 */
for (const table of ["hazard_reports", "water_reports"]) {
  const body =
    table === "hazard_reports"
      ? { id: crypto.randomUUID(), purok_id: purok, category: "other", status: "open" }
      : { id: crypto.randomUUID(), purok_id: purok, level_category: "knee" };

  const orphan = await rest(table, { jwt, method: "POST", body });
  check(
    `CANNOT file an unattributed ${table} row`,
    orphan.status >= 400,
    `LEAK: status ${orphan.status} — a report owned by nobody was accepted`,
  );
}

// And the legitimate path still works, so the rule above is a fence and not a
// wall: a report that names its author is accepted exactly as before.
const ownedHazard = await rest("hazard_reports", {
  jwt,
  method: "POST",
  body: {
    id: crypto.randomUUID(),
    purok_id: purok,
    category: "other",
    status: "open",
    reported_by: me,
  },
});
check(
  "can still file an attributed hazard report",
  ownedHazard.status === 201,
  `status ${ownedHazard.status}`,
);

/* ---------------------------------------------------------------------------
 * The advisory and its history (migration 0021)
 *
 * Every probe here changes nothing whether it passes or fails. This is the live
 * barangay every resident reads, and signal_history is append-only — a stray
 * row written by a test could never be cleaned up through the API.
 *
 * So each write sends a body a CHECK constraint would reject anyway. Postgres
 * checks RLS first: refused by RLS is the pass; rejected by the constraint
 * (23514) means RLS let the write through — the leak, caught before it landed.
 * ------------------------------------------------------------------------ */

console.log("\nThe advisory, as a resident (migration 0021):");

const barangayId = (await rest("barangays?select=id&limit=1", { jwt })).body?.[0]?.id;

// Signal 5 with no deadline violates leave_by_at_evacuation whatever state the
// live row is in, so even a leaking policy could not change the advisory.
const residentUpdate = await rest(`barangays?id=eq.${barangayId}`, {
  jwt,
  method: "PATCH",
  body: { current_signal_level: 5, evacuate_by: null },
});
check(
  "CANNOT change the barangay's advisory",
  residentUpdate.status === 200 && rows(residentUpdate) === 0,
  residentUpdate.body?.code === "23514"
    ? "LEAK: RLS let a resident's update through — only the leave-by constraint stopped it"
    : `status ${residentUpdate.status}, ${rows(residentUpdate)} rows`,
);

const residentInsert = await rest("signal_history", {
  jwt,
  method: "POST",
  body: { barangay_id: barangayId, level: 9 },
});
check(
  "CANNOT write to signal_history",
  residentInsert.status === 401 || residentInsert.status === 403,
  residentInsert.body?.code === "23514"
    ? "LEAK: RLS allowed a resident's insert — only the level constraint stopped it"
    : `status ${residentInsert.status}`,
);

/*
 * The household count and the evacuation centre (migration 0026).
 *
 * Staff may set the household count; officials may move the centre. A resident
 * may do neither. Both probes send the row's CURRENT values back, so even if a
 * policy leaked, nothing would change — the check is only whether the write
 * was allowed to touch a row at all.
 */
const barangayNow = (
  await rest(`barangays?select=expected_households&id=eq.${barangayId}`, { jwt })
).body?.[0];
const residentHouseholds = await rest(`barangays?id=eq.${barangayId}`, {
  jwt,
  method: "PATCH",
  body: { expected_households: barangayNow?.expected_households ?? null },
});
check(
  "CANNOT set the household count",
  residentHouseholds.status === 200 && rows(residentHouseholds) === 0,
  `LEAK: status ${residentHouseholds.status}, ${rows(residentHouseholds)} rows updated`,
);

const centreNow = (await rest("evac_centers?select=id,lat,lng&limit=1", { jwt })).body?.[0];
if (centreNow) {
  const residentCentre = await rest(`evac_centers?id=eq.${centreNow.id}`, {
    jwt,
    method: "PATCH",
    body: { lat: centreNow.lat, lng: centreNow.lng },
  });
  check(
    "CANNOT move the evacuation centre",
    residentCentre.status === 200 && rows(residentCentre) === 0,
    `LEAK: status ${residentCentre.status}, ${rows(residentCentre)} rows updated`,
  );
} else {
  console.log("  SKIPPED  moving the evacuation centre — no centre to aim at");
}

// Aimed at a code no device has: even if the official check leaked, nothing
// would be granted — the answer would just be "not found" instead of refused.
const residentGrant = await rest("rpc/set_device_role", {
  jwt,
  method: "POST",
  body: { device_code: "00000000", new_role: "official" },
});
const centreForScan = (await rest("evac_centers?select=id&limit=1", { jwt })).body?.[0];
if (centreForScan) {
  const residentScan = await rest("device_checkins", {
    jwt,
    method: "POST",
    body: {
      id: crypto.randomUUID(),
      device_code: "00000000",
      evac_center_id: centreForScan.id,
      people: 1,
      scanned_by: JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).sub,
    },
  });
  check(
    "CANNOT count people in by phone QR (migration 0034)",
    residentScan.status === 401 || residentScan.status === 403,
    `LEAK: status ${residentScan.status}`,
  );
}

check(
  "CANNOT grant roles (migration 0032)",
  residentGrant.status === 403 && residentGrant.body?.code === "42501",
  `LEAK: status ${residentGrant.status}, code ${residentGrant.body?.code}`,
);

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
  console.log("  SKIPPED the official's advisory checks — they need an official account.");
} else if (promote.ok) {
  console.log("  OPEN    a fresh anonymous device just made itself an OFFICIAL.");
  console.log("          This is deliberate and demo-only. Before a real barangay uses");
  console.log("          this build, run:  drop function public.set_demo_role(public.user_role);");

  /*
   * Left promoted would poison later runs and the live demo, so put it back —
   * and CHECK that it went back. This is the one place in a suite about
   * boundaries that grants a real elevated role, so it is the last place that
   * should assume its own cleanup worked. A blip here strands an `official` row
   * in the live table owned by a throwaway anonymous uid that will never sign
   * in again, and nothing else would ever notice.
   */
  console.log("\nThe advisory, as an official (migration 0021):");

  const historyCount = async () =>
    rows(await rest("signal_history?select=id", { jwt: promoteJwt }));

  const historyBefore = await historyCount();
  check(
    "an official can read signal_history",
    historyBefore >= 0,
    "the read errored",
  );

  // The resident's refused change, repeated here where the history can be
  // counted: a change that did not happen must leave no record that it did.
  await rest(`barangays?id=eq.${barangayId}`, {
    jwt,
    method: "PATCH",
    body: { current_signal_level: 5, evacuate_by: null },
  });
  check(
    "a refused change writes no history row",
    (await historyCount()) === historyBefore,
  );

  // Only meaningful when there is something to hide. Against an empty table a
  // resident sees zero rows whether RLS works or not.
  if (historyBefore > 0) {
    check(
      "a resident sees none of the history an official can",
      rows(await rest("signal_history?select=id", { jwt })) === 0,
      "LEAK: a resident can read who changed the signal",
    );
  } else {
    console.log("  SKIPPED  a resident reading history — no history rows yet");
  }

  const officialInsert = await rest("signal_history", {
    jwt: promoteJwt,
    method: "POST",
    body: { barangay_id: barangayId, level: 9 },
  });
  check(
    "an official CANNOT write to signal_history directly",
    officialInsert.status === 401 || officialInsert.status === 403,
    officialInsert.body?.code === "23514"
      ? "LEAK: RLS allowed an official's insert — only the level constraint stopped it"
      : `status ${officialInsert.status}`,
  );

  // An update needs a real row to aim at: against nothing, zero rows comes back
  // whether a policy refused it or not.
  const newest = (
    await rest("signal_history?select=id,level&order=received_at.desc&limit=1", {
      jwt: promoteJwt,
    })
  ).body?.[0];

  if (newest) {
    const edit = await rest(`signal_history?id=eq.${newest.id}`, {
      jwt: promoteJwt,
      method: "PATCH",
      body: { level: 9 },
    });
    const reread = (
      await rest(`signal_history?select=level&id=eq.${newest.id}`, { jwt: promoteJwt })
    ).body?.[0];
    check(
      "an official CANNOT edit a history row",
      rows(edit) === 0 && reread?.level === newest.level,
      edit.body?.code === "23514"
        ? "LEAK: RLS allowed an official's edit — only the level constraint stopped it"
        : `status ${edit.status}, level now ${reread?.level}`,
    );
  } else {
    console.log("  SKIPPED  editing a history row — no history rows yet");
  }

  // Rejected whatever state the live row is in, so it cannot change the advisory.
  const noDeadline = await rest(`barangays?id=eq.${barangayId}`, {
    jwt: promoteJwt,
    method: "PATCH",
    body: { current_signal_level: 5, evacuate_by: null },
  });
  check(
    "Signal 3+ without a leave-by time is rejected by the database",
    noDeadline.status === 400 && noDeadline.body?.code === "23514",
    `status ${noDeadline.status}, code ${noDeadline.body?.code}`,
  );

  const demote = await fetch(`${URL_}/rest/v1/rpc/set_demo_role`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${promoteJwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ target: "resident" }),
  });

  check(
    "the promoted test account was demoted again",
    demote.ok,
    `status ${demote.status} — an 'official' row is STRANDED in user_roles for ` +
      `an anonymous uid. Remove it by hand.`,
  );
} else {
  console.log(`  UNKNOWN set_demo_role answered ${promote.status}.`);
  console.log("  SKIPPED the official's advisory checks — they need an official account.");
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
