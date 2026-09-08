/**
 * Every UI string the app asks for must exist in a migration file.
 *
 * This guard exists because the repo silently stopped being able to rebuild its
 * own database. Strings were added by applying SQL straight to the remote
 * project, the app worked, nobody noticed — and 11 committed migrations sat
 * against 43 applied ones. A fresh checkout would have come up with the full
 * schema and 34 of 193 keys, rendering `action.evacuate_now` at people during a
 * storm.
 *
 * Enforced by a script rather than by discipline, like the write-path guard:
 * "remember to also write a migration" is a convention that holds until the day
 * someone is in a hurry, which is the day it matters.
 *
 * Run:  node scripts/check-translations.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC = join(ROOT, "src");
const MIGRATIONS = join(ROOT, "supabase/migrations");

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const sources = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));

/* ---------------------------------------------------------------------------
 * What the app asks for
 * ------------------------------------------------------------------------ */

const used = new Map(); // key -> file that uses it

function record(key, file) {
  if (!used.has(key)) used.set(key, file.replace(ROOT, "."));
}

/*
 * Keys built from a variable cannot be read statically, so each such site is
 * declared here with the values it can take. If a new dynamic site appears the
 * script reports it as unhandled rather than passing silently — an unknown
 * pattern is a gap in this guard, not an absence of keys.
 */
const DYNAMIC = [
  { pattern: "rd.${overall}", values: ["rd.ready", "rd.partial", "rd.missing", "rd.unknown"] },
  {
    pattern: "rd.${check.id}",
    values: ["rd.protocols", "rd.translations", "rd.volunteers", "rd.residents", "rd.centres"],
  },
  { pattern: "actor.", values: ["actor.resident", "actor.volunteer", "actor.official"] },
  {
    pattern: "cat.${category}",
    values: ["cat.flooding", "cat.fallen_tree", "cat.blocked_road", "cat.downed_lines", "cat.other"],
  },
  {
    pattern: "water.${",
    values: ["water.knee", "water.waist", "water.chest", "water.above_head"],
  },
  {
    pattern: "qr.${status}",
    values: ["qr.checked_in", "qr.evacuated", "qr.needs_help"],
  },
  { pattern: "tag.${tag}", values: ["tag.medical", "tag.elderly", "tag.infant"] },
  { pattern: "hc.${key}", values: ["hc.medical", "hc.elderly", "hc.infant"] },
];

const unhandledDynamic = [];

for (const file of sources) {
  const text = readFileSync(file, "utf8");

  // Static: t("some.key")
  for (const m of text.matchAll(/\bt\(\s*["']([a-z][a-z0-9_]*\.[a-z0-9_]+)["']/g)) {
    record(m[1], file);
  }

  // Declared nav/actor keys: key: "nav.home"
  for (const m of text.matchAll(/\bkey:\s*["']([a-z][a-z0-9_]*\.[a-z0-9_]+)["']/g)) {
    record(m[1], file);
  }

  // Dynamic: t(`prefix.${...}`)
  for (const m of text.matchAll(/\bt\(\s*`([^`]*\$\{[^`]*)`/g)) {
    const raw = m[1];
    const declared = DYNAMIC.find((d) => raw.includes(d.pattern.split("${")[0]));
    if (declared) {
      for (const value of declared.values) record(value, file);
    } else {
      unhandledDynamic.push(`${file.replace(ROOT, ".")}: t(\`${raw}\`)`);
    }
  }
}

/* ---------------------------------------------------------------------------
 * What the migrations provide
 * ------------------------------------------------------------------------ */

const seeded = new Set();
for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  for (const m of sql.matchAll(/\(\s*'([a-z][a-z0-9_]*\.[a-z0-9_]+)'\s*,\s*'(en|tl|ceb)'/g)) {
    seeded.add(m[1]);
  }
}

/* ---------------------------------------------------------------------------
 * Report
 * ------------------------------------------------------------------------ */

console.log("\nTranslation coverage — SalbaBayan\n");

const missing = [...used.entries()].filter(([key]) => !seeded.has(key));

console.log(`  ${used.size} keys used in src`);
console.log(`  ${seeded.size} keys seeded by supabase/migrations/*.sql`);

if (unhandledDynamic.length > 0) {
  console.log("\n  Dynamic key sites this guard cannot resolve:");
  for (const site of unhandledDynamic) console.log(`    ${site}`);
  console.log("    Add them to DYNAMIC in this script so they are covered.");
}

if (missing.length > 0) {
  console.log("\n  MISSING from every migration:");
  for (const [key, file] of missing) console.log(`    ${key}  (used in ${file})`);
  console.log(
    "\n  The database cannot be rebuilt from this repo. Add these to a new\n" +
      "  migration, or regenerate with: node scripts/dump-translations.mjs\n",
  );
  process.exitCode = 1;
} else if (unhandledDynamic.length > 0) {
  console.log("\n  No missing keys, but the unresolved sites above are unchecked.\n");
  process.exitCode = 1;
} else {
  console.log("\n  Every key the app uses is seeded by a migration.\n");
}
