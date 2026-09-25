/**
 * Architectural guard for PRD §7.3 / FR-3.1.
 *
 * "One reusable utility wraps every write" is the constraint the entire
 * offline story rests on. A write that calls Supabase directly works fine in
 * the office and silently loses a resident's report during a storm — which is
 * exactly the failure the queue exists to remove, reintroduced by one
 * plausible-looking line.
 *
 * Reviews do not reliably catch that, so this does. It fails the build if any
 * file outside the queue performs a Supabase write.
 *
 * Run:  node scripts/check-write-paths.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

/** The one file allowed to write. Everything else must go through it. */
const ALLOWED = ["lib/offlineQueue.ts"];

/**
 * Supabase writes always read as `.from(<table>).<verb>(`. Matching the pair
 * rather than the verb alone is what keeps this from flagging `Set.delete`,
 * `Map.delete`, or Dexie's `.update()` — all of which appear legitimately.
 */
const WRITE_CALL = /\.from\(\s*["'`][^"'`]+["'`]\s*\)\s*(?:\r?\n\s*)*\.(insert|upsert|update|delete)\s*\(/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const violations = [];

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (ALLOWED.includes(rel)) continue;

  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(WRITE_CALL)) {
    const line = source.slice(0, match.index).split("\n").length;
    violations.push({ file: `src/${rel}`, line, verb: match[1] });
  }
}

if (violations.length > 0) {
  console.error("\nDirect Supabase writes found outside the offline queue:\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  .${v.verb}()`);
  }
  console.error(
    "\nEvery write must go through enqueueWrite() in src/lib/offlineQueue.ts.\n" +
      "A direct write is lost when the device is offline, which is precisely\n" +
      "when this application is used (PRD FR-3.1).\n",
  );
  process.exit(1);
}

console.log(`write-path check: clean (${ALLOWED.length} permitted writer)`);

/*
 * Resolving a hazard must decide before it queues.
 *
 * The same class of problem as the one above, and found the same way. The rule
 * for who may clear a report lived in three screens, each asking
 * `canResolveHazard` before drawing the button — correct for those screens and
 * not enforcement. A fourth call site, or a role that arrives a moment after
 * the control is painted, walks past all three, and the queue then shows the
 * resolve locally: the report disappears from that phone's hazard map, the
 * flush is refused minutes later, and in between somebody is reading a map
 * that calls a road clear on the strength of a request the barangay threw
 * away. RLS refuses the write; it cannot refuse the appearance.
 *
 * So `resolveHazard` itself asks. This fails the build if it stops asking,
 * because that is a one-line deletion that looks like a simplification.
 */
const hazards = readFileSync(join(ROOT, "lib", "hazards.ts"), "utf8");
const resolveBody = hazards.slice(hazards.indexOf("export async function resolveHazard"));

if (!/^[\s\S]{0,700}?canResolve\(/.test(resolveBody)) {
  console.error(
    "\nresolveHazard() in src/lib/hazards.ts no longer checks canResolve().\n\n" +
      "Hiding the button is presentation; this is the check. Without it a\n" +
      "refused resolve is still queued and still merged into what the device\n" +
      "shows, so a hazard reads as cleared on that phone until the flush is\n" +
      "refused — see lib/hazardPermission.ts.\n",
  );
  process.exit(1);
}

console.log("hazard-resolve check: the rule is enforced where the write happens");
