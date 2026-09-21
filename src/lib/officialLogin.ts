import { ensureAnonymousSession, getSupabase, notifyRoleChanged } from "./supabase";

/**
 * Official login by personal code (migration 0037). The code grants the
 * official role to this phone's own account; the server checks it, limits
 * wrong tries, and moves the code off any other phone. Online only: a login
 * must be answered while the official is holding the phone.
 */

export type LoginOutcome = "official" | "wrong" | "locked" | "offline" | "failed";

export async function loginWithCode(code: string): Promise<LoginOutcome> {
  const supabase = getSupabase();
  if (!supabase) return "failed";
  if (typeof navigator !== "undefined" && !navigator.onLine) return "offline";
  try {
    await ensureAnonymousSession();
    const { data, error } = await supabase.rpc("redeem_official_code", { code });
    if (error) return "failed";
    if (data === "official") notifyRoleChanged();
    return data === "official" || data === "wrong" || data === "locked" ? data : "failed";
  } catch {
    return "offline";
  }
}

export async function logoutOfficial(): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  try {
    const { error } = await supabase.rpc("logout_official");
    if (error) return false;
    notifyRoleChanged();
    return true;
  } catch {
    return false;
  }
}

/** The name on the code this phone is logged in with, or null. */
export async function myOfficialCode(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("my_official_code");
    return error ? null : ((data as string | null) ?? null);
  } catch {
    return null;
  }
}

export type OfficialCode = {
  id: string;
  label: string;
  hint: string;
  holder_code: string | null;
  created_at: string;
  last_used_at: string | null;
};

export async function listOfficialCodes(): Promise<OfficialCode[] | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("list_official_codes");
    return error ? null : ((data ?? []) as OfficialCode[]);
  } catch {
    return null;
  }
}

/** Returns the new code — shown once, never retrievable again — or null. */
export async function createOfficialCode(label: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("create_official_code", { code_label: label });
    return error ? null : (data as string);
  } catch {
    return null;
  }
}

export async function deleteOfficialCode(id: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  try {
    const { error } = await supabase.rpc("delete_official_code", { code_id: id });
    return !error;
  } catch {
    return false;
  }
}
