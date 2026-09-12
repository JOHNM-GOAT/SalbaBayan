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

/**
 * DEMO ONLY — grants the calling device a role (migration 0017).
 *
 * This is a self-promotion path and it is meant to be removed: dropping
 * `public.set_demo_role` closes it completely, with no other code change
 * needed, because this function then simply fails and the role stays whatever
 * an official granted. See the migration for the full argument.
 *
 * Returns the role actually in force afterwards, which is NOT assumed to be the
 * one requested: if the RPC is gone, or the device is offline, the honest
 * answer is whatever the database still says.
 */
export async function setDemoRole(target: UserRole): Promise<UserRole> {
  const supabase = getSupabase();
  if (!supabase) return getMyRole();

  const { data, error } = await supabase.rpc("set_demo_role", { target });
  if (error) {
    // Expected once the function is dropped for a real deployment. The switch
    // then does what it always did — change navigation — and the role holds.
    console.warn("[demo-role]", error.message);
    return getMyRole();
  }

  for (const listener of [...roleListeners]) listener();
  return (data as UserRole) ?? target;
}

/**
 * Reads the caller's role. Defaults to `resident` — the least-privileged
 * answer — whenever the role cannot be established, including offline.
 * This is a display hint only. The real boundary is RLS.
 */
export async function getMyRole(): Promise<UserRole> {
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
