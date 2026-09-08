/**
 * Reads for the readiness dashboard (PRD §5.2 F4).
 *
 * Everything here is aggregation over tables the app already uses. Nothing
 * writes, and nothing stores a "readiness state" that could go stale — which
 * is the property that makes this screen worth trusting the day before a
 * storm.
 */

import { getMyRole, type UserRole } from "./supabase";
import { getSupabase } from "./supabase";
import { LANGUAGES } from "./i18n";
import { buildReadiness, type ReadinessCheck } from "./readiness";
import { headlineKeyFor, type AdvisorySnapshot } from "./advisory";

/**
 * Build the checklist from a snapshot the app already holds, plus the two
 * counts that are not in it.
 *
 * Using the cached snapshot means the dashboard renders offline with the same
 * numbers the resident-facing screens are using — an official checking
 * readiness in a hall with poor signal is the expected case, not an edge one.
 */
export async function loadReadiness(
  snapshot: AdvisorySnapshot | null,
): Promise<ReadinessCheck[] | null> {
  if (!snapshot) return null;

  const supabase = getSupabase();

  /*
   * Staff and resident counts are not in the snapshot, and both are behind
   * RLS. `head: true` asks Postgres for the count without shipping the rows —
   * this screen needs the size of the roster, never its contents.
   *
   * Crucially, a count the viewer is not allowed to take comes back as 0, not
   * as an error. So we record whether each number is *knowable* by this viewer
   * and let buildReadiness report `unknown` rather than a false "missing":
   *
   *   - `read_own_role` returns only your own row unless you are an official,
   *     so only an official gets a true roster size.
   *   - `read_residents` is staff-only (NFR-4.3), so a resident counts 0.
   */
  let role: UserRole = "resident";
  try {
    role = await getMyRole();
  } catch {
    // Offline, or the auth endpoint is unreachable. Least privilege, and the
    // knowability flags below turn that into "unknown" rather than "missing".
  }
  const isOfficial = role === "official";
  const isStaff = isOfficial || role === "volunteer";

  let staffCount = 0;
  let residentCount = 0;
  /*
   * Whether the counts were actually READ, as opposed to defaulted.
   *
   * Permission alone is not enough. A count that failed — offline, a timeout,
   * a 5xx — arrives here as 0 and is indistinguishable from an empty roster,
   * so an official on a bad connection would be told "0/2 volunteers" and
   * "0/48 residents" in alarm red for a fully staffed barangay. That is the
   * same false alarm the permission case already guards against, reached
   * through the error path instead.
   */
  let countsRead = false;

  if (supabase) {
    try {
      const [staff, residents] = await Promise.all([
        supabase.from("user_roles").select("user_id", { count: "exact", head: true }),
        supabase.from("residents").select("id", { count: "exact", head: true }),
      ]);

      if (!staff.error && !residents.error) {
        staffCount = staff.count ?? 0;
        residentCount = residents.count ?? 0;
        countsRead = true;
      }
    } catch {
      // A rejected request must not take the whole dashboard down with it:
      // protocols, translations and centres are all computable from the
      // cached snapshot and stay useful with no network at all.
    }
  }

  /* Every message key any protocol depends on — the action and its headline. */
  const referenced = new Set<string>();
  for (const protocol of snapshot.protocols) {
    referenced.add(protocol.action_key);
    referenced.add(headlineKeyFor(protocol.action_key));
  }

  /* A key counts as translated only when every launch language has a string.
     One missing language is one group of residents reading nothing. */
  const fullyTranslated = [...referenced].filter((key) =>
    LANGUAGES.every(({ code }) => snapshot.translations[key]?.[code]),
  );

  return buildReadiness({
    purokCount: snapshot.puroks.length,
    protocolCells: snapshot.protocols.length,
    referencedKeys: [...referenced],
    fullyTranslatedKeys: fullyTranslated,
    staffCount,
    staffCountKnown: isOfficial && countsRead,
    residentCount,
    residentCountKnown: isStaff && countsRead,
    expectedHouseholds: snapshot.barangay.expected_households ?? null,
    centresWithCoordinates: snapshot.centers.filter(
      (c) => c.lat != null && c.lng != null,
    ).length,
    centreCount: snapshot.centers.length,
  });
}
