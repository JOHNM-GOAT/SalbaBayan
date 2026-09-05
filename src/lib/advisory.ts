/**
 * Advisory data (PRD §7.1, §7.2, FR-2.x, FR-3.x).
 *
 * The whole barangay's reference data is fetched as ONE snapshot and cached as
 * one record. That is deliberate, and it is what makes the Phase 1 gate
 * reachable:
 *
 *   - Switching language or Purok becomes pure client-side derivation from a
 *     snapshot already in memory. No refetch, so it works offline and needs no
 *     reload (FR-3.1, and the AC for §7.2).
 *   - There is exactly one `fetchedAt`, so "cache age" is a single honest
 *     number rather than a different age per table.
 *
 * The data is tiny — one barangay, 8 Puroks, ~33 protocols, ~30 translations —
 * so fetching all of it costs less than the round trips needed to fetch only
 * the slice one resident happens to need.
 */

import Dexie, { type Table } from "dexie";
import { getSupabase } from "./supabase";
import type { Language, TranslationMap } from "./i18n";
import { resolveMessage } from "./i18n";

export type Barangay = {
  id: string;
  name: string;
  municipality: string;
  province: string;
  current_signal_level: number;
  signal_set_at: string | null;
  storm_name: string | null;
  bulletin_no: number | null;
  wind_kph: number | null;
  evacuate_by: string | null;
  default_language: string;
};

export type Purok = { id: string; name: string; barangay_id: string };

export type Protocol = {
  id: string;
  purok_id: string;
  signal_level: number;
  route: string | null;
  action_key: string;
  evac_center_id: string | null;
};

export type EvacCenter = {
  id: string;
  purok_id: string;
  name: string;
  capacity: number;
};

export type AdvisorySnapshot = {
  barangay: Barangay;
  puroks: Purok[];
  protocols: Protocol[];
  centers: EvacCenter[];
  translations: TranslationMap;
  /** When the network genuinely answered. Never set from a cache read. */
  fetchedAt: number;
};

/* ---------------------------------------------------------------------------
 * Cache
 * ------------------------------------------------------------------------ */

class AdvisoryDB extends Dexie {
  snapshots!: Table<{ key: string; snapshot: AdvisorySnapshot }, string>;

  constructor() {
    super("salbabayan-advisory");
    this.version(1).stores({ snapshots: "key" });
  }
}

let cacheDb: AdvisoryDB | null = null;

function getCacheDb(): AdvisoryDB | null {
  if (typeof window === "undefined") return null;
  if (!cacheDb) cacheDb = new AdvisoryDB();
  return cacheDb;
}

const SNAPSHOT_KEY = "current";

export async function readCachedAdvisory(): Promise<AdvisorySnapshot | null> {
  const db = getCacheDb();
  if (!db) return null;
  try {
    const row = await db.snapshots.get(SNAPSHOT_KEY);
    return row?.snapshot ?? null;
  } catch {
    return null;
  }
}

async function writeCachedAdvisory(snapshot: AdvisorySnapshot): Promise<void> {
  const db = getCacheDb();
  if (!db) return;
  try {
    await db.snapshots.put({ key: SNAPSHOT_KEY, snapshot });
  } catch {
    // Storage full or unavailable. The in-memory snapshot still serves this
    // session; the next load simply starts cold.
  }
}

/* ---------------------------------------------------------------------------
 * Fetch
 * ------------------------------------------------------------------------ */

/**
 * Pull a fresh snapshot. Throws when the network cannot answer — callers treat
 * that as "keep showing the cache", never as "show nothing".
 *
 * Note the Service Worker deliberately does NOT cache these reads (see
 * src/app/sw.ts). If it did, an offline fetch would resolve from cache and look
 * like a successful network read, and `fetchedAt` would reset to now — the
 * cache-age indicator would then claim "synced just now" after three days
 * offline. Letting the request fail is what keeps that number honest.
 */
export async function fetchAdvisory(): Promise<AdvisorySnapshot> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("no supabase client");

  const [barangays, puroks, protocols, centers, translations] =
    await Promise.all([
      supabase
        .from("barangays")
        // Kept as one literal: supabase-js parses the select list at the type
        // level, and a concatenated string is not a literal type, so it
        // resolves to an error type instead of the row shape.
        .select(
          "id,name,municipality,province,current_signal_level,signal_set_at,storm_name,bulletin_no,wind_kph,evacuate_by,default_language",
        )
        .limit(1),
      supabase.from("puroks").select("id,name,barangay_id").order("name"),
      supabase
        .from("protocols")
        .select("id,purok_id,signal_level,route,action_key,evac_center_id"),
      supabase.from("evac_centers").select("id,purok_id,name,capacity"),
      supabase.from("translations").select("message_key,language,text"),
    ]);

  const failure =
    barangays.error ??
    puroks.error ??
    protocols.error ??
    centers.error ??
    translations.error;
  if (failure) throw new Error(failure.message);

  const barangay = barangays.data?.[0];
  if (!barangay) throw new Error("no barangay configured");

  const map: TranslationMap = {};
  for (const row of translations.data ?? []) {
    (map[row.message_key] ??= {})[row.language] = row.text;
  }

  return {
    barangay: barangay as Barangay,
    puroks: (puroks.data ?? []) as Purok[],
    protocols: (protocols.data ?? []) as Protocol[],
    centers: (centers.data ?? []) as EvacCenter[],
    translations: map,
    fetchedAt: Date.now(),
  };
}

