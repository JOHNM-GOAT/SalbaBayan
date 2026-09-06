/**
 * Headcount arithmetic (PRD §7.8).
 *
 * Kept apart from `headcount.ts` because this is the part that must be right
 * and has no business touching the network. Everything here is pure, so it can
 * be tested without a browser, a bundler or a database — which matters,
 * because these are the failures that produce a *plausible* wrong answer
 * rather than an error. A count that is simply too low reads exactly like a
 * count that is correct.
 */

export type DeltaEntry = { delta: number };

/**
 * The count. Summed on read from the append-only ledger — there is no stored
 * total that could disagree with it, and therefore no race to lose.
 */
export const totalFrom = (entries: DeltaEntry[]) =>
  entries.reduce((sum, entry) => sum + entry.delta, 0);

export type Capacity = "ok" | "filling" | "full";

/**
 * Capacity state (FR-8.2).
 *
 * "Filling" starts at 75%, well before the doors actually close. A centre that
 * only warns at capacity warns too late: by then a family is already walking
 * there, and the alternative is another twenty minutes away in the rain.
 *
 * A capacity of zero means unconfigured, and reads as `ok` rather than `full`.
 * The opposite would tell a volunteer to turn people away from a centre with
 * room, on the strength of a missing field.
 */
export function capacityState(count: number, capacity: number): Capacity {
  if (capacity <= 0) return "ok";
  const ratio = count / capacity;
  if (ratio >= 1) return "full";
  if (ratio >= 0.75) return "filling";
  return "ok";
}

/**
 * A short, readable stand-in for a recorder's identity.
 *
 * The ledger has to show who made each entry — that is what makes it an audit
 * trail rather than a number. There are no names in this system by design, so
 * the device code is the identity, matching the one shown on the Device & Role
 * screen.
 */
export function deviceLabel(uid: string | null): string {
  if (!uid) return "—";
  return `D-${uid.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

export function clockLabel(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", hour12: true })
    .toUpperCase();
}
