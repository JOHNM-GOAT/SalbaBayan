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
