# SalbaBayan — Task Tracker

Source of truth: [`stage-2/PRD.md`](../stage-2/PRD.md) · [`stage-2/PRD-detailed.md`](../stage-2/PRD-detailed.md) · [`stage-2/design/`](../stage-2/design/)

## Status legend
- [ ] not started
- [~] in progress
- [x] done
- [!] blocked / needs clarification

---

## Phase 0 — Foundation
- [x] Project scaffold: Next.js 16 (App Router) + React 19 + Tailwind v4 — `npm run build` passes
- [x] Design tokens ported to Tailwind theme (`src/app/globals.css`)
- [x] Offline write utility (`src/lib/offlineQueue.ts`) — Dexie queue, stable client id, upsert-on-retry
- [x] Queue flush listener — in-order, idempotent, `online` event + 30s poll
- [x] Anonymous-auth Supabase client (`src/lib/supabase.ts`)
- [x] Persistent sync strip — cache age + queued count (`src/components/SyncStrip.tsx`)
- [x] Schema + RLS applied to project `mpdzehfmxwuxjklgeqrz` — 13 tables, RLS on every one
- [x] Security advisors: **0 ERROR-level** after moving RLS helpers to a `private` schema. 14 WARN remain and are expected — 13 `auth_allow_anonymous_sign_ins` (that is the auth model chosen in Q2, and the boundaries it needs are what `scripts/rls-test.mjs` asserts) and 1 leaked-password check, moot in an app where nobody sets a password.
- [x] Seed fixtures applied — 8 puroks, 33 protocols (7 deliberate gaps), 30 translations, 3 centres, 5 residents, Signal 3
- [x] Env wired (`.env.local`, template committed as `.env.example`)
- [x] RLS verified through the live REST API: no JWT returns `[]` for `protocols`
- [x] Anonymous sign-in enabled and verified — real auth.uid(), is_anonymous: true, authenticated role
- [x] Service Worker app-shell precache via Serwist — 48 manifest entries (JS, CSS, fonts, webmanifest) plus a runtime shell-document cache
- [x] **GATE (RLS): 18/18 pass** via `node scripts/rls-test.mjs` against the live REST API
- [x] **GATE (offline): passes.** Production build, server stopped dead (`curl` → `000`), full reload: shell boots, Archivo/Plex render from precache, severity rail grey, sync strip present.

## Phase 1 — Advisory Core (7.1, 7.2)
- [x] Signal x Purok table + coverage matrix — `/coverage`, renders the 7 seeded gaps as dashed outlines
- [x] `current_signal_level` join — one snapshot (barangay + puroks + protocols + centres + translations), derived per Purok client-side
- [x] Bulletin context added (FR-2.3, FR-2.7): `storm_name`, `bulletin_no`, `wind_kph`, `evacuate_by`, `default_language` — migration `0004`
- [x] Leave-by deadline + live countdown, evacuation-level signals only (FR-2.7)
- [x] Coverage gap renders as an explicit "no protocol configured" card, never a blank one (FR-2.6)
- [x] Translations wiring — Tagalog/Cebuano/English, UI chrome included (migration `0005`)
- [x] Fallback to the barangay's *configured* default language, shown with an explicit notice (FR-3.5)
- [x] **GATE: passes.** Production build, server stopped dead (`curl` → `000`), full reload → correct advisory for Purok 3 / Signal 3 / Barangay Gym. Language switched TL → CEB → EN and Purok switched 3 → 5 while offline, both correct, `performance.getEntriesByType('navigation').length` stayed at **1** throughout — no reload.

## Phase 2 — Offline-First Hardening (7.3)
- [ ] All write paths confirmed to use offline utility
- [ ] Cache age / queue count visible on every screen
- [ ] GATE: airplane-mode test passes

## Phase 3 — SOS & Rescue Map (7.4)
- [ ] One-tap GPS capture + queued write, no auth
- [ ] State machine + elapsed timer + responder identity
- [ ] Hold-to-cancel
- [!] Responder live map (Realtime, sorted by wait) — blocked on Q3 (Maps API key)
- [ ] Rate limiting
- [ ] GATE: offline SOS reaches responder map with correct original-tap timer

## Phase 4 — Offline Evacuation Map (7.5)
- [!] MapLibre GPS + boundary + route — blocked on Q4 (real geography + tile source)
- [ ] Pre-downloaded tile packs cached
- [ ] Hazard overlay + path-blocked warning
- [ ] GATE: airplane-mode map opens/pans/renders correctly

## Phase 5 — Water-Level Reporting (7.6)
- [ ] Body-referenced scale input
- [ ] Resident + volunteer access, timestamped/attributable
- [ ] GATE: cross-device 5s sync test

