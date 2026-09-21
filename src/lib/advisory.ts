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
 * The data is small — one barangay, a handful of areas and protocols — apart
 * from the translations, which are only re-downloaded when they change (see
 * `fetchAdvisory`).
 */

import Dexie, { type Table } from "dexie";
import type { RealtimeChannel } from "@supabase/supabase-js";
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
  expected_households: number | null;
  /** The barangay's own point — where every map opens. */
  lat: number | null;
  lng: number | null;
  /** Its outline. Drawn on the map; keeps the evacuation centre inside. */
  boundary_geojson: GeoPolygon | null;
  /** Shown to officials with its source; not a live count. */
  population: number | null;
  population_source: string | null;
};

export type GeoPolygon = { type: "Polygon"; coordinates: number[][][] };
export type GeoLine = { type: "LineString"; coordinates: number[][] };

export type Purok = {
  id: string;
  name: string;
  barangay_id: string;
  /** Null for areas named after streets, which have no outline of their own. */
  boundary_geojson: GeoPolygon | null;
  /** Where this area's walking route starts. */
  lat: number | null;
  lng: number | null;
};

export type Protocol = {
  id: string;
  purok_id: string;
  signal_level: number;
  route: string | null;
  route_geojson: GeoLine | null;
  action_key: string;
  evac_center_id: string | null;
};

export type EvacCenter = {
  id: string;
  purok_id: string;
  name: string;
  /** Null until an official sets it. Never guessed: it drives the FULL warning. */
  capacity: number | null;
  lat: number | null;
  lng: number | null;
};

/**
 * Open hazards, carried in the snapshot so the evacuation map can warn about a
 * blocked path with no connection. Coordinates are nullable: a hazard reported
 * without a GPS fix is still worth showing in a list, it just cannot be plotted
 * or tested against a route.
 */
export type Hazard = {
  id: string;
  purok_id: string;
  category: string;
  description: string | null;
  status: string;
  ts: string;
  lat: number | null;
  lng: number | null;
};

export type AdvisorySnapshot = {
  barangay: Barangay;
  puroks: Purok[];
  protocols: Protocol[];
  centers: EvacCenter[];
  hazards: Hazard[];
  translations: TranslationMap;
  /** Server fingerprint of `translations`; absent in snapshots cached before it existed. */
  translationsVersion?: string;
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
type TranslationRow = { message_key: string; language: string; text: string };

/*
 * The server returns at most 1,000 rows per request (Supabase's max_rows), and
 * says nothing when it stops there. With every language translated there are
 * ~9,700 rows, so one plain select silently dropped most of them — and, being
 * unordered, not even the same ones each time: a resident could lose the
 * Tagalog for "evacuate now" and see the raw key instead.
 *
 * So: count, then fetch every page in parallel, in a fixed order. A short page
 * anywhere is a failure, not a smaller dictionary.
 */
const TRANSLATION_PAGE = 1000;

async function fetchAllTranslations(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
): Promise<{ data: TranslationRow[] | null; error: { message: string } | null }> {
  const head = await supabase
    .from("translations")
    .select("message_key", { count: "exact", head: true });
  if (head.error) return { data: null, error: head.error };
  const total = head.count ?? 0;

  const pages = await Promise.all(
    Array.from({ length: Math.ceil(total / TRANSLATION_PAGE) }, (_, i) =>
      supabase
        .from("translations")
        .select("message_key,language,text")
        .order("language")
        .order("message_key")
        .range(i * TRANSLATION_PAGE, (i + 1) * TRANSLATION_PAGE - 1),
    ),
  );
  const failed = pages.find((p) => p.error);
  if (failed?.error) return { data: null, error: failed.error };

  const rows = pages.flatMap((p) => (p.data ?? []) as TranslationRow[]);
  if (rows.length < total) {
    return { data: null, error: { message: `translations: got ${rows.length} of ${total}` } };
  }
  return { data: rows, error: null };
}

/*
 * The snapshot is refetched on every live change, and in a storm those come
 * often. The translations are almost all of its weight (~600 KB) and almost
 * never change, so the phone asks for their fingerprint first and keeps the
 * cached ones when it matches. All languages stay on the phone, so switching
 * language still works offline.
 */
export async function fetchAdvisory(
  previous: AdvisorySnapshot | null = null,
): Promise<AdvisorySnapshot> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("no supabase client");

  const [barangays, puroks, protocols, centers, version, hazards] =
    await Promise.all([
      supabase
        .from("barangays")
        // Kept as one literal: supabase-js parses the select list at the type
        // level, and a concatenated string is not a literal type, so it
        // resolves to an error type instead of the row shape.
        .select(
          "id,name,municipality,province,current_signal_level,signal_set_at,storm_name,bulletin_no,wind_kph,evacuate_by,default_language,expected_households,lat,lng,boundary_geojson,population,population_source",
        )
        .limit(1),
      supabase
        .from("puroks")
        .select("id,name,barangay_id,boundary_geojson,lat,lng")
        .order("name"),
      supabase
        .from("protocols")
        .select("id,purok_id,signal_level,route,route_geojson,action_key,evac_center_id"),
      supabase.from("evac_centers").select("id,purok_id,name,capacity,lat,lng"),
      supabase.rpc("translations_version"),
      // Only open hazards. Resolved ones are history, and history on an
      // evacuation map is noise that hides the thing you must avoid.
      supabase
        .from("hazard_reports")
        .select("id,purok_id,category,description,status,ts,lat,lng")
        .eq("status", "open"),
    ]);

  const failure =
    barangays.error ??
    puroks.error ??
    protocols.error ??
    centers.error ??
    hazards.error;
  if (failure) throw new Error(failure.message);

  const barangay = barangays.data?.[0];
  if (!barangay) throw new Error("no barangay configured");

  // A failed version check just means downloading them, as before.
  const translationsVersion =
    !version.error && typeof version.data === "string" ? version.data : undefined;

  let map: TranslationMap;
  if (translationsVersion && previous?.translationsVersion === translationsVersion) {
    map = previous.translations;
  } else {
    // Fetched after the version, so the rows are never older than the hash
    // stored with them — at worst newer, which only costs one more download.
    const translations = await fetchAllTranslations(supabase);
    if (translations.error) throw new Error(translations.error.message);
    map = {};
    for (const row of translations.data ?? []) {
      (map[row.message_key] ??= {})[row.language] = row.text;
    }
  }

  return {
    barangay: barangay as Barangay,
    puroks: (puroks.data ?? []) as Purok[],
    protocols: (protocols.data ?? []) as Protocol[],
    centers: (centers.data ?? []) as EvacCenter[],
    hazards: (hazards.data ?? []) as Hazard[],
    translations: map,
    translationsVersion,
    fetchedAt: Date.now(),
  };
}

