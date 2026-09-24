/**
 * Reading PAGASA's Tropical Cyclone Bulletin.
 *
 * PAGASA publishes no API. The bulletin is a server-rendered page, and this
 * reads it — so everything here is a guess about someone else's markup, and the
 * whole file is written around that being true.
 *
 * Two rules follow from it:
 *
 *   1. Nothing is inferred. A field that cannot be read is null, never a
 *      default. `windKph: 0` would be a claim about a storm; null is the truth,
 *      which is that this parser could not read it.
 *   2. Nothing here decides anything. The result is shown to an official beside
 *      a link to the bulletin itself, and it reaches residents only when that
 *      official reads it and confirms. A misparse is then a wrong suggestion on
 *      one screen, not a wrong signal level on every phone in the barangay.
 *
 * The parse is anchored on the bulletin's WORDING rather than its markup —
 * "Issued at", "Maximum sustained winds of", "TCWS No." are the sentences
 * PAGASA has used for years, while the surrounding `<div>`s are a website that
 * gets redesigned. When the wording changes too, this returns nulls and the
 * official page says it could not read the bulletin, which is the failure this
 * is designed to have.
 *
 * No imports: the test (scripts/pagasa-test.mjs) loads it in plain Node.
 */

/** One wind signal and the places under it, as the bulletin lists them. */
export type WindSignal = {
  /** TCWS 1-5. */
  level: number;
  /** The bulletin's own area text, kept verbatim — it is what an official reads. */
  areas: string;
};

export type Bulletin = {
  /** PAGASA's local name for the storm, e.g. AGHON. Null if unreadable. */
  stormName: string | null;
  /** The international name, when the bulletin gives one. */
  internationalName: string | null;
  /** How PAGASA classifies it right now: "Typhoon", "Severe Tropical Storm"… */
  category: string | null;
  bulletinNo: number | null;
  /** "5:00 PM, 25 September 2026", exactly as printed. Not parsed into a Date:
     the bulletin carries no timezone and a wrong one would be worse than text. */
  issuedAt: string | null;
  windKph: number | null;
  gustKph: number | null;
  signals: WindSignal[];
  /** The first lines of the bulletin, so the card can show what was read. */
  excerpt: string;
};

export type BulletinReading =
  /** PAGASA says there is no cyclone in the area of responsibility. */
  | { state: "none" }
  /** A bulletin was read. Fields inside may still be null. */
  | { state: "active"; bulletin: Bulletin }
  /** The page was fetched but says nothing this parser recognises. */
  | { state: "unreadable" };

export const BULLETIN_URL =
  "https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin";

/** The page this is parsed from — the same bulletin, without the site chrome. */
export const BULLETIN_SOURCE =
  "https://www.pagasa.dost.gov.ph/tropical-cyclone-bulletin-iframe";

