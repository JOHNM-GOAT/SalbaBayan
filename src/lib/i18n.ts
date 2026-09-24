/**
 * Language selection and message resolution (PRD §7.2, FR-3.1..3.5).
 *
 * The rule that shapes this file: adding a language must be data entry, not a
 * code change (FR-3.2). So there are no message strings here. Everything the
 * resident reads resolves through the `translations` table by `message_key`,
 * and this module only decides *which* language wins and what happens when a
 * string is missing.
 */

/**
 * Languages a resident can choose (FR-3.3).
 *
 * The major languages of the Philippines, plus English. `label` is the endonym
 * — what a speaker looks for: "Bisaya", not "Cebuano"; "Ilokano", not
 * "Ilocano". `english` is shown beside it so a relative helping someone choose
 * can find it too. Codes are ISO 639.
 *
 * Choosing a language is not the same as the app being translated into it.
 * Only languages with rows in the `translations` table are translated; every
 * other choice is honoured and falls back, per string, to the barangay's
 * default language (FR-3.5). The picker says which is which, from the data, so
 * translating a language is data entry — a migration of strings — and it moves
 * into the "translated" group on its own.
 *
 * The Philippines has around 180 languages. This lists the widely spoken ones;
 * adding one is a single line here.
 */
export const LANGUAGES = [
  { code: "en", label: "English", english: "English" },
  /*
   * One entry, not two. Filipino is the national language and Tagalog is what
   * it is built on, and the app never held two translations of them: the
   * generator copies every Tagalog string into Filipino, so the two choices
   * showed identical screens. The picker offers the pair under both names and
   * stores "tl", the barangay's own default. The "fil" rows stay in the
   * database so a phone that already chose Filipino still resolves.
   */
  { code: "tl", label: "Filipino (Tagalog)", english: "Filipino (Tagalog)" },
  { code: "ceb", label: "Bisaya", english: "Cebuano" },
  { code: "ilo", label: "Ilokano", english: "Ilocano" },
  { code: "hil", label: "Hiligaynon", english: "Hiligaynon (Ilonggo)" },
  { code: "war", label: "Winaray", english: "Waray" },
  { code: "bcl", label: "Bikol", english: "Central Bikol" },
  { code: "pam", label: "Kapampangan", english: "Kapampangan" },
  { code: "pag", label: "Pangasinan", english: "Pangasinan" },
  { code: "mrw", label: "Mëranaw", english: "Maranao" },
  { code: "mdh", label: "Magindanawn", english: "Maguindanao" },
  { code: "tsg", label: "Bahasa Sūg", english: "Tausug" },
  { code: "krj", label: "Kinaray-a", english: "Kinaray-a" },
  { code: "akl", label: "Akeanon", english: "Aklanon" },
  { code: "cbk", label: "Chavacano", english: "Chavacano" },
  { code: "sgd", label: "Surigaonon", english: "Surigaonon" },
  { code: "msb", label: "Masbatenyo", english: "Masbateño" },
  { code: "rol", label: "Romblomanon", english: "Romblomanon" },
  { code: "bno", label: "Asi", english: "Bantoanon (Asi)" },
  { code: "cyo", label: "Cuyonon", english: "Cuyonon" },
  { code: "btw", label: "Butuanon", english: "Butuanon" },
  { code: "ibg", label: "Ibanag", english: "Ibanag" },
  { code: "itv", label: "Itawis", english: "Itawis" },
  { code: "ivv", label: "Ivatan", english: "Ivatan" },
  { code: "isd", label: "Isnag", english: "Isnag" },
  { code: "gad", label: "Gaddang", english: "Gaddang" },
  { code: "kne", label: "Kankanaey", english: "Kankanaey" },
  { code: "ibl", label: "Ibaloi", english: "Ibaloi" },
  { code: "ifk", label: "Tuwali", english: "Tuwali Ifugao" },
  { code: "xsb", label: "Sambal", english: "Sambal" },
  { code: "smk", label: "Bolinao", english: "Bolinao" },
  { code: "yka", label: "Yakan", english: "Yakan" },
  { code: "sml", label: "Sinama", english: "Sama" },
  { code: "tbl", label: "T'boli", english: "Tboli" },
  { code: "tiy", label: "Tiruray", english: "Tiruray" },
  { code: "hnn", label: "Hanunó'o", english: "Hanunoo" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];

/**
 * Languages whose strings were machine-translated and not yet checked by a
 * native speaker (migration 0030, from translations/machine/*.json).
 *
 * They are shown — a rough translation beats Tagalog to someone who does not
 * read Tagalog — but never passed off as reviewed: the picker groups them
 * separately and every instruction carries a note saying so. When a speaker
 * has checked a language, remove it from this set.
 */
export const MACHINE_TRANSLATED: ReadonlySet<string> = new Set([
  "ilo", "hil", "war", "bcl", "pam", "pag", "mrw", "mdh", "tsg", "krj", "akl",
  "cbk", "sgd", "msb", "rol", "bno", "cyo", "btw", "ibg", "itv", "ivv", "isd",
  "gad", "kne", "ibl", "ifk", "xsb", "smk", "yka", "sml", "tbl", "tiy", "hnn",
]);

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((l) => l.code === value);
}

/** Every language with at least one string in the snapshot's translations. */
export function translatedLanguages(translations: TranslationMap): Set<string> {
  const found = new Set<string>();
  for (const entry of Object.values(translations)) {
    for (const code of Object.keys(entry)) found.add(code);
  }
  return found;
}

/*
 * Persistence of the resident's choice lives in lib/prefs.ts, so it can be
 * exposed as an external store and read at render time rather than copied into
 * state. This module stays concerned only with which language wins.
 */

/** `{ [message_key]: { [language]: text } }` — the shape the snapshot caches. */
export type TranslationMap = Record<string, Partial<Record<string, string>>>;

/**
 * Resolve one message key.
 *
 * FR-3.5: a missing string falls back to the barangay's *configured* default
 * language rather than rendering blank. If even that is absent the key itself
 * is returned — deliberately ugly, because a visible `action.evacuate_now` on
 * screen tells an official exactly what to fix, whereas an empty card during a
 * storm tells a resident nothing and hides the fault.
 */
export function resolveMessage(
  translations: TranslationMap,
  key: string,
  language: Language,
  defaultLanguage: string,
): string {
  const entry = translations[key];
  if (!entry) return key;
  return entry[language] ?? entry[defaultLanguage] ?? key;
}

/**
 * Resolve and substitute in one step.
 *
 * `{n}` is the only placeholder. Keeping substitution client-side rather than
 * baking the number into the string is what lets a language place it where its
 * grammar wants it — "SIGNAL NO. {n}" and a hypothetical "{n} SIGNAL" are the
 * same key, differing only in data.
 */
export function translate(
  translations: TranslationMap,
  key: string,
  language: Language,
  defaultLanguage: string,
  vars?: { n?: string | number },
): string {
  const text = resolveMessage(translations, key, language, defaultLanguage);
  if (!vars || vars.n === undefined) return text;
  return text.replace(/\{n\}/g, String(vars.n));
}

/**
 * Which languages actually have a string for this key.
 * Drives the per-language completeness view the admin editor needs (FR-3.4)
 * and lets the resident UI mark a fallback honestly rather than silently.
 */
export function availableLanguages(
  translations: TranslationMap,
  key: string,
): Language[] {
  const entry = translations[key];
  if (!entry) return [];
  return LANGUAGES.filter((l) => entry[l.code]).map((l) => l.code);
}
