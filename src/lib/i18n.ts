/**
 * Language selection and message resolution (PRD §7.2, FR-3.1..3.5).
 *
 * The rule that shapes this file: adding a language must be data entry, not a
 * code change (FR-3.2). So there are no message strings here. Everything the
 * resident reads resolves through the `translations` table by `message_key`,
 * and this module only decides *which* language wins and what happens when a
 * string is missing.
 */

export type Language = "tl" | "ceb" | "en";

/**
 * Launch languages (FR-3.3). Labels are endonyms — a Cebuano speaker looks for
 * "Bisaya", not "Cebuano".
 */
export const LANGUAGES: ReadonlyArray<{ code: Language; label: string }> = [
  { code: "tl", label: "Tagalog" },
  { code: "ceb", label: "Bisaya" },
  { code: "en", label: "English" },
];

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((l) => l.code === value);
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