/* ---------------------------------------------------------------------------
 * HTML to text
 *
 * A real parser is not available here — this runs in a route handler with no
 * DOM — and is not needed: the bulletin's meaning is in its sentences. Scripts
 * and styles go first so their contents never reach the text.
 * ------------------------------------------------------------------------ */

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Block ends become line breaks, so "Issued at …" stays its own line.
    .replace(/<\/(p|div|tr|h[1-6]|li|table|section)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&laquo;/gi, "«")
    .replace(/&raquo;/gi, "»")
    .replace(/&ldquo;/gi, "“")
    .replace(/&rdquo;/gi, "”")
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    // Numeric entities, decimal and hex — the same characters, written the
    // other way by whatever produced the page.
    .replace(/&#(\d{2,5});/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]{2,5});/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    // Last, so an entity written as &amp;laquo; does not become a quote mark.
    .replace(/&amp;/gi, "&")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * The bulletin itself, without the navigation, footer and survey link that
 * surround it. Falls back to the whole page: a bulletin read with some menu
 * text around it is still a bulletin, and the anchors below are specific
 * enough to survive the extra words.
 */
export function bulletinRegion(html: string): string {
  const start = html.search(/class=["'][^"']*article-content/i);
  if (start === -1) return html;
  const tail = html.slice(start);
  const end = tail.search(/Click Here to get started with our short survey|<footer/i);
  return end === -1 ? tail : tail.slice(0, end);
}

/* ---------------------------------------------------------------------------
 * The bulletin
 * ------------------------------------------------------------------------ */

export function parseBulletin(html: string): BulletinReading {
  const text = htmlToText(bulletinRegion(html));

  if (/No Active Tropical Cyclone/i.test(text)) return { state: "none" };

  const bulletinNo = firstNumber(text, /BULLETIN\s*(?:NR|NO|NUMBER)\.?\s*:?\s*(\d{1,3})/i);
  const signals = parseSignals(text);

  /*
   * Two independent marks of a bulletin: its number and its signals. Requiring
   * one of them is what stops an unrecognised page — an error page, a redirect,
   * a redesign — from being reported as a storm with every field empty.
   */
  if (bulletinNo == null && signals.length === 0) return { state: "unreadable" };

  return {
    state: "active",
    bulletin: {
      stormName: parseStormName(text),
      internationalName: parseInternationalName(text),
      category: parseCategory(text),
      bulletinNo,
      issuedAt: firstMatch(text, /Issued\s+at\s+([^\n]{4,80})/i),
      windKph: firstNumber(
        text,
        /Maximum\s+sustained\s+winds?\s+of\s+([\d,]{2,6})\s*(?:km\/h|kph)/i,
      ),
      gustKph: firstNumber(
        text,
        /gustiness\s+of\s+up\s+to\s+([\d,]{2,6})\s*(?:km\/h|kph)/i,
      ),
      signals,
      excerpt: text.split("\n").slice(0, 12).join("\n").slice(0, 900),
    },
  };
}

/**
 * The local name. PAGASA sets it in guillemets — «AGHON» — and has for as long
 * as the bulletins have been online. Straight and curly quotes are accepted too,
 * because the same name is written "AGHON" in some of their headings.
 */
function parseStormName(text: string): string | null {
  const quoted = text.match(/[«"“]\s*([A-ZÑ][A-ZÑ\s'-]{1,22})\s*[»"”]/);
  return quoted ? tidy(quoted[1]) : null;
}

/** The international name, printed in brackets after the local one. */
function parseInternationalName(text: string): string | null {
  const after = text.match(
    /[«"“]\s*[A-ZÑ][A-ZÑ\s'-]{1,22}\s*[»"”]\s*\(\s*([A-Za-zÑñ][A-Za-z\s'-]{1,22})\s*\)/,
  );
  return after ? tidy(after[1]) : null;
}

/**
 * What PAGASA is calling it. Ordered longest first: "Severe Tropical Storm"
 * contains "Tropical Storm", and matching the shorter one would quietly
 * downgrade the storm on the card.
 */
const CATEGORIES = [
  "Super Typhoon",
  "Severe Tropical Storm",
  "Tropical Depression",
  "Tropical Storm",
  "Typhoon",
];

function parseCategory(text: string): string | null {
  for (const category of CATEGORIES) {
    if (new RegExp(`\\b${category}\\b`, "i").test(text)) return category;
  }
  return null;
}

/**
 * The wind signals and their areas.
 *
 * The bulletin heads each section with the signal number — "TCWS No. 2",
 * "Tropical Cyclone Wind Signal No. 2", "Wind Signal No. 2" — and lists the
 * places under it until the next such heading. Cutting the text on those
 * headings gives each level its own block without depending on the table
 * markup, which has changed more than once.
 */
/**
 * Where a signal's area list stops.
 *
 * The last signal heading in a bulletin is followed by the rest of the
 * document — location, intensity, movement, hazards — and that text names
 * places too. "The center was estimated 160 km West of Laoag City, Ilocos
 * Norte" is a sentence about the storm's position, not a list of areas under
 * Signal 1, and reading it as one put this barangay under a signal the
 * bulletin never gave it.
 */
const SECTION_END =
  /\b(LOCATION\s+OF\s+(?:THE\s+)?(?:CENTER|CENTRE|EYE)|INTENSITY|MOVEMENT|FORECAST|TRACK|HAZARDS?\s+AFFECTING|IMPACTS?\s+OF|WIND\s+THREAT|RAINFALL|STORM\s+SURGE|NEXT\s+BULLETIN|PREPAREDNESS)\b/i;

export function parseSignals(text: string): WindSignal[] {
  const heading =
    /(?:TROPICAL\s+CYCLONE\s+WIND\s+SIGNAL|WIND\s+SIGNAL|TCWS)\s*(?:NO\.?|NUMBER|#)?\s*([1-5])\b/gi;

  const marks: { level: number; from: number; to: number }[] = [];
  for (const match of text.matchAll(heading)) {
    const at = match.index ?? 0;
    if (marks.length > 0) marks[marks.length - 1].to = at;
    marks.push({ level: Number(match[1]), from: at + match[0].length, to: text.length });
  }

  /* One block per level, highest first. A level heading may appear more than
     once (a summary table and then the detail); the blocks are joined so no
     listed area is lost. */
  const byLevel = new Map<number, string[]>();
  for (const mark of marks) {
    const raw = text.slice(mark.from, mark.to);
    const stop = raw.search(SECTION_END);
    const body = tidy(stop === -1 ? raw : raw.slice(0, stop));
    if (!body) continue;
    const blocks = byLevel.get(mark.level) ?? [];
    blocks.push(body);
    byLevel.set(mark.level, blocks);
  }

  return [...byLevel.entries()]
    .map(([level, blocks]) => ({ level, areas: blocks.join(" ").slice(0, 2000) }))
    .sort((a, b) => b.level - a.level);
}

/* ---------------------------------------------------------------------------
 * Is this barangay in it?
 * ------------------------------------------------------------------------ */

export type AreaMatch =
  /** The province is listed whole. The signal applies here. */
  | "province"
  /** A part of the province is listed, and this municipality is named in it. */
  | "municipality"
  /** A part of the province is listed, and this municipality is not named. */
  | "partial"
  | "no";

/**
 * Whether an area block covers this barangay.
 *
 * The distinction that matters is `partial`. PAGASA very often writes "the
 * northern portion of Ilocos Norte (Pagudpud, Burgos, Bangui…)" — a signal that
 * does NOT cover Batac City, in a sentence containing the words "Ilocos Norte".
 * Reading that as a match would raise this barangay's signal for a storm
 * hitting the other end of the province, so it is reported as partial and the
 * official is asked to read the bulletin rather than being handed a number.
 */
export function matchArea(
  areas: string,
  place: { province: string; municipality: string },
): AreaMatch {
  const text = areas.toLowerCase();
  const province = place.province.toLowerCase().trim();
  if (!province || !text.includes(province)) return "no";

  /* "Batac City" is listed as "Batac"; the city itself may be written either
     way. Both are tried, longest first. */
  const town = place.municipality.toLowerCase().replace(/\bcity\b/g, "").trim();
  if (town && new RegExp(`\\b${escape(town)}\\b`).test(text)) return "municipality";

  /* A qualifier anywhere in the sentence that names the province. */
  const at = text.indexOf(province);
  const sentence = text.slice(Math.max(0, at - 160), at + province.length);
  return /\b(portion|part|parts|section|area)s?\s+of\b|\bnorthern\b|\bsouthern\b|\beastern\b|\bwestern\b|\bcentral\b|\bmainland\b/.test(
    sentence,
  )
    ? "partial"
    : "province";
}

export type SignalHere = {
  level: number;
  match: AreaMatch;
  /** The bulletin's wording for this level, to show beside the number. */
  areas: string;
};

/**
 * The highest signal that covers this barangay, and how sure that is.
 *
 * Highest, because signals nest: a place under TCWS 3 is inside the area the
 * bulletin also describes for lower levels, and the strongest one is the one to
 * act on. A `partial` match is returned only when no whole-province or
 * named-municipality match exists, so a certain answer always wins over a
 * doubtful one.
 */
export function signalHere(
  bulletin: Bulletin,
  place: { province: string; municipality: string },
): SignalHere | null {
  let partial: SignalHere | null = null;

  for (const signal of bulletin.signals) {
    const match = matchArea(signal.areas, place);
    if (match === "province" || match === "municipality") {
      return { level: signal.level, match, areas: signal.areas };
    }
    if (match === "partial" && !partial) {
      partial = { level: signal.level, match, areas: signal.areas };
    }
  }

  return partial;
}

/* ---------------------------------------------------------------------------
 * Small helpers
 * ------------------------------------------------------------------------ */

function firstMatch(text: string, pattern: RegExp): string | null {
  const found = text.match(pattern);
  return found ? tidy(found[1]) : null;
}

function firstNumber(text: string, pattern: RegExp): number | null {
  const found = firstMatch(text, pattern);
  if (found == null) return null;
  const value = Number(found.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
