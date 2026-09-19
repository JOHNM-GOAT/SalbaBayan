/**
 * The language list (src/lib/i18n.ts).
 *
 * The picker offers every language in LANGUAGES, and a resident's choice is
 * stored by its code. A duplicate code would make two entries select the same
 * thing; a missing launch language would strand everyone who had chosen it; and
 * mistaking "chosen" for "translated" would tell a Waray speaker the app speaks
 * Waray when it shows them Tagalog. These pin those down.
 *
 * Run:  node scripts/languages-test.mjs
 */

import { isLanguage, LANGUAGES, translatedLanguages } from "../src/lib/i18n.ts";

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

console.log("\nLanguage list — SalbaBayan\n");

const codes = LANGUAGES.map((l) => l.code);

check("every code is unique", new Set(codes).size === codes.length, `${codes.length} codes`);
check(
  "every entry has a label and an English name",
  LANGUAGES.every((l) => l.label.trim() && l.english.trim()),
);
for (const code of ["en", "tl", "ceb"]) {
  check(
    `"${code}" is still offered — residents who chose it keep it`,
    isLanguage(code),
  );
}
check(
  "Ilocano is offered — the language of Batac, where the app now runs",
  isLanguage("ilo"),
);
check("an unknown code is not a language", !isLanguage("xx") && !isLanguage(undefined));

console.log("\nChosen is not the same as translated:");
{
  const translations = {
    "ui.language": { en: "Language", tl: "Wika", ceb: "Pinulongan" },
    "ui.retry": { en: "Retry", tl: "Subukang muli" },
  };
  const found = translatedLanguages(translations);
  check(
    "a language counts as translated once it has any string",
    found.has("en") && found.has("tl") && found.has("ceb"),
    JSON.stringify([...found]),
  );
  check("a language with no strings is not translated", !found.has("ilo") && !found.has("war"));
  check("an empty table translates nothing", translatedLanguages({}).size === 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exitCode = 1;
