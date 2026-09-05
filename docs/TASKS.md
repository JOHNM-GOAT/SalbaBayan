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
- [x] Security advisors clean (0 findings) after moving RLS helpers to a `private` schema
- [x] Seed fixtures applied — 8 puroks, 33 protocols (7 deliberate gaps), 30 translations, 3 centres, 5 residents, Signal 3
- [x] Env wired (`.env.local`, template committed as `.env.example`)
- [x] RLS verified through the live REST API: no JWT returns `[]` for `protocols`
- [x] Anonymous sign-in enabled and verified — real auth.uid(), is_anonymous: true, authenticated role
- [x] Service Worker app-shell precache via Serwist — verified generating a manifest with 2 HTML, 25 JS, 2 CSS, 24 font files
- [x] **GATE (RLS): 18/18 pass** via `node scripts/rls-test.mjs` against the live REST API
- [ ] GATE (offline): airplane-mode reload boots the shell — needs a manual device/browser check

## Phase 1 — Advisory Core (7.1, 7.2)
- [ ] Signal x Purok table + coverage matrix
- [ ] current_signal_level join
- [ ] translations wiring (Tagalog/Cebuano/English + fallback)
- [ ] GATE: offline advisory correct + language switch, no reload

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

- **2026-09-05 — Bug caught by the RLS gate: unattributed writes become invisible to their author.** The first gate run failed on `can raise an SOS` with a 403. The insert itself was allowed; the failure was PostgREST's RETURNING clause, which needs SELECT on the new row. `read_rescue` is scoped to `requested_by = auth.uid() or is_staff()`, so an SOS written with a null owner inserted fine and then became unreadable to the person who raised it — silently breaking the pending/acknowledged/rescued display (FR-4.3). Fixed centrally with an `OWNER_COLUMN` map in `lib/offlineQueue.ts`, stamped on enqueue and again on flush (a write queued before the first session exists has no uid yet). Gate now 18/18.

- **2026-09-05 — Repo layout.** Next.js scaffolded at repository root; `stage-2/` remains alongside as submission documentation. Rationale: App Router reserves `app/`, so nesting the whole project under a top-level `app/` folder would be confusing. No PRD/design conflict.
- **2026-09-05 — Phase 0 sequencing.** Scaffold, Dexie offline queue, and Service Worker precache do not depend on Supabase, so they proceed while Q1/Q2 are open. Schema, RLS, and seed work is held until Q1 and Q2 are answered rather than guessed at.
- **2026-09-05 — Fonts self-hosted, not CDN.** The wireframes link Archivo and IBM Plex from the Google Fonts CDN. The app uses `next/font` instead, which self-hosts the files. Reason: a CDN link fails offline, and offline is the product. Visual output is identical. Deviation from `design/` in mechanism only, not appearance.
- **2026-09-05 — Package named `salbabayan`, project at repo root.** `create-next-app` refuses the folder name `BayanAlerto` (npm forbids capitals in package names), so the scaffold was built elsewhere and moved in, with `package.json.name` set to `salbabayan`. The local folder name is unchanged — renaming it would disturb the team's OneDrive path.
- **2026-09-05 — `severity rail` renders grey until a signal level loads.** Never a default colour. A rail that defaulted to green would read as "no storm" when the truth is "not yet known" — the same reasoning as `current_signal_level` being `not null default 0` rather than nullable.
- **2026-09-05 — Note, not a blocker: `node_modules` now sits inside a OneDrive-synced folder.** OneDrive will try to sync tens of thousands of files, which can slow installs and occasionally lock files mid-build. Excluding the folder in OneDrive settings avoids it.
