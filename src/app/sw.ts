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
import { Serwist, NetworkFirst, ExpirationPlugin } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    /*
     * Advisory reference data — protocols, translations, puroks, barangays.
     * NetworkFirst, not CacheFirst: a resident should get the current signal
     * level when the network allows, and the last known one when it does not.
     * Never the reverse.
     */
    {
      matcher: ({ url }) =>
        url.pathname.startsWith("/rest/v1/") ||
        /\/rest\/v1\/(protocols|translations|puroks|barangays|evac_centers)/.test(url.href),
      handler: new NetworkFirst({
        cacheName: "salbabayan-advisory",
        networkTimeoutSeconds: 5,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 64,
            // A week-old advisory is still worth showing, clearly labelled with
            // its age, rather than showing a resident nothing at all.
            maxAgeSeconds: 7 * 24 * 60 * 60,
          }),
        ],
      }),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
