import { enqueueUpdate, enqueueWrite } from "./offlineQueue";
import { getCurrentUserId, getSupabase } from "./supabase";

/**
 * A device's own name and address (migration 0038), and staff confirmation.
 *
 * Saved through the offline queue like every other write, so a first launch
 * with no signal can still give a name and report. The phone keeps its own
 * copy, which is what lets the app know "this device has a name" offline.
 */

export type Profile = {
  first_name: string;
  last_name: string;
  address: string | null;
  confirmed_at: string | null;
};

const key = (uid: string) => `salbabayan.profile:${uid}`;

function readCache(uid: string): Profile | null {
  try {
    const raw = localStorage.getItem(key(uid));
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

function writeCache(uid: string, profile: Profile): void {
  try {
    localStorage.setItem(key(uid), JSON.stringify(profile));
  } catch {
    // Not remembered offline; the server copy still counts.
  }
}

const listeners = new Set<() => void>();

export function onProfileChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** This device's profile: the server's answer when reachable, else the phone's copy. */
export async function loadMyProfile(): Promise<Profile | null> {
  const uid = await getCurrentUserId();
  if (!uid) return null;
  const cached = readCache(uid);

  const supabase = getSupabase();
  if (!supabase) return cached;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("first_name,last_name,address,confirmed_at")
      .eq("id", uid)
      .maybeSingle();
    if (error) return cached;
    if (!data) return cached; // a save may still be waiting in the queue
    writeCache(uid, data as Profile);
    return data as Profile;
  } catch {
    return cached;
  }
}

export const cleanName = (value: string) => value.trim().replace(/\s+/g, " ");

export async function saveMyProfile(input: {
  first_name: string;
  last_name: string;
  address: string;
}): Promise<boolean> {
  const uid = await getCurrentUserId();
  if (!uid) return false;

  const first = cleanName(input.first_name);
  const last = cleanName(input.last_name);
  const address = cleanName(input.address) || null;
  if (!first || !last) return false;

  const before = readCache(uid);
  const renamed = !before || before.first_name !== first || before.last_name !== last;

  if (before) {
    await enqueueUpdate("profiles", uid, { first_name: first, last_name: last, address });
  } else {
    await enqueueWrite("profiles", { id: uid, first_name: first, last_name: last, address });
  }

  // Same rule as the database: a new name is unconfirmed until staff check it.
  writeCache(uid, {
    first_name: first,
    last_name: last,
    address,
    confirmed_at: renamed ? null : (before?.confirmed_at ?? null),
  });
  for (const listener of [...listeners]) listener();
  return true;
}

/* ---------------------------------------------------------------------------
 * Staff
 * ------------------------------------------------------------------------ */

export type NamedPerson = { first_name: string; last_name: string; confirmed_at: string | null };

/** Names for report and SOS owners. RLS returns nothing to a resident. */
export async function namesFor(ids: string[]): Promise<Map<string, NamedPerson>> {
  const out = new Map<string, NamedPerson>();
  const wanted = [...new Set(ids.filter(Boolean))];
  const supabase = getSupabase();
  if (!supabase || wanted.length === 0) return out;
  try {
    const { data } = await supabase
      .from("profiles")
      .select("id,first_name,last_name,confirmed_at")
      .in("id", wanted);
    for (const row of (data ?? []) as (NamedPerson & { id: string })[]) out.set(row.id, row);
  } catch {
    // Offline: names simply do not show.
  }
  return out;
}

export type DeviceProfile = Profile;

/** The name behind a scanned phone, for the check-in card. */
export async function profileForDevice(code: string): Promise<DeviceProfile | null | undefined> {
  const supabase = getSupabase();
  if (!supabase) return undefined;
  try {
    const { data, error } = await supabase.rpc("profile_for_device", { device_code: code });
    if (error) return undefined;
    return ((data as DeviceProfile[] | null) ?? [])[0] ?? null;
  } catch {
    return undefined;
  }
}

export type ConfirmOutcome = "confirmed" | "no_name" | "self" | "offline" | "failed";

export async function confirmResident(code: string): Promise<ConfirmOutcome> {
  const supabase = getSupabase();
  if (!supabase) return "failed";
  if (typeof navigator !== "undefined" && !navigator.onLine) return "offline";
  try {
    const { error } = await supabase.rpc("confirm_resident", { device_code: code });
    if (!error) return "confirmed";
    if (error.code === "P0002") return "no_name";
    if (error.code === "SB001") return "self";
    return "failed";
  } catch {
    return "offline";
  }
}