## Phase 6 — Hazard Reports (7.7)
- [ ] Category picker + optional photo, no moderation
- [ ] Resolve by reporter/volunteer/official
- [ ] Realtime push, no polling
- [ ] Photo-fail-safe (local blob retry)
- [ ] GATE: offline hazard report syncs to all clients within 5s of reconnect

## Phase 7 — Headcount Tracking (7.8)
- [ ] Append-only ledger, SUM(delta)
- [ ] Capacity warning + vulnerability breakdown
- [ ] GATE: concurrency test (two simultaneous +1 taps both land)

## Phase 8 — QR Check-In (7.9)
- [ ] qr_token generation + jsqr scan
- [ ] Vulnerability tags on scan
- [ ] Status logging (checked-in/evacuated/needs-help)
- [ ] Manual entry fallback
- [ ] GATE: manual entry matches scan result

## Phase 9 — Deferred (do not start until Phases 0-8 are all [x])
- [ ] Pre-Storm Readiness Checklist
- [ ] Documentation Knowledge Base

---

## Open questions / ambiguities

**Q8 — RESOLVED.** Anonymous sign-in is enabled and verified. (The toggle had been flipped but not saved.) Original detail: The auth model agreed in Q2 depends on it: without anonymous sign-in, no client can obtain a session, so every RLS policy (all scoped `to authenticated`) denies everything and the app has no identity to attach writes to. Verified live:

