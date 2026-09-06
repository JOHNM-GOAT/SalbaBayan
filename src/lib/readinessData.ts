/**
 * Reads for the readiness dashboard (PRD §5.2 F4).
 *
 * Everything here is aggregation over tables the app already uses. Nothing
 * writes, and nothing stores a "readiness state" that could go stale — which
 * is the property that makes this screen worth trusting the day before a
 * storm.
 */

import { getMyRole } from "./supabase";
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
  const role = await getMyRole();
  const isOfficial = role === "official";
  const isStaff = isOfficial || role === "volunteer";

  let staffCount = 0;
  let residentCount = 0;

  if (supabase) {
    const [staff, residents] = await Promise.all([
      supabase.from("user_roles").select("user_id", { count: "exact", head: true }),
      supabase.from("residents").select("id", { count: "exact", head: true }),
    ]);
    staffCount = staff.count ?? 0;
    residentCount = residents.count ?? 0;
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
    staffCountKnown: isOfficial,
    residentCount,
    residentCountKnown: isStaff,
    expectedHouseholds: snapshot.barangay.expected_households ?? null,
    centresWithCoordinates: snapshot.centers.filter(
      (c) => c.lat != null && c.lng != null,
    ).length,
    centreCount: snapshot.centers.length,
  });
}

export type DocumentRow = {
  filename: string;
  title: string;
  content: string;
  updated_at: string;
};

/**
 * The knowledge base (FR-13.3). Official-only by RLS, so a resident who
 * reaches this route gets an empty list rather than an error.
 */
export async function loadDocuments(): Promise<DocumentRow[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("documents")
    .select("filename,title,content,updated_at")
    .order("filename");

  if (error) return [];
  return (data ?? []) as DocumentRow[];
}
