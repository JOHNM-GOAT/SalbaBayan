/**
 * Pre-storm readiness (PRD §5.2 F4).
 *
 * Pure read-side aggregation over tables that already exist — no new state
 * machine, nothing for anyone to keep up to date. That is the point: a
 * readiness checklist somebody has to tick by hand tells you what they
 * remembered to tick, not what is actually configured. Every check here is
 * derived from the same rows the app runs on, so it cannot drift from reality.
 *
 * The screen exists to be looked at BEFORE a storm. Each gap it shows is a
 * resident who would open the app mid-typhoon and find nothing useful.
 *
 * Two of the counts are RLS-scoped, and that has to be handled explicitly:
 * a viewer who is not permitted to read the roster counts zero rows, which is
 * indistinguishable from an empty roster unless we say so. Reporting that as
 * "missing" would paint a configured barangay red on a resident's phone, so
 * those checks report `unknown` instead. Same principle as the rest of this
 * module, in the other direction: never turn "I cannot see" into a verdict.
 */

export type CheckStatus = "ready" | "partial" | "missing" | "unknown";

export type ReadinessCheck = {
  id: string;
  /** Where to go to fix it, or null when there is nowhere to send them yet. */
  href: string | null;
  status: CheckStatus;
  /** The numbers behind the verdict, so it can be argued with. */
  done: number;
  total: number | null;
  detail?: string;
};

export type ReadinessInput = {
  purokCount: number;
  /** Distinct (purok, signal) cells that have a protocol row. */
  protocolCells: number;
  /** Every message key that any protocol references. */
  referencedKeys: string[];
  /** Keys that have a string in every launch language. */
  fullyTranslatedKeys: string[];
  staffCount: number;
  /**
   * Whether `staffCount` is the barangay's roster size or just what RLS let
   * this viewer see. `read_own_role` returns only your own row unless you are
   * an official, so a volunteer counting the roster counts to exactly 1 no
   * matter how many volunteers exist.
   */
  staffCountKnown: boolean;
  residentCount: number;
  /** `read_residents` is staff-only — a resident counts 0 out of any roster. */
  residentCountKnown: boolean;
  expectedHouseholds: number | null;
  centresWithCoordinates: number;
  centreCount: number;
};

/** Signal levels a protocol grid must cover. */
export const SIGNAL_LEVELS = 5;

function ratioStatus(done: number, total: number): CheckStatus {
  if (total <= 0) return "unknown";
  if (done >= total) return "ready";
  return done === 0 ? "missing" : "partial";
}

/**
 * Build the checklist.
 *
 * Deliberately returns `unknown` rather than a guess wherever the data to
 * answer honestly is absent. A dashboard that shows green because it has
 * nothing to check is worse than one that admits it does not know — the whole
 * value here is being trusted before a storm.
 */
export function buildReadiness(input: ReadinessInput): ReadinessCheck[] {
  const protocolTotal = input.purokCount * SIGNAL_LEVELS;

  const checks: ReadinessCheck[] = [
    {
      // FR-4.1
      id: "protocols",
      href: "/coverage",
      done: input.protocolCells,
      total: protocolTotal,
      status: ratioStatus(input.protocolCells, protocolTotal),
    },
    {
      // FR-3.4 / FR-4.1's sibling: a configured protocol nobody can read in
      // their own language is not configured.
      id: "translations",
      href: null,
      done: input.fullyTranslatedKeys.length,
      total: input.referencedKeys.length,
      status: ratioStatus(input.fullyTranslatedKeys.length, input.referencedKeys.length),
    },
    {
      // FR-4.2
      id: "volunteers",
      href: null,
      done: input.staffCount,
      // One is not "ready", it is a single point of failure — but there is no
      // defensible target beyond that, so the bar is deliberately low and the
      // number is shown rather than dressed up.
      total: 2,
      status: !input.staffCountKnown
        ? "unknown"
        : input.staffCount === 0
          ? "missing"
          : input.staffCount < 2
            ? "partial"
            : "ready",
      detail: input.staffCountKnown ? undefined : "not-permitted",
    },
    {
      // FR-4.3
      id: "residents",
      href: null,
      done: input.residentCount,
      total: input.expectedHouseholds,
      status: !input.residentCountKnown
        ? "unknown"
        : input.expectedHouseholds == null
          ? "unknown"
          : ratioStatus(input.residentCount, input.expectedHouseholds),
      detail: !input.residentCountKnown
        ? "not-permitted"
        : input.expectedHouseholds == null
          ? "no-baseline"
          : undefined,
    },
    {
      // Not in F4, but a gap with the same consequence: a centre with no
      // coordinates cannot be a destination on the evacuation map.
      id: "centres",
      href: "/map",
      done: input.centresWithCoordinates,
      total: input.centreCount,
      status: ratioStatus(input.centresWithCoordinates, input.centreCount),
    },
  ];

  return checks;
}

/**
 * Overall verdict.
 *
 * A single `unknown` does not make the barangay "unknown" overall — but it
 * must not be allowed to read as ready either, so it degrades the summary the
 * same way a partial does.
 */
export function overallStatus(checks: ReadinessCheck[]): CheckStatus {
  if (checks.some((c) => c.status === "missing")) return "missing";
  if (checks.some((c) => c.status === "partial" || c.status === "unknown")) return "partial";
  return "ready";
}

export const readyCount = (checks: ReadinessCheck[]) =>
  checks.filter((c) => c.status === "ready").length;
