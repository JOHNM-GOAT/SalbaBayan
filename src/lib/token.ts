/**
 * Check-in token handling (PRD §7.9).
 *
 * Kept apart from `checkin.ts` for the same reason `ledger.ts` is kept apart
 * from `headcount.ts`: this is the part that decides whether two different
 * inputs mean the same person, and it should be testable without a browser or
 * a database.
 *
 * It is also the only place the camera path and the manual path can diverge.
 * Everything downstream is shared, so if these functions are right, the §7.9
 * criterion — a typed token produces the same result as a scanned one — holds
 * by construction.
 */

export const STATUSES = ["checked_in", "evacuated", "needs_help"] as const;
export type CheckinStatus = (typeof STATUSES)[number];

/** Priority tags, ordered most urgent first for display. */
export const TAG_ORDER = ["medical", "elderly", "infant"] as const;

/**
 * The single point where a scanned string and a typed string become the same
 * thing.
 *
 * Case, surrounding whitespace and internal spaces are forgiven, because a
 * volunteer typing `sb 0142` at speed on a phone keyboard means the same card
 * the camera reads as `SB-0142`.
 *
 * What is deliberately NOT forgiven is the shape of the token. Punctuation and
 * length are left alone, so a typo that happens to produce a different valid
 * token fails to match rather than being coerced into somebody else's record —
 * which on this screen would mean recording the wrong person as safe.
 */
export function normaliseToken(raw: string): string {
  const bare = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

  /*
   * Re-form the printed shape (letters, hyphen, digits) when the input has
   * one. Cards read `SB-0142`, and a volunteer may reasonably type `sb0142`,
   * `sb 0142` or `SB_0142` — all of which mean the card in their hand, and all
   * of which would otherwise miss and show "not found" while a family waits at
   * the gate.
   *
   * This is safe against coercing a typo into somebody else's record: it only
   * re-inserts a separator, never changes a character, so `SB0143` reshapes to
   * `SB-0143` and still fails to match `SB-0142`. Anything that does not fit
   * the shape is left exactly as typed rather than guessed at.
   */
  const shaped = bare.match(/^([A-Z]+)(\d+)$/);
  return shaped ? `${shaped[1]}-${shaped[2]}` : bare;
}

/**
 * Whether a resident should be flagged for immediate attention.
 *
 * Any tag at all is priority. Ranking tags against each other would ask a
 * volunteer at a gate to make a triage judgement they have no time for and
 * were not trained to make.
 */
export const isPriority = (resident: { vulnerability_tags?: string[] }) =>
  (resident.vulnerability_tags ?? []).length > 0;
