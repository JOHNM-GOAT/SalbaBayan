import { NextResponse } from "next/server";
import { BULLETIN_SOURCE, parseBulletin, type BulletinReading } from "@/lib/pagasa";

/**
 * The PAGASA Tropical Cyclone Bulletin, read on the server.
 *
 * On the server because the browser cannot: PAGASA sends no CORS header, so a
 * fetch from the phone is blocked before it starts. Routing it through here
 * also means one fetch serves every official, and PAGASA sees this app as one
 * polite caller rather than one per device.
 *
 * Whatever happens, this answers with a reading — `unavailable` when PAGASA
 * could not be reached, `unreadable` when the page came back and said nothing
 * this app recognises. The official page shows either as "could not read the
 * bulletin" beside a link to it. It never invents a storm and never invents
 * calm: there is no state here that means "no cyclone" unless PAGASA said so.
 */

/** Long enough to be worth caching, short enough that a new bulletin lands. */
const CACHE_SECONDS = 600;

/** PAGASA is slow under load, and this is a dashboard card, not the alert. */
const TIMEOUT_MS = 8000;

export type BulletinResponse =
  | (BulletinReading & { fetchedAt: string })
  | { state: "unavailable"; fetchedAt: string };

export async function GET() {
  const fetchedAt = new Date().toISOString();

  try {
    const response = await fetch(BULLETIN_SOURCE, {
      headers: {
        // Named honestly. An operator reading their logs should be able to
        // tell who this is and that it is a barangay warning app.
        "user-agent": "SalbaBayan/1.0 (barangay flood alert; +https://salba-bayan.vercel.app)",
        accept: "text/html",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Next revalidates this fetch, so a burst of officials opening the
      // dashboard is still one request upstream.
      next: { revalidate: CACHE_SECONDS },
    });

    if (!response.ok) return answer({ state: "unavailable", fetchedAt });

    const reading = parseBulletin(await response.text());
    return answer({ ...reading, fetchedAt });
  } catch {
    // Timeout, DNS, TLS, PAGASA down in the middle of the storm it is
    // reporting on. All the same to the reader: no bulletin from here.
    return answer({ state: "unavailable", fetchedAt });
  }
}

function answer(body: BulletinResponse) {
  return NextResponse.json(body, {
    headers: {
      /*
       * Served from the edge cache for ten minutes, and the stale copy keeps
       * being served for an hour while a fresh one is fetched behind it — so a
       * PAGASA outage during a storm shows the last bulletin with its age
       * rather than nothing at all.
       */
      "cache-control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=3600`,
    },
  });
}
