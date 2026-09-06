/**
 * Documentation knowledge base ingest (PRD §5.6 F13, FR-13.1/13.2).
 *
 * Reads every `docs/*.md`, extracts a title and content, and upserts into
 * `documents` keyed by filename. Re-running is safe by construction: the
 * filename is the primary key, so a second run replaces rather than
 * duplicates.
 *
 * The point of putting documentation in the database at all is that an
 * official at a barangay hall during an event has a phone and no repository.
 * `RUNBOOK.md` is the document this exists for; the rest is project record.
 *
 * Writing requires the official role (`write_documents`), so this needs a
 * service-role key rather than the anon key the app ships with. That is
 * correct — ingest is an administrative act, not something the PWA does.
 *
 * Run:  node scripts/ingest-docs.mjs
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const DOCS = join(ROOT, "docs");

const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

// Environment first, so the key can be supplied for one run without ever
// being written to a file:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/ingest-docs.mjs
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error(
    "SUPABASE_SERVICE_ROLE_KEY is not set.\n\n" +
      "Documents are official-only to write, so ingest needs a service-role\n" +
      "key. Supply it for a single run rather than storing it:\n\n" +
      "  SUPABASE_SERVICE_ROLE_KEY=... node scripts/ingest-docs.mjs\n\n" +
      "Copy it from Supabase > Project Settings > API. It must never be\n" +
      "committed, and must never reach the browser.",
  );
  process.exitCode = 1;
}

/** First `# Heading`, else the filename. A document with no title is unusable in a list. */
function titleOf(markdown, filename) {
  const heading = markdown.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : filename.replace(/\.md$/, "");
}

if (KEY) {
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, KEY, {
    auth: { persistSession: false },
  });

  const files = readdirSync(DOCS).filter((f) => f.endsWith(".md")).sort();
  const rows = files.map((filename) => {
    const content = readFileSync(join(DOCS, filename), "utf8");
    return {
      filename,
      title: titleOf(content, filename),
      content,
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase
    .from("documents")
    .upsert(rows, { onConflict: "filename" });

  if (error) {
    console.error("ingest failed:", error.message);
    process.exitCode = 1;
  } else {
    for (const row of rows) {
      console.log(`  ${row.filename.padEnd(16)} ${row.title}  (${row.content.length} chars)`);
    }
    console.log(`\n${rows.length} document(s) ingested`);
  }
}
