import {
  ensureAnonymousSession,
  getCurrentUserId,
  getSupabase,
  notifyRoleChanged,
  type UserRole,
} from "./supabase";

/**
 * Official access (migration 0042).
 *
 * Being an official is a role in the database; the shared 4-digit PIN only
 * unlocks the official pages on a device that already has that role, and is
 * asked again every time the app is opened (sessionStorage ends with the app).
 * The access code makes any device an official with full administration
 * ("super"); the app shows that simply as "Official".
 *
 * Everything here is online only: the server answers, and an unanswered
 * question is never treated as a yes.
 */

const UNLOCK_KEY = "salbabayan.official.unlocked";
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of [...listeners]) listener();
}

export function onUnlockChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isUnlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

function setUnlocked(value: boolean): void {
  try {
    if (value) sessionStorage.setItem(UNLOCK_KEY, "1");
    else sessionStorage.removeItem(UNLOCK_KEY);
  } catch {
    // Not remembered: the PIN is simply asked again.
  }
  announce();
}

export function lockOfficialPages(): void {
  setUnlocked(false);
}

const offline = () => typeof navigator !== "undefined" && !navigator.onLine;

export type PinOutcome = "unlocked" | "wrong" | "offline" | "failed";

/*
 * Offline unlock. The PIN is asked every time the app opens, and an official
 * opening it with no signal mid-storm must not be locked out of their own
 * pages. So after the server accepts the PIN, the phone keeps a hash of it
 * (salted with this device's id) and can check it again without a signal.
 * This only ever unlocks pages the device's role already allows; a PIN changed
 * since works offline only after the next online unlock.
 */
const pinKey = (uid: string) => `salbabayan.official.pin:${uid}`;

async function pinDigest(uid: string, pin: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${uid}:${pin}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function offlineUnlock(pin: string): Promise<PinOutcome> {
  const uid = await getCurrentUserId();
  if (!uid) return "offline";
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(pinKey(uid));
  } catch {
    stored = null;
  }
  if (!stored) return "offline";
  if (stored !== (await pinDigest(uid, pin))) return "wrong";
  setUnlocked(true);
  return "unlocked";
}

export async function unlockWithPin(pin: string): Promise<PinOutcome> {
  const supabase = getSupabase();
  if (!supabase || offline()) return offlineUnlock(pin);
  try {
    const { data, error } = await supabase.rpc("verify_official_pin", { pin });
    if (error) return "failed";
    if (data !== true) return "wrong";
    const uid = await getCurrentUserId();
    if (uid) {
      try {
        localStorage.setItem(pinKey(uid), await pinDigest(uid, pin));
      } catch {
        // Not remembered: offline unlock is simply unavailable on this phone.
      }
    }
    setUnlocked(true);
    return "unlocked";
  } catch {
    return offlineUnlock(pin);
  }
}

export type CodeOutcome = "official" | "wrong" | "locked" | "disabled" | "offline" | "failed";

export async function redeemAccessCode(code: string): Promise<CodeOutcome> {
  const supabase = getSupabase();
  if (!supabase) return "failed";
  if (offline()) return "offline";
  try {
    await ensureAnonymousSession();
    const { data, error } = await supabase.rpc("redeem_access_code", { code });
    if (error) return "failed";
    if (data === "official") {
      notifyRoleChanged();
      setUnlocked(true);
      return "official";
    }
    return data === "wrong" || data === "locked" || data === "disabled" ? data : "failed";
  } catch {
    return "offline";
  }
}

export type Access = { role: UserRole; isSuper: boolean };

export async function myAccess(): Promise<Access | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("my_access");
    const row = (data as { role: UserRole; is_super: boolean }[] | null)?.[0];
    if (error || !row) return null;
    return { role: row.role, isSuper: row.is_super };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * User management (super officials)
 * ------------------------------------------------------------------------ */

export type ManagedUser = {
  device_code: string;
  first_name: string | null;
  last_name: string | null;
  confirmed: boolean;
  role: UserRole;
  is_super: boolean;
  is_me: boolean;
};

export async function listUsers(search: string): Promise<ManagedUser[] | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("list_users", { search });
    return error ? null : ((data ?? []) as ManagedUser[]);
  } catch {
    return null;
  }
}

export type AdminOutcome = "done" | "invalid" | "self" | "not_found" | "offline" | "failed";

async function adminCall(fn: string, args: Record<string, unknown>): Promise<AdminOutcome> {
  const supabase = getSupabase();
  if (!supabase) return "failed";
  if (offline()) return "offline";
  try {
    const { error } = await supabase.rpc(fn, args);
    if (!error) return "done";
    if (error.code === "22023") return "invalid";
    if (error.code === "SB001") return "self";
    if (error.code === "P0002") return "not_found";
    return "failed";
  } catch {
    return "offline";
  }
}

export const setUserRole = (code: string, role: UserRole) =>
  adminCall("set_user_role", { device_code: code, new_role: role });
export const setOfficialPin = (pin: string) => adminCall("set_official_pin", { new_pin: pin });
export const setAccessCode = (code: string) => adminCall("set_access_code", { new_code: code });
export const setAccessCodeEnabled = (enabled: boolean) =>
  adminCall("set_access_code_enabled", { enabled });

export type AccessStatus = { pin_set: boolean; code_set: boolean; code_enabled: boolean; updated_at: string };

export async function accessStatus(): Promise<AccessStatus | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("access_status");
    return error ? null : (((data as AccessStatus[] | null) ?? [])[0] ?? null);
  } catch {
    return null;
  }
}

/** A full-access device gives it up and is a resident's again (migration 0044). */
export async function leaveFullAccess(): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase || offline()) return false;
  try {
    const { error } = await supabase.rpc("leave_full_access");
    if (error) return false;
    setUnlocked(false);
    notifyRoleChanged();
    return true;
  } catch {
    return false;
  }
}
