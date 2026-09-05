import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

/*
 * Service Worker via Serwist.
 *
 * The PRD fixes the stack to `next-pwa`, but that package has been
 * unmaintained since 2022, predates the App Router, and does not run on
 * Next 16. Serwist is its maintained successor and keeps the same role:
 * precache the app shell so a full reload with no network still boots.
 * Substitution approved by the team; logged in docs/TASKS.md.
 */
const isDev = process.env.NODE_ENV === "development";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // A stale precache while editing is a debugging trap, and offline behaviour
  // has to be verified against a production build anyway.
  disable: isDev,
  reloadOnOnline: false,
});

const nextConfig: NextConfig = {};

/*
 * Serwist is applied for builds only — and NOT merely disabled in dev.
 *
 * `disable: true` still leaves the plugin wrapping the config with a `webpack`
 * function, and Next 16 runs dev on Turbopack by default. Turbopack sees a
 * webpack config it did not expect and refuses to start:
 *
 *   ERROR: This build is using Turbopack, with a `webpack` config and no
 *   `turbopack` config.
 *
 * Skipping the wrapper entirely in dev is what actually resolves that, and it
 * keeps Turbopack's fast refresh. `npm run build` stays pinned to --webpack,
 * because Serwist is a webpack plugin and that is where it genuinely runs.
 */
export default isDev ? nextConfig : withSerwist(nextConfig);