```
POST /auth/v1/signup  ->  {"code":422,"error_code":"anonymous_provider_disabled",
                           "msg":"Anonymous sign-ins are disabled"}
```

  **Action needed:** enable it at [Authentication → Sign In / Providers](https://supabase.com/dashboard/project/mpdzehfmxwuxjklgeqrz/auth/providers) → *Anonymous Sign-Ins* → toggle on. There is no MCP tool for auth configuration, so this cannot be done from here. One click, then the gate can close.

**Q1 — Supabase capacity. RESOLVED.** The team created project **`SalbaBayan`** (`mpdzehfmxwuxjklgeqrz`, ap-northeast-1, Postgres 17) under a different organisation. Schema, RLS, and seed all applied successfully. Original blocker below, kept for the record:
  - `create_project("salbabayan")` → `BadRequestException`
  - `restore_project(xtxiskhmjmwjhicwxiyu)` → `ForbiddenException`

  Both return: *"Potchixxx (2 project limit), JOHNM-GOAT (2 project limit) … will need to either delete, pause or upgrade one or more of these projects."* Cost is **$0/month** — this is a free-tier project *count* limit, not a billing issue. Only one project (`xtxiskhmjmwjhicwxiyu`, paused) and one org are visible to this token, so the two active projects sit elsewhere.

  **Action needed from the team:** at [supabase.com/dashboard](https://supabase.com/dashboard), pause or delete one active free project. Then either restore `xtxiskhmjmwjhicwxiyu` or create a fresh `salbabayan`. Nothing was paused or deleted automatically — that is the team's call, not a decision to make on someone else's account.

  Everything in Phase 0 that does not need a database is already done and building.

**Q2 — Auth model. RESOLVED: anonymous auth.** The team initially asked for "no login-access". Flagged that literal zero-auth would leave every client on the same Postgres `anon` role, so RLS could not separate resident from official — contradicting NFR-5, §9, and the kickoff's non-negotiable RLS constraint. Resolved with Supabase **anonymous sign-in**: no login screen is ever shown (satisfying the request), but each device still gets a real `auth.uid()` for RLS to key off. Officials are elevated by inserting their uid into `user_roles`. Implemented in `src/lib/supabase.ts` and `0001_foundation.sql`.

**Q7 — RESOLVED: Serwist.** `next-pwa` does not support Next.js 16. The PRD and kickoff both fix the stack to `next-pwa`, and the kickoff says not to substitute without asking. But `next-pwa` (shadowwalker) has been unmaintained since 2022, predates the App Router, and will not work with Next 16.3. Options: `@ducanh2912/next-pwa` (maintained App Router fork, same config shape), `serwist` (its official successor), or a hand-written Service Worker with no wrapper. Team chose **Serwist** (the maintained successor). Implemented in `next.config.ts` and `src/app/sw.ts`. Serwist is webpack-based while Next 16 defaults to Turbopack, so the build script is pinned to `next build --webpack`.

**Q3 — Google Maps JavaScript API key.** Required for the Phase 3 responder rescue map (PRD §11 lists it as the one non-open-source dependency). No key provided. Needs a billing-enabled Google Cloud project.

**Q4 — Real geography, or keep the fictional pilot?** PRD-detailed Q1 records the pilot barangay as unconfirmed. The wireframes use fictional "Barangay San Isidro" with hand-drawn SVG streets. Phase 4 needs (a) a real barangay's coordinates and Purok boundary polygons, and (b) a vector tile source/style for the offline packs (self-hosted PMTiles? MapTiler? OpenFreeMap?). Until resolved, Phase 4 can only be built against synthetic GeoJSON.

**Q5 — Screens with no wireframe.** The kickoff prompt says to flag rather than guess. The eight artboards in `design/` cover: advisory home, evacuation map, SOS, hazard/water report, QR check-in, headcount, responder dashboard, protocol admin. The following are required by the PRD but have **no wireframe**:
  - Resident registration / onboarding (Purok selection, QR issuance) — needed for Phase 8
  - Sign-in screen for volunteer/official — needed for Phase 0 once Q2 is settled
  - Full reports feed (home shows a 2-item preview with a "Tingnan lahat" link to a list that does not exist)
  - Evacuation centre directory (home quick-action "CENTERS" links nowhere)
  - Profile / "Ako" tab (present in the bottom nav on every phone screen)
  - Pre-Storm Readiness Checklist as a full view (only a sidebar widget appears in the admin artboard)
  - Documentation Knowledge Base (Phase 9)

**Q6 — Route geometry authoring.** PRD §10 says Purok boundaries and `route_geojson` are "entered by officials during protocol setup," but the protocol-admin artboard shows only a *rendered preview* of a route, never an editor for drawing one. Is drawing in-app, or is GeoJSON imported from a file the LGU supplies?

---

## Notes / decisions log

- **2026-09-05 — Phase 1 bug: the advisory was empty on a first-ever load.** `ensureAnonymousSession()` and the advisory fetch ran concurrently. Every advisory policy is scoped `to authenticated`, so a read that wins the race comes back as `[]` rather than an error — indistinguishable from "this barangay has no data configured". The result was a permanent empty state until the resident happened to reload, on precisely the load where a first-time user forms their impression of whether the app works. Fixed by awaiting the session before fetching. Caught by wiping storage and loading cold; a warm reload hides it completely.

- **2026-09-05 — Phase 1 bug: the sync strip hid cache age exactly when it mattered.** It rendered `online ? age : "OFFLINE"`, so going offline *replaced* the age. That inverts the §7.3 acceptance criterion, which says in airplane mode "the cached advisory shows its age" — offline is when a resident most needs to know whether the instruction on screen is ten minutes or three days old. Now shows both: `OFFLINE · CACHED 12 MIN · 2 NAKA-QUEUE`.

- **2026-09-05 — Supabase REST is deliberately NOT Service-Worker cached.** Counter-intuitive for an offline-first app, so the reasoning is in `src/app/sw.ts`: a cached REST response makes an offline fetch succeed, which is indistinguishable from a real network read, which resets `fetchedAt` — and the cache-age indicator would then report "synced just now" after three days with no signal. Offline data is held instead as one app-level snapshot in IndexedDB (`lib/advisory.ts`) with a single honest `fetchedAt`. Letting the request fail is what keeps the number true.

- **2026-09-05 — The advisory is fetched whole, not per-resident.** One snapshot holds the barangay, all 8 Puroks, all ~33 protocols, all centres and all ~90 translations. It is a few kilobytes, and it buys the Phase 1 gate outright: switching language or Purok becomes pure derivation from memory, so both work offline with no refetch and no reload. Fetching only the slice one resident needs would have cost more round trips and made offline Purok switching impossible.

- **2026-09-05 — A deliberate translation gap, mirroring the deliberate protocol gaps.** Cebuano for `action.stay_inside` / `headline.stay_inside` (Signal 5) is intentionally absent. With every string present, the FR-3.5 fallback path has no data that exercises it and could ship broken while looking fine. It is also the realistic case: the rarest signal level is the one a barangay is least likely to have finished translating. Verified — a Cebuano resident at Signal 5 sees the Tagalog text plus a Cebuano notice reading "Wala pa niini nga pinulongan. Gipakita sa Tagalog."

- **2026-09-05 — Preferences read as external stores, not copied into state.** Language and Purok live in `lib/prefs.ts` behind `useSyncExternalStore`. Copying `localStorage` into `useState` inside an effect meant first paint always showed the default and corrected on a second render — a visible flash of the wrong language on every load. Subscribing to `storage` also keeps two open tabs in agreement.

- **2026-09-05 — Not built, and why: distance to the evacuation centre.** The approved design shows "850 m" beside the centre name, and FR-2.5 asks for distance. `evac_centers` has no coordinates and there is no geography yet (Q4 is still open), so the centre renders without a distance rather than with an invented one. A fabricated number on an evacuation screen is worse than an absent one.

- **2026-09-05 — Bug: the whole app rendered in Times New Roman.** `next/font` sets `--font-archivo` etc. via a class, and that class was on `<body>`. Tailwind v4 emits `@theme` tokens onto `:root`, and a `var()` inside a custom-property declaration resolves against the element that declares it — so `--font-display: var(--font-archivo), ...` resolved on `:root` against an undefined variable, producing an invalid `font-family` that silently fell back to the browser default. Nothing errored; it just looked wrong. Fixed by moving the font variable classes to `<html>`. Verified: `getComputedStyle` now reports `Archivo` and `IBM Plex Sans`.

- **2026-09-05 — Bug found while closing the offline gate: the app shell was never precached.** Serwist's Next preset does not put App Router HTML into `__SW_MANIFEST` (verified: 48 entries, zero `.html`). Two consequences, both caught by testing rather than reading:
  1. The document was only cached at runtime by `defaultCache`'s catch-all, which expires after `maxAgeSeconds: 86400`. A resident who last opened the app two days before landfall would have got the browser error page.
  2. Worse, runtime caching only happens once the worker already controls a navigation — which is never the first visit. Someone installing SalbaBayan *as* the storm arrives had every asset cached except the page that loads them.

  Fixed by adding `{ url: "/", revision: <build id> }` to `precacheEntries`, so the document is fetched during `install`, before the worker controls anything. The revision is derived from Next's build-stamped `_buildManifest` URL so the HTML invalidates in step with the hashed chunks it references — they must expire together, or the shell boots to a blank screen. Precache is now 49 entries. A NetworkFirst rule with a 30-day expiry stays ahead of `defaultCache` to cover the document routes added in later phases, which are not precached.

- **2026-09-05 — How the offline gate was tested.** Production build, **one** visit, then the server stopped outright (`curl` → `000`), then a full reload. Stopping the server is the stronger test: it proves the Service Worker is serving the shell, where airplane mode can be satisfied by ordinary HTTP cache. The single visit is what makes it realistic — it is the first-run case, not a warmed one. It does not exercise `navigator.onLine`, so the sync strip's `OFFLINE` branch still wants a real-device check.

- **2026-09-05 — Connectivity moved to `useSyncExternalStore`.** `AppRuntime` was copying `navigator.onLine` into state inside an effect, so the first paint always claimed "online" and corrected on a second render. `navigator.onLine` is browser-owned and can already be false before React hydrates. Subscribing reads the true value at render time and removes the cascading render ESLint flagged.

- **2026-09-05 — Bug caught by the RLS gate: unattributed writes become invisible to their author.** The first gate run failed on `can raise an SOS` with a 403. The insert itself was allowed; the failure was PostgREST's RETURNING clause, which needs SELECT on the new row. `read_rescue` is scoped to `requested_by = auth.uid() or is_staff()`, so an SOS written with a null owner inserted fine and then became unreadable to the person who raised it — silently breaking the pending/acknowledged/rescued display (FR-4.3). Fixed centrally with an `OWNER_COLUMN` map in `lib/offlineQueue.ts`, stamped on enqueue and again on flush (a write queued before the first session exists has no uid yet). Gate now 18/18.

- **2026-09-05 — Repo layout.** Next.js scaffolded at repository root; `stage-2/` remains alongside as submission documentation. Rationale: App Router reserves `app/`, so nesting the whole project under a top-level `app/` folder would be confusing. No PRD/design conflict.
- **2026-09-05 — Phase 0 sequencing.** Scaffold, Dexie offline queue, and Service Worker precache do not depend on Supabase, so they proceed while Q1/Q2 are open. Schema, RLS, and seed work is held until Q1 and Q2 are answered rather than guessed at.
- **2026-09-05 — Fonts self-hosted, not CDN.** The wireframes link Archivo and IBM Plex from the Google Fonts CDN. The app uses `next/font` instead, which self-hosts the files. Reason: a CDN link fails offline, and offline is the product. Visual output is identical. Deviation from `design/` in mechanism only, not appearance.
- **2026-09-05 — Package named `salbabayan`, project at repo root.** `create-next-app` refuses the folder name `BayanAlerto` (npm forbids capitals in package names), so the scaffold was built elsewhere and moved in, with `package.json.name` set to `salbabayan`. The local folder name is unchanged — renaming it would disturb the team's OneDrive path.
- **2026-09-05 — `severity rail` renders grey until a signal level loads.** Never a default colour. A rail that defaulted to green would read as "no storm" when the truth is "not yet known" — the same reasoning as `current_signal_level` being `not null default 0` rather than nullable.
- **2026-09-05 — Note, not a blocker: `node_modules` now sits inside a OneDrive-synced folder.** OneDrive will try to sync tens of thousands of files, which can slow installs and occasionally lock files mid-build. Excluding the folder in OneDrive settings avoids it.
