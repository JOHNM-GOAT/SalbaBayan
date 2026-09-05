/// <reference lib="webworker" />

/**
 * Service Worker (PRD §7.3 FR-3.3, NFR-8).
 *
 * The requirement is specific and easy to half-satisfy: caching API responses
 * alone is NOT enough. If the HTML document, JS and CSS are not precached, a
 * full reload in airplane mode lands on the browser's error page and the whole
 * offline story collapses at the exact moment it matters. `__SW_MANIFEST` is
 * the build's asset list, injected by Serwist — that is the app shell.
 */

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist, NetworkFirst, NetworkOnly, ExpirationPlugin } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const manifest = self.__SW_MANIFEST ?? [];

/**
 * Serwist's Next preset ships JS, CSS, fonts and the webmanifest — but no HTML.
 * Left alone, the shell document is only cached once the Service Worker is
 * already controlling a navigation, which is never the first visit. A resident
 * who opens SalbaBayan for the first time as the storm arrives and then loses
 * signal would have every asset cached except the page that loads them.
 *
 * So the document is added to the precache explicitly, which fetches it during
 * `install` — before the worker controls anything. The revision is pulled from
 * Next's build-id-stamped `_buildManifest` URL, so a new build invalidates the
 * cached HTML in step with the hashed chunks it references. They must expire
 * together: a shell that outlived its chunks would boot to a blank screen.
 */
const buildRevision =
  manifest
    .map((entry) => (typeof entry === "string" ? entry : entry.url))
    .find((url) => url.includes("_buildManifest")) ?? "dev";

/**
 * Routes precached as part of the shell. ADD NEW ROUTES HERE — a route missing
 * from this list still works offline via the runtime rule below, but only
 * after the resident has already visited it once with a connection, which is
 * not a safe assumption for this product.
 */
const SHELL_ROUTES = ["/", "/coverage", "/sos", "/responder"];

const serwist = new Serwist({
  precacheEntries: [
    ...manifest,
    ...SHELL_ROUTES.map((url) => ({ url, revision: buildRevision })),
  ],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    /*
     * Every OTHER document route. `/` is precached above; routes added in later
     * phases (map, SOS, check-in) are not, so they still need a runtime rule —
     * and this entry MUST come before `defaultCache`, whose catch-all would
     * otherwise claim them and expire them after 24 hours (maxAgeSeconds:
     * 86400). That is the wrong lifetime for this product: a resident who last
     * opened the app two days before landfall and then loses signal would get
     * the browser's error page, the exact failure NFR-8 exists to prevent. A
     * month comfortably outlasts a quiet stretch between storms.
     *
     * NetworkFirst, not StaleWhileRevalidate: these documents reference hashed
     * JS chunks, and a stale one surviving a deploy could point at chunks the
     * precache has already cleaned up. The 3s timeout keeps a slow tower from
     * making boot feel broken.
     */
    {
      matcher: ({ request, sameOrigin }) =>
        sameOrigin && request.destination === "document",
      handler: new NetworkFirst({
        cacheName: "salbabayan-shell",
        networkTimeoutSeconds: 3,
        plugins: [
          new ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: 30 * 24 * 60 * 60 }),
        ],
      }),
    },

    /*
     * Supabase REST. Deliberately NOT cached here — offline advisory data is
     * held by the app instead (lib/advisory.ts, one snapshot in IndexedDB).
     *
     * This looks like the wrong call for an offline-first app, so the reason
     * matters: if the Service Worker served these reads from cache, an offline
     * fetch would resolve successfully and be indistinguishable from a real
     * network read. The app would stamp `fetchedAt = now`, and the cache-age
     * indicator would report "synced just now" after three days with no signal.
     * FR-3.5 and the whole sync strip exist to state what is true; a cache that
     * quietly forges freshness defeats them.
     *
     * Letting the request fail is what lets the app fall back to a snapshot
     * whose age it can report honestly. Writes are unaffected — they never
     * depend on this path, they go through the Dexie queue.
     */
    {
      matcher: ({ url }) => url.pathname.startsWith("/rest/v1/"),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