/** Fetch and cache in one step. Returns null when the network could not answer. */
export async function refreshAdvisory(): Promise<AdvisorySnapshot | null> {
  try {
    const snapshot = await fetchAdvisory(await readCachedAdvisory());
    await writeCachedAdvisory(snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Live updates
 * ------------------------------------------------------------------------ */

/**
 * Tell every open phone the moment the advisory changes.
 *
 * Until the official could set the signal from the app this was not needed —
 * and it was quietly missing anyway: the snapshot was refreshed only on load
 * and on reconnect, so a resident with the app already open kept reading
 * Signal 3 while the barangay had moved to Signal 4. `barangays` was already in
 * the realtime publication; nothing was listening.
 *
 * One channel, many listeners — the same shape `subscribeHazards` and
 * `subscribeRescue` had to grow. A channel name is global to the client, and
 * adding a second `postgres_changes` binding to a channel that has already
 * subscribed throws.
 *
 * Only phones with the app OPEN hear this. Waking a phone asleep in a pocket
 * needs push notifications, which this does not attempt.
 */
let advisoryChannel: RealtimeChannel | null = null;
const advisoryListeners = new Set<() => void>();

/*
 * Every table the snapshot — and so every map — is drawn from.
 *
 * It began with `barangays` alone, for the signal. The relocation to Callaguip
 * added two more reasons to listen: an official can now move the evacuation
 * centre (evac_centers, and the routes in protocols), and the evacuation map
 * showed hazards only as fresh as its last reload. Listening here refreshes the
 * whole snapshot on any of them, so a moved centre, a redrawn route and a new
 * hazard all reach an open phone within seconds.
 */
const LIVE_TABLES = [
  "barangays",
  "puroks",
  "evac_centers",
  "protocols",
  "hazard_reports",
] as const;

/**
 * Where a map opens: the barangay's own point, or #5 Callaguip's before the
 * snapshot has loaded (OSM node 8883724672). A single constant, instead of the
 * three copies of Sta. Cruz's coordinates the map screens used to carry.
 */
export const FALLBACK_CENTRE: [number, number] = [120.5615882, 18.0634855];

export function barangayCentre(barangay: Barangay | null | undefined): [number, number] {
  return barangay?.lat != null && barangay.lng != null
    ? [barangay.lng, barangay.lat]
    : FALLBACK_CENTRE;
}

export function subscribeAdvisory(onChange: () => void): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};

  advisoryListeners.add(onChange);

  if (!advisoryChannel) {
    // Copied before notifying: a listener may unsubscribe in response.
    const notify = () => {
      for (const listener of [...advisoryListeners]) listener();
    };
    let channel = supabase.channel("advisory-live");
    for (const table of LIVE_TABLES) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        notify,
      );
    }
    advisoryChannel = channel.subscribe();
  }

  return () => {
    advisoryListeners.delete(onChange);

    // Tear the channel down only when nobody is left, and drop the reference
    // first so a subscriber arriving mid-teardown builds a fresh one.
    if (advisoryListeners.size === 0 && advisoryChannel) {
      const channel = advisoryChannel;
      advisoryChannel = null;
      void supabase.removeChannel(channel);
    }
  };
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
  /**
   * The protocol whose route and centre to show. The same as `protocol` under
   * a signal. With no signal up (level 0) it is the Purok's lowest-level
   * protocol, so the resident sees the way to the hall while there is still
   * time to learn it.
   */
  routeProtocol: Protocol | null;
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

  /*
   * No signal is not a coverage gap. Nobody configures a Signal 0 protocol,
   * and treating its absence as one told every resident, on an ordinary day,
   * that guidance was missing — and hid the route on the map.
   */
  const routeProtocol =
    protocol ??
    (signalLevel === 0
      ? (protocols
          .filter((p) => p.purok_id === purokId)
          .sort((a, b) => a.signal_level - b.signal_level)[0] ?? null)
      : null);

  const center = routeProtocol?.evac_center_id
    ? (centers.find((c) => c.id === routeProtocol.evac_center_id) ?? null)
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
    routeProtocol,
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
