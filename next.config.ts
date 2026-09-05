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
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // Disabled in dev: a stale precache while editing is a debugging trap, and
  // offline behaviour must be verified against a production build anyway.
  disable: process.env.NODE_ENV === "development",
  reloadOnOnline: false,
});

const nextConfig: NextConfig = {};

export default withSerwist(nextConfig);
