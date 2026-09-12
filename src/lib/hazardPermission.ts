/**
 * Who may mark a hazard report fixed.
 *
 * Its own module, with no imports, for the same reason `rescueMerge.ts` is: it
 * is a rule rather than a piece of plumbing, it is the kind of rule that is
 * wrong in ways nobody notices until the wrong person clears a downed-power-line
 * warning, and `lib/hazards.ts` cannot be imported by a test without dragging
 * Dexie and a Supabase client into Node with it.
 *
 * This MIRRORS the `resolve_hazards` RLS policy. It does not enforce anything —
 * the database does that, and would still refuse a forged request from a
 * patched client. What this decides is whether the app offers the action at
 * all, which matters because the alternative is a button that silently does
 * nothing.
 */

export type ResolverRole = "resident" | "volunteer" | "official" | null;

/** What the rule needs to know about a report. */
export type Resolvable = { reported_by: string | null };

/** Staff is volunteer or official — the same set `private.is_staff()` uses. */
export function isStaff(role: ResolverRole): boolean {
  return role === "volunteer" || role === "official";
}

/**
 * The policy is `reported_by = auth.uid() or private.is_staff()`, and read
 * against the three rules the team asked for, it already says all three:
 *
 *   1. "both volunteers and residents can fix the issue" — a resident may
 *      resolve the report they filed themselves.
 *   2. "if a volunteer created a report, only a volunteer can fix or resolve
 *      it" — the only non-staff person who could match `reported_by` on a
 *      volunteer's report is that volunteer, and they are staff. So a resident
 *      never can.
 *   3. "only verified volunteers can mark an incident as fixed" — holds for
 *      every report except the reporter's own, which is rule 1.
 *
 * `role === null` means NOT YET KNOWN, not "resident". It is treated as
 * not-staff here, which is the safe direction: the worst case is that a
 * volunteer briefly sees the note instead of the button while their role
 * resolves, rather than being offered an action that is about to be refused.
 */
export function canResolveHazard(
  hazard: Resolvable,
  uid: string | null,
  role: ResolverRole,
): boolean {
  if (isStaff(role)) return true;
  return !!uid && hazard.reported_by !== null && hazard.reported_by === uid;
}
