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
import { translatedLanguages } from "./i18n";
import {
  assignedVolunteerCount,
  buildReadiness,
  type ReadinessCheck,
  type RoleRow,
} from "./readiness";
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
   * The volunteer and resident counts are not in the snapshot, and both are
   * behind RLS.
   *
   * Residents are a plain count: `head: true` asks Postgres for the number
   * without shipping any rows. Volunteers cannot be. Which rows count depends
   * on comparing `granted_by` with `user_id` (see `assignedVolunteerCount`), and
   * PostgREST cannot compare two columns in a filter — so the volunteer rows are
   * fetched, three columns and role 'volunteer' only, and counted here. Only an
   * official can read other people's rows, and only an official's count is
   * trusted below.
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

  let volunteerCount = 0;
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
      const [volunteers, residents] = await Promise.all([
        supabase
          .from("user_roles")
          .select("user_id,role,granted_by")
          .eq("role", "volunteer"),
        supabase.from("residents").select("id", { count: "exact", head: true }),
      ]);

      if (!volunteers.error && !residents.error) {
        volunteerCount = assignedVolunteerCount((volunteers.data ?? []) as RoleRow[]);
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
  /*
   * "Every language" means every language the app is translated into — read
   * from the data, not the picker's list. The picker now offers dozens of
   * languages that have no strings yet; measuring against all of them would
   * pin this check at "partial" forever and teach officials to ignore it.
   * When a language's strings are added, it joins this check on its own.
   */
  const languages = [...translatedLanguages(snapshot.translations)];
  const fullyTranslated = [...referenced].filter((key) =>
    languages.every((code) => snapshot.translations[key]?.[code]),
  );

  return buildReadiness({
    purokCount: snapshot.puroks.length,
    protocolCells: snapshot.protocols.length,
    referencedKeys: [...referenced],
    fullyTranslatedKeys: fullyTranslated,
    volunteerCount,
    volunteerCountKnown: isOfficial && countsRead,
    residentCount,
    residentCountKnown: isStaff && countsRead,
    expectedHouseholds: snapshot.barangay.expected_households ?? null,
    centresWithCoordinates: snapshot.centers.filter(
      (c) => c.lat != null && c.lng != null,
    ).length,
    centreCount: snapshot.centers.length,
  });
}
