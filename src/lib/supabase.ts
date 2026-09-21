/**
 * Supabase browser client.
 *
 * Auth model (PRD §3, §9, and the decision logged in docs/TASKS.md):
 * residents never see a login screen. On first load the client signs in
 * ANONYMOUSLY, which costs the user nothing and shows them nothing, but still
 * mints a real `auth.uid()`. That uid is what every RLS policy keys off, so
 * role boundaries stay enforced at the Postgres layer rather than in the UI.
 *
 * Volunteers and officials are the same anonymous identity, elevated by an
 * official inserting their uid into `user_roles`. No password exists to lose
 * mid-storm.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

/**
 * Returns the shared client, or null when env vars are absent.
 *
 * Null is a supported state, not an error case: the app must still boot and
 * render cached content with no backend reachable (NFR-1). Callers branch on
 * null; the offline queue treats it as "not reachable" and queues the write.
 */
export function getSupabase(): SupabaseClient | null {
  if (!url || !anonKey) return null;
  if (typeof window === "undefined") return null;

  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Session lives in localStorage so a reload with no network still has
        // an identity — required for offline writes to carry a valid uid.
        storageKey: "salbabayan.auth",
      },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }

  return client;
}

/**
 * Idempotent silent sign-in. Safe to call on every mount.
 * Fails soft: with no network there is nothing to do but carry on with
 * whatever session is already cached.
 */
export async function ensureAnonymousSession(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data: existing } = await supabase.auth.getSession();
  if (existing.session?.user?.id) return existing.session.user.id;

  try {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) return null;
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * The current device's uid from the cached session, or null offline-before-
 * first-sign-in. Reads the stored session rather than calling the network, so
 * it stays usable with no connectivity.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

export type UserRole = "resident" | "volunteer" | "official";

/**
 * Staff is volunteer or official — the same set `private.is_staff()` uses, and
 * the set the team calls "verified": an official granting the volunteer role IS
 * the verification, so there is no second flag to check.
 *
 * Lives here rather than in components/useMyRole.ts because plain library code
 * needs it too, and a "use client" module is the wrong place to reach for a
 * three-line predicate over a type declared in this file.
 */
export function isStaffRole(role: UserRole | null): boolean {
  return role === "volunteer" || role === "official";
}

/*
 * Role changes are announced, because nothing else would notice.
 *
 * `useMyRole` resolves once per session, keyed on the user id — which is right
 * when a role is granted by an official on another device and wrong the moment
 * a device can change its OWN role. Without this, switching to VOLUNTEER left
 * every mounted screen still holding "resident" until a full reload.
 */
const roleListeners = new Set<() => void>();

export function onRoleChanged(listener: () => void): () => void {
  roleListeners.add(listener);
  return () => {
    roleListeners.delete(listener);
  };
}

let roleInFlight: Promise<UserRole> | null = null;

/** Forget any in-flight read, so the next call goes back to the database. */
function invalidateRole(): void {
  roleInFlight = null;
}

/**
 * Reads the caller's role. Defaults to `resident` — the least-privileged
 * answer — whenever the role cannot be established, including offline.
 * This is a display hint only. The real boundary is RLS.
 *
 * Concurrent callers share one query. Every screen that needs the role calls
 * this, and the hazard sheet is mounted in the layout beside whichever page is
 * showing — so one role change fanned out into an identical
 * `select ... eq(user_id, uid)` per mounted component, and would get worse with
 * every screen added. Only the IN-FLIGHT read is shared, never the result, so
 * this de-duplicates without ever serving a cached role.
 */
export async function getMyRole(): Promise<UserRole> {
  return (roleInFlight ??= readMyRole().finally(() => {
    roleInFlight = null;
  }));
}

async function readMyRole(): Promise<UserRole> {
  const supabase = getSupabase();
  if (!supabase) return "resident";

  /*
   * Filtered to the caller's own uid, and that filter is load-bearing rather
   * than tidiness. `read_own_role` is `user_id = auth.uid() OR is_official()`,
   * so an official can read the WHOLE table — and `.maybeSingle()` errors with
   * PGRST116 the moment more than one row comes back. Unfiltered, every
   * official was silently reported as "resident" as soon as a second staff
   * member existed, which is exactly what the readiness dashboard tells them
   * to arrange.
   */
  /*
   * `getCurrentUserId` reads the stored session; `auth.getUser()` would post
   * to /auth/v1/user to revalidate the token. This function is called from
   * nearly every screen, so that would be a network round trip per mount in a
   * product whose whole premise is working without one.
   */
  const uid = await getCurrentUserId();
  if (!uid) return "resident";

  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", uid)
    .maybeSingle();

  if (error || !data?.role) return "resident";
  return data.role as UserRole;
}

/* ---------------------------------------------------------------------------
 * Officials managing roles (migration 0032)
 * ------------------------------------------------------------------------ */

/** The code the ME tab shows: the first 8 characters of the device's id. */
export function deviceCodeOf(userId: string): string {
  return userId.slice(0, 8).toUpperCase();
}

export type StaffMember = { userId: string; role: UserRole; grantedAt: string };

/** Every volunteer and official. RLS returns rows other than your own only to officials. */
export async function listStaff(): Promise<StaffMember[] | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("user_roles")
    .select("user_id,role,granted_at")
    .in("role", ["volunteer", "official"])
    .order("role")
    .order("granted_at");
  if (error) return null;
  return data.map((row) => ({
    userId: row.user_id as string,
    role: row.role as UserRole,
    grantedAt: row.granted_at as string,
  }));
}

export type SetDeviceRoleOutcome =
  | "granted"
  | "invalid"
  | "not_found"
  | "self"
  | "offline"
  | "failed";

/*
 * Online only, deliberately not queued: the code is resolved on the server, and
 * an official reading a code off someone's screen needs to hear "no device has
 * that code" while that person is still standing there, not hours later.
 */
export async function setDeviceRole(code: string, role: UserRole): Promise<SetDeviceRoleOutcome> {
  const supabase = getSupabase();
  if (!supabase) return "failed";
  if (typeof navigator !== "undefined" && !navigator.onLine) return "offline";

  try {
    const { error } = await supabase.rpc("set_device_role", {
      device_code: code,
      new_role: role,
    });
    if (!error) return "granted";
    switch (error.code) {
      case "22023":
        return "invalid";
      case "P0002":
        return "not_found";
      case "SB001":
        return "self";
      default:
        console.warn("[set-device-role]", error.code, error.message);
        return "failed";
    }
  } catch {
    return "offline";
  }
}