/** Fetch and cache in one step. Returns null when the network could not answer. */
export async function refreshAdvisory(): Promise<AdvisorySnapshot | null> {
  try {
    const snapshot = await fetchAdvisory();
    await writeCachedAdvisory(snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Derivation — everything below is pure, so it runs offline and re-runs on a
 * language or Purok change without touching the network.
 * ------------------------------------------------------------------------ */

/**
 * What a resident in one Purok should see right now.
 *
 * `protocol: null` is a real, expected outcome, not an error — it means this
 * cell of the Purok x Signal matrix was never configured. FR-2.6 requires that
 * be visible rather than papered over, because a blank card during a storm
 * reads as "nothing to do".
 */
export type PurokAdvisory = {
  signalLevel: number;
  /** null when there is no protocol for this Purok at this signal level. */
  protocol: Protocol | null;
  center: EvacCenter | null;
  headline: string;
  action: string;
  /** True when the text shown came from the fallback language, not the choice. */
  usedFallback: boolean;
  /** Evacuation-level signals only (FR-2.7). */
  evacuateBy: Date | null;
};

/**
 * The seed pairs every `action.x` with a `headline.x`. Deriving one key from
 * the other keeps a protocol row to a single `action_key`, so an official
 * configuring a cell cannot leave the headline and the instruction disagreeing.
 */
export function headlineKeyFor(actionKey: string): string {
  return actionKey.replace(/^action\./, "headline.");
}

/** Signals 3 and above are evacuation-level for this barangay's protocol set. */
export const EVACUATION_SIGNAL = 3;

export function deriveAdvisory(
  snapshot: AdvisorySnapshot,
  purokId: string,
  language: Language,
): PurokAdvisory {
  const { barangay, protocols, centers, translations } = snapshot;
  const signalLevel = barangay.current_signal_level;

  const protocol =
    protocols.find(
      (p) => p.purok_id === purokId && p.signal_level === signalLevel,
    ) ?? null;

  const center = protocol?.evac_center_id
    ? (centers.find((c) => c.id === protocol.evac_center_id) ?? null)
    : null;

  const fallback = barangay.default_language;

  const headline = protocol
    ? resolveMessage(
        translations,
        headlineKeyFor(protocol.action_key),
        language,
        fallback,
      )
    : "";

  const action = protocol
    ? resolveMessage(translations, protocol.action_key, language, fallback)
    : "";

  const usedFallback = protocol
    ? !translations[protocol.action_key]?.[language]
    : false;

  return {
    signalLevel,
    protocol,
    center,
    headline,
    action,
    usedFallback,
    evacuateBy:
      signalLevel >= EVACUATION_SIGNAL && barangay.evacuate_by
        ? new Date(barangay.evacuate_by)
        : null,
  };
}

/* ---------------------------------------------------------------------------
 * Coverage matrix (FR-2.6) — the pre-storm readiness view.
 * ------------------------------------------------------------------------ */

export type CoverageCell = { signalLevel: number; configured: boolean };
export type CoverageRow = { purok: Purok; cells: CoverageCell[]; gaps: number };

/**
 * The Purok x Signal grid, with unconfigured cells flagged.
 *
 * This exists to be looked at *before* a storm. A gap found here is a
 * configuration task; the same gap found during a storm is a resident staring
 * at an empty screen.
 */
export function buildCoverage(snapshot: AdvisorySnapshot): {
  rows: CoverageRow[];
  totalGaps: number;
} {
  const levels = [1, 2, 3, 4, 5];

  const rows = snapshot.puroks.map((purok) => {
    const cells = levels.map((signalLevel) => ({
      signalLevel,
      configured: snapshot.protocols.some(
        (p) => p.purok_id === purok.id && p.signal_level === signalLevel,
      ),
    }));
    return { purok, cells, gaps: cells.filter((c) => !c.configured).length };
  });

  return {
    rows,
    totalGaps: rows.reduce((sum, r) => sum + r.gaps, 0),
  };
}

/*
 * Purok persistence lives in lib/prefs.ts alongside language, for the same
 * reason: it is browser-owned state read at render time, not React state.
 */
