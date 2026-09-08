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
- [x] All write paths use the offline utility — enforced mechanically by `scripts/check-write-paths.mjs`, not by convention. Verified the guard actually fires by planting a violation.
- [x] Cache age / queue count visible on every screen — moved into `app/layout.tsx`, so a new route cannot ship without it
- [x] **Write acceptance no longer waits on the network.** Was 270ms offline (NFR-3.2 requires <200ms); now 7–16ms. See the decisions log — this was a structural fault, not tuning.
- [x] **Head-of-line blocking fixed.** A row that can never land no longer holds up every write behind it
- [x] Blocked writes surfaced separately from queued, in alarm colour, with `retry`/`discard`
- [x] Field diagnostics surface (`window.salbabayan`) — inspect and exercise the queue from a console
- [x] `npm run verify` — lint + write-path guard + build + RLS suite in one command
- [x] **GATE: passes.** Full results in the decisions log.

  | Property | Result |
  |---|---|
  | Shell boots offline, advisory correct | ✓ Purok 3 / Signal 3 / Barangay Gym |
  | Write accepted with no network | ✓ 7, 16, 15 ms |
  | Write durable before any network attempt | ✓ verified in raw IndexedDB |
  | Queue survives a full reload | ✓ rows intact and in order |
  | Delivery is exactly-once | ✓ 1 row each after partial flush + reload + repeat flushes |
  | Poison row cannot block the queue | ✓ valid row behind it delivered; poison blocked after 1 attempt |
  | Cache age + queue count visible offline | ✓ `OFFLINE · NAKA-CACHE NGAYON · 3 NAKA-QUEUE` |

## Phase 3 — SOS & Rescue Map (7.4)
- [x] One-tap GPS capture + queued write, no auth — GPS is warmed on screen open and never gates the tap
- [x] State machine + elapsed timer + responder identity — timer runs from the tap, online or off
- [x] Hold-to-cancel (`components/HoldToCancel.tsx`) — 1.8s sustained hold, aborts on release, cancel queues offline
- [x] Responder live map — MapLibre + OpenFreeMap **dark** style, Realtime, sorted by wait, oldest unassigned escalated
- [x] Rate limiting — 5 per device per hour, enforced in RLS
- [x] **GATE: passes.** SOS raised with the network failing; sat queued **122 seconds**; on reconnect the responder map showed **2m**. Arrival time would have shown **0m** for someone who had been waiting over two minutes — that difference is the whole gate.

  Not verified here: the hold-to-cancel *gesture*. It is driven by `requestAnimationFrame`, which browsers pause in a hidden tab, and the Browser pane cannot be un-hidden from this session. The queued-cancel path it triggers was verified through the acknowledge button instead (same code path, plain click). The gesture wants one manual check on a real screen.

## Phase 4 — Offline Evacuation Map (7.5)
- [x] Synthetic geography generated (`scripts/generate-synthetic-geo.mjs`, migration `0008`) — 8 Purok boundaries, 8 routes, centre + hazard coordinates
- [x] MapLibre GPS + boundary + route + destination, all from GeoJSON already on the device
- [x] Base map precached — `public/geo/streets.json`, the stand-in for a tile pack until real geography lands
- [x] Hazard overlay + path-blocked warning, with hazards carried in the advisory snapshot
- [x] Next-turn guidance and walking distance
- [x] **Geometry verified: 13/13** via `npm run check:geo` — distance, threshold behaviour, mid-segment detection, turn direction, degenerate input
- [!] **GATE (visual): NOT verified.** Cannot be checked from this session — see below.

  The map's *rendering* could not be confirmed here. `requestAnimationFrame` never fires in this environment (measured: **0 rAF callbacks in 3s** against 15 `setInterval` callbacks), and MapLibre both loads inline styles through `frameAsync` and drives its render loop from rAF. So the style never finishes loading and the canvas stays blank regardless of correctness. The same starvation is why the Phase 3 hold-to-cancel gesture could not be exercised either.
  What this means: the map wants **one manual check in a real browser** — open `/map`, confirm streets, boundary, route and hazard draw, then reload in airplane mode. Everything the render depends on has been verified by other means: the geometry by test, the data by query, and the offline availability by inspecting the precache.

## Phase 5 — Water-Level Reporting (7.6)
- [x] Body-referenced scale input — four figures with the water drawn at knee/waist/chest/above-head, no numeric entry anywhere
- [x] Open to any signed-in resident; every report timestamped with the **observation** time and attributable via `reported_by`
- [x] Goes through the offline queue like every other write; reporter sees their own report immediately, online or off
- [x] Realtime list, no polling
- [x] **GATE: passes.** Measured end to end:

  | Leg | Measured | How |
  |---|---|---|
  | Tap → row on server | **387 ms** | external Node poller at 100ms |
  | Insert → Realtime event | **935 ms** | supabase-js subscriber in Node |
  | Tap → second browser tab updates | **1,038 ms** | first in-browser run, before the pane throttled |

  Later in-browser repeats measured 7.9s and 10.5s. Those are the hidden browser pane starving render scheduling — the same environment limit that kills `requestAnimationFrame` (see Phase 4). The transport itself was re-measured outside the browser at 935ms, and the write at 387ms, so the criterion is met by ~1.3s of real latency. Worth one confirmation on two real devices alongside the Phase 3 and 4 manual checks.

## Phase 6 — Hazard Reports (7.7)
- [x] Category picker, unified with the water form — one screen, because a resident does not know which table their sighting belongs in
- [x] Optional photo, no moderation queue
- [x] Resolve — offered to everyone, decided by RLS
- [x] Realtime push (INSERT *and* UPDATE, so a resolve disappears as promptly as a report appears)
- [x] **Photo fail-safe** — separate Dexie store, uploaded independently of the row, then the row is patched. Verified end to end: 845-byte JPEG reached Storage at `{uid}/{hazardId}`, `photo_url` patched through the queue, and rendered back through a signed URL at its true 80×60.
- [x] `insert_hazards` tightened — see the decisions log; it had the same `reported_by IS NULL` hole `0007` closed for SOS
- [x] **GATE: passes, measured on a genuinely independent client — 652ms**, against a 5s criterion (`npm run check:realtime`).

  Recorded because the first attempt was wrong: two browser tabs share an origin and therefore share IndexedDB, so the "second device" was reading the reporter's local write queue with nothing crossing the network. The measurement above uses two separate Supabase clients with their own sessions and websockets.

  Not separately re-verified here: the offline-hold-then-release half. The hazard row was observed queuing offline (`stillQueued: ["downed_lines"]`), but the browser-side network block proved unreliable in this session — supabase-js captures its `fetch` at client construction, so an override applied afterwards is bypassed. The queue's hold-and-release behaviour was verified against raw IndexedDB in Phase 2 and hazards use that identical queue.

## Phase 7 — Headcount Tracking (7.8)
- [x] Append-only ledger, count is `SUM(delta)` — no stored total, so no race to lose
- [x] Bulk entry (`+2..+6`) — a family arriving together is one entry, not five taps
- [x] Capacity warning at 75%, and a distinct full state
- [x] Vulnerability breakdown from check-ins — verified live at **2 medical / 2 elderly / 1 infant**, matching the seeded residents exactly
- [x] `insert_headcounts` and `insert_checkins` tightened — third and fourth instances of the attribution pattern; the class is now closed across every owner-bearing table
- [x] Ledger arithmetic tested: **13/13** (`npm run check:headcount`)
- [x] **GATE: passes, 5 runs out of 5.** Two simultaneous `+1` inserts from two clients with separate anonymous sessions: total moved by exactly 2 each time, from 2 distinct recorders, no insert failures (`node scripts/headcount-concurrency.mjs`).

  The gate is two-phase because `insert_headcounts` requires staff and roles are granted by an official: `--enrol` prints the uids to grant, `--run` fires the concurrent taps. Both clients are genuinely separate — the Phase 6 lesson about two browser tabs sharing IndexedDB applies here too, and a sequential pair would have passed against a stored counter and proved nothing.

## Phase 8 — QR Check-In (7.9)
- [x] `jsqr` camera scan, with a repeat guard so one card held to the lens files one check-in rather than a dozen
- [x] Vulnerability tags surfaced on lookup, priority-flagged
- [x] Status logging — checked-in / evacuated / needs-help, through the write queue
- [x] Manual entry — present at all times, not revealed only on failure
- [x] Camera failures distinguish *why*: permission denied, needs HTTPS, or no camera. Verified live — the pane blocks the camera, and the screen said "WALAY TUGOT SA CAMERA — GAMITA ANG MANUAL" rather than showing a black rectangle.
- [x] Token handling tested: **18/18** (`npm run check:checkin`)
- [x] **GATE: passes.** Typed `sb0142` and scanned-form `SB-0142` produced **byte-identical** resident cards — `MARIA SANTOS · PUROK 3 · SB-0142 · PRAYORIDAD · MEDICAL · TIGULANG` — and the logged check-in landed attributed (`scanned_by` set).

  Satisfied by construction rather than by comparison: the scanner emits a string and the text box emits a string, and from `normaliseToken` onward there is one path. There is no separate "scan flow" that could drift from the manual one.

## Phase 9 — Pre-Storm Readiness & Knowledge Base (5.2 F4, 5.6 F13)
- [x] `expected_households` baseline added and seeded to 48 (migration 0011). FR-4.3 compares registered residents against expected population, which needs a denominator; without one the check reports `unknown` rather than inventing a percentage.
- [x] **F4 dashboard at `/readiness`** — protocols configured (FR-4.1), translations complete, volunteers assigned (FR-4.2), residents registered vs expected (FR-4.3), evacuation centres located. Every number is aggregated from the rows the app already runs on, so there is no readiness state anyone has to remember to update.
- [x] Gaps are actionable (FR-4.5) — an unmet check links to where it is fixed: `/coverage` for the protocol grid, `/map` for centres with no coordinates.
- [x] `scripts/ingest-docs.mjs` reads every `docs/*.md`, extracts title + content, upserts keyed by filename (FR-13.1; FR-13.2 idempotent by primary key, not by convention).
- [x] `docs/RUNBOOK.md` written for barangay staff — not for developers — and ingested. It is the document the knowledge base exists for; the rest is project record.
- [x] Official-only document list on the same screen (FR-13.3). A non-official sees "Officials only", not an error and not an empty list that reads as a bug.
- [x] Readiness logic tested: **18/18** (`npm run check:readiness`), now part of `npm run verify`.
- [x] **GATE: passes, with one caveat recorded below.** Every figure was checked against the database directly rather than read off the screen: protocols 33/40, translations 8/10 (the two deliberately untranslated Signal-5 keys), residents 5/48, centres 3/3, and the volunteer roster correctly refusing to answer for a non-official viewer, then answering `1/2` once the viewer became one.
- [x] **FR-13.3 verified from both sides.** As a non-official the list reads "Officials only"; as an official the runbook renders in full — 3,128 characters, matching `length(content)` in the database exactly.

  The remaining caveat, stated rather than glossed: the map's **offline rendering is still visually unverified**. `requestAnimationFrame` never fires in this session's browser pane, so no map has been seen to draw here. It needs a real device.

- [ ] **Not done — FR-4.4 "app cached on N devices".** Not computable: nothing records per-device install or cache state, and there is no telemetry to derive it from. Inventing a number on a readiness dashboard would be worse than omitting the row, so it is omitted and flagged. Adding it means a device-level heartbeat, which is a privacy decision for the team, not an implementation detail.

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

**Q3 — RESOLVED: MapLibre, not Google Maps.** The responder map originally specified the Google Maps JS API. Google's free tier is genuinely sufficient at this scale (Maps JavaScript API is an Essentials SKU — 10,000 free map loads/month since the March 2025 pricing change, against a demo that might use 200), but it requires a **billing account with a real payment card** even to use the free tier, which a student team should not have to set up for a practice demo.

  More importantly it was never the right dependency. The PRD already committed to MapLibre for the resident map, so the project was carrying two map stacks so that one screen could use a proprietary one. Switching the responder map to MapLibre gives one library, no key, no billing, no quota, and removes the only non-open-source piece in the stack.

  **Split by connectivity, deliberately:**
  - **Responder map (Phase 3)** — MapLibre + the **OpenFreeMap** public instance. No key, no account, so it can be built immediately. The barangay hall has mains power and a wired connection; this view is not required to work offline (already stated in PRD §17).
  - **Resident map (Phase 4)** — MapLibre + a **PMTiles** extract. One static file per barangay, read directly by the browser over HTTP range requests and cached by the Service Worker. That *is* the "pre-downloaded tile pack" FR-11.2 asks for, so it closes Q4's tile-source half too. Still needs real geography for the extract.

  **What was given up:** turn-by-turn directions, live traffic, and Places search. None are in scope — the resident route is official-authored GeoJSON (Q6) and the responder view is pins sorted by wait time, not navigation. If routing is ever needed, OSRM and Valhalla are the open equivalents.

  **Licence condition, not a style choice:** all of these are OpenStreetMap-derived and require visible attribution. MapLibre renders it automatically; it must not be removed.

**Q4 — Real geography, or keep the fictional pilot?** PRD-detailed Q1 records the pilot barangay as unconfirmed. The wireframes use fictional "Barangay San Isidro" with hand-drawn SVG streets. Phase 4 needs (a) a real barangay's coordinates and Purok boundary polygons, and (b) a vector tile source/style for the offline packs (self-hosted PMTiles? MapTiler? OpenFreeMap?). Until resolved, Phase 4 can only be built against synthetic GeoJSON.

**Q5 — RESOLVED. All seven missing screens designed.** `stage-2/design/` now holds fifteen artboards. Rendered PNGs, canvas entries and README sections are in place for each:

| Gap | Screen | Note |
|---|---|---|
| Resident onboarding | `Onboarding.dc.html` | Language then Purok, one screen, no account |
| ~~Volunteer/official sign-in~~ | `DeviceRole.dc.html` | **Substituted — see below** |
| Full reports feed | `ReportsFeed.dc.html` | Filters, resolved state, queued reports shown inline |
| Evacuation centre directory | `Centers.dc.html` | Assigned centre pinned; closed centre; overflow guidance |
| Profile / "Ako" tab | `Profile.dc.html` | Check-in status as headline, QR at full size, household |
| Readiness checklist | `Readiness.dc.html` | Progress counted against the leave-by deadline |
| Knowledge base | `Guide.dc.html` | Signal-level table pinned first, everything precached |

  **The sign-in screen was deliberately not designed.** That item predates the resolution of Q2. The app uses anonymous auth and never shows a login, so drawing a login form would contradict both the architecture and the team's own "no login-access" requirement. The underlying need is real and was unmet, though: a volunteer has to *become* one. `DeviceRole.dc.html` answers that instead — it shows the device code a person reads out, what each role can do, and how elevation actually happens. Flagging rather than silently drawing the wrong screen.

**Q6 — Route geometry authoring.** PRD §10 says Purok boundaries and `route_geojson` are "entered by officials during protocol setup," but the protocol-admin artboard shows only a *rendered preview* of a route, never an editor for drawing one. Is drawing in-app, or is GeoJSON imported from a file the LGU supplies?

---

## Notes / decisions log

- **2026-09-08 — The staff home screens were repeating their own tab bar.** The volunteer home offered SCAN, BILANG, ULAT, MAPA and SAKLOLO as a grid of five near-identical outlined buttons, three of which were already tabs two centimetres below. The official home did the same with RESCUE. It read as a wall of buttons and taught nothing: a person cannot tell which of two identical routes to the same screen is the intended one.

  Each home now offers only what its tab bar cannot reach — REPORT and MAP for the volunteer, BILANG and MAP for the official. The official's readiness and coverage cards stay, because those carry NUMBERS rather than being navigation wearing a button's clothes.

  The deletion had to pay for itself first: the SAKLOLO button was the only thing carrying the rescue waiting count, so removing it would have removed the feature. The count moved onto the raised tab instead, which is strictly better — a volunteer scanning cards at the door now learns someone is waiting without navigating home to ask. `RescueLink` is gone, replaced by `useRescueWaiting` feeding a badge in `BottomNav`.

- **2026-09-08 — The tab badge keeps the three states, in the space a tab has.** A number in alarm colour when people are waiting; **nothing** when the count is known to be zero, which is an all-clear this device actually earned; and a hollow caution dot when the count cannot be stated — offline, or not permitted. The dot exists because a tab has no room for "count unavailable" and silence would otherwise mean two different things. The full sentence lives in the tab's accessible name and on the responder screen. Verified live: badge read **1**, matching `count(*) where status in ('pending','acknowledged')` exactly, with `aria-label="RESCUE — 1 waiting for rescue"`.

- **2026-09-08 — Note for demos: the browser pane mints a new anonymous uid every time its site data is cleared.** Three times this session a granted role silently stopped applying because the device it was granted to no longer existed. Nothing is wrong with the app — a fresh anonymous identity genuinely has no role — but it makes staff-only behaviour look broken while testing. The volunteer row is re-pointed rather than duplicated each time, so the roster stays at one official and one volunteer. Real phones keep their identity and do not have this problem.

- **2026-09-07 — A volunteer could always READ the rescue queue; nothing in their navigation went there.** `read_rescue` is `requested_by = auth.uid() OR private.is_staff()`, and `is_staff()` is `role in ('volunteer','official')` — so permission was never the problem. But `/responder` sat in no volunteer tab bar, reachable only from a small button on their home. The runbook tells volunteers that rescue requests arrive on that screen and that acknowledging one is what shows the resident they have been seen; their primary navigation had no route to it and no indication anyone was waiting.

  Rescue is now the volunteer's raised centre tab, and check-in moved to a normal slot: someone in the water outranks the next card to scan. The map left the tab bar to make room and kept a place in the home quick actions, so nothing became unreachable. Still cyan, not alarm red — the rule is that red marks a control which RAISES an alarm, and that remains the resident's SOS alone.

  Deliberately NOT done: plotting rescue pins on the evacuation map. That map's whole value is working with the connection gone, and mixing live-only data into it would make an empty map ambiguous between "nobody needs help" and "you are offline". The responder screen keeps that distinction and says which it is.

- **2026-09-07 — The waiting count refuses to show a number it cannot stand behind.** `RescueLink` renders three states, and two of them are the failure this project has already shipped twice: RLS returns zero rows to a resident rather than an error, and an offline device holds a count that is no longer current. Either would otherwise render as a confident "0" on a control meaning *someone needs rescuing* — the worst possible place for a false all-clear. So a number appears only when the viewer is staff AND online; anything else is `—` with "Count unavailable — offline, or not permitted. It does not mean nobody is waiting."

  All three states verified live rather than reasoned about: role-less device → no badge at all; volunteer online → **6**, matching `select count(*) ... where status in ('pending','acknowledged')` exactly; `navigator.onLine` forced false → `—` plus the explanation, not the stale 6.

- **2026-09-07 — The roster has both roles again.** The barangay had an official (`4cd758f8`) and no volunteer, so no device could exercise the volunteer-only paths at all. The current demo device (`7dcaa79e`) is now `volunteer`. Side effect worth knowing: the readiness dashboard counts every `user_roles` row under "volunteers assigned", so it now reads 2/2 and turns green even though one of the two is an official. The check is doing what it says on the tin — staff assigned — but the label is looser than the number.

- **2026-09-07 — Runtime error on the evacuation map: "Style is not done loading."** `ready` is React state mirroring a mutable MapLibre object, and the two drift the moment the build effect runs twice — which React's development double-invoke does by design: map A is built, its `load` sets `ready` true, the cleanup removes map A, map B is built, and `ready` is still true from A. The paint effect then called `addSource` on a style that had not loaded and MapLibre threw, taking the whole screen rather than one layer.

  Fixed by resetting `ready` per instance — on create and in the cleanup — so the flag can never outlive the map it describes, and by additionally asking `m.isStyleLoaded()` in both consumer effects. The second guard is the important one in principle: `ready` is a snapshot of a mutable object, `isStyleLoaded()` is the object itself, and only the object can answer authoritatively.

  Notable that this error was *unreachable* until today. The style never finished loading while rAF was starved, so the race could not occur — the map was simply blank. Fixing the environment assumption did not introduce the bug, it exposed one that had been sitting behind a blank rectangle.

- **2026-09-07 — Phase 4 visual gate: CLOSED.** `/map` renders. Verified on screen rather than inferred: `isStyleLoaded()` true, 9 layers and 5 sources present, canvas non-zero, and `queryRenderedFeatures()` returning **36 painted features** — actual geometry on the canvas, not merely declared layers. Visible: the street grid, the dashed Purok boundary, the orange route with its turn, the destination and hazard dots, the legend, "Turn right at the corner · 150 m" and "BARANGAY GYM · 600 M · 8 MIN WALK".

  **Still open:** the *offline* half of that gate. This was a dev-server run with no Service Worker, so it proves the layers draw, not that they draw with the connection gone. That needs a production build, one visit, then a reload with the network down — the same method used for the Phase 0 and Phase 1 offline gates.

- **2026-09-07 — Console-noise methodology: distinguish stale HMR entries from live errors with a sentinel.** After the map fix the console still showed `usePathname is not defined`, `queuedInserts is not defined` and the original `Style is not done loading`. All three were buffered from the seconds when a file had been half-edited (body patched, import not yet added) — hot reload had executed a broken intermediate. Logging a sentinel and reloading showed **no errors after it**, and the SOS screen rendering proved `queuedInserts` resolves at runtime. Recorded because a retained console buffer reads exactly like a live fault and would otherwise have sent someone chasing three phantom bugs.

- **2026-09-07 — Reported from a real device: "bitawan para itigil" never stopped anything, it just repeated. TWO bugs, stacked.**

  **1. The hold could never complete.** The SOS screen runs a one-second interval for the elapsed timer, so it re-renders every second and hands `HoldToCancel` a fresh `onCancel` identity each time. That identity was in the effect's dependency array, and the effect was also where the clock started — so every second the effect tore down, re-ran, and reset `startedAt`. A 1.8s hold interrupted every 1.0s cannot finish: the bar filled to roughly half, snapped back, and started again for as long as the thumb was down. Fixed by holding `onCancel` in a ref so it is not a dependency, and stamping `startedAt` at pointer-down. A ref rather than asking callers for `useCallback`, deliberately — a control whose correctness depends on every caller remembering to memoise a prop will break again the next time somebody uses it.

  **2. Even when it completed, the SOS came back.** `queuedRequests` turned EVERY queued row for `rescue_requests` into a request with `status: "pending"` hard coded and `ts` set to the moment it was queued — including queued *updates*. Cancelling enqueues an update, so the cancel materialised as a brand-new pending request dated now, under the synthetic `<uuid>:update` key that id-based de-duplication could not collapse. Reproduced exactly: the old merge returns two requests, the phantom one sorted first, which is the one the screen picks as active. Observed on screen as an SOS clearing and instantly returning at 00:07. Offline, where the queue cannot drain, it would never have stopped.

  Fixed by extracting `lib/rescueMerge.ts`: a queued INSERT is a request that exists only locally; a queued UPDATE is a newer local intent about a request that already exists, applied as a patch and never materialised. Queued patches deliberately win over the server row they target, so a cancel made offline reads as cancelled while the server still says pending — anything else shows a resident their own action being ignored. 15 assertions in `npm run check:rescue`, and the test was checked against the OLD implementation to confirm it actually fails there.

  Verified end to end on the live screen now that rAF works: raised, held 2.1s, progress climbed monotonically through the 1.0s mark (54.8%% → 65.9%% → 99.2%%) where it used to reset, the request cancelled in the database, and the screen stayed idle instead of the SOS returning.

- **2026-09-07 — Correction: `requestAnimationFrame` DOES work in this browser pane.** Phases 3 and 4 both recorded the hold-to-cancel gesture and the map's rendering as unverifiable here, citing a measurement of 0 rAF callbacks in 3s. Re-measured: **122 callbacks in 2s (~61fps)**. The original measurement was taken while the pane was hidden, where browsers correctly pause rAF — the conclusion "rAF never fires in this environment" generalised a property of that moment into a property of the tool, and it then sat in the tracker as a standing excuse for two unverified gates. The hold-to-cancel gesture is now verified above; **the Phase 4 map rendering gate should be re-attempted rather than left open on this basis.**

- **2026-09-06 — Three actors, three homes, one tab bar each.** The PRD names Resident, Volunteer and Official as distinct people doing distinct jobs (§4), but every one of them landed on the same screen with all seven destinations in a single row. That row made a resident scan past COVERAGE and RESPONDER to find the thing they opened the app for. Each actor now has a home (`/`, `/volunteer`, `/official`) and a five-item tab bar holding only their own work, ported from `stage-2/design/artboards/Main.dc.html` rather than re-invented — 74px tall, items top-aligned with 9px of padding, centre control lifted 19px out of the bar. `/profile` ("Ako") is new and shared by all three.

  The colour rule survived the port intact: alarm red appears on exactly one control in the product, the resident's SOS, because it is the only one that raises an alarm. The volunteer's centre control is SCAN and the official's is RESCUE, both high-vis cyan — frequent, not urgent. `scripts/actors-test.mjs` asserts that, along with the thing types cannot catch: every tab href resolves to a real `page.tsx` AND appears in `SHELL_ROUTES`, so a tab cannot point at a route the Service Worker never precached. A dead tab during a storm is the failure this guards. 51 assertions.

- **2026-09-06 — The actor switcher is a view, never a permission, and says so on itself.** Walking a barangay through all three roles otherwise needs three phones and three role grants. The control is labelled DEMO permanently, and the claim is enforced rather than asserted: selecting OFFICIAL on a resident's device shows the official's tab bar and then, correctly, `—` on both roster checks with "Only an official can see this count" and "Officials only" for the documents. Verified on screen exactly that way. RLS is the boundary and it does not move, which is what makes free switching safe to ship rather than something to strip before a demo.

  `/profile` deliberately shows the **granted** role, not the selected actor, and warns when they disagree — it is the one screen where that distinction is the point rather than an implementation detail.

- **2026-09-06 — Fixed while building on it: `getMyRole` silently demoted every official to resident.** It selected from `user_roles` with no `user_id` filter and called `.maybeSingle()`, but `read_own_role` is `user_id = auth.uid() OR is_official()` — so an official reads the whole table, and PostgREST answers `.maybeSingle()` with 406 PGRST116 the moment more than one row matches (confirmed live: `"The result contains 8 rows"`). The error path returns "resident". It worked only because the table held exactly one row, and the readiness dashboard's own advice — assign a second volunteer — was the trigger that would have broken it, hiding staff controls on `/checkin` and `/headcount` for every official.

  Worth recording as a miss, not just a fix: the same RLS-returns-what-you-may-see trap was diagnosed and fixed in the readiness counts a day earlier, and `getMyRole` — the function then used to decide whether those counts were knowable — had it too and was not checked.

- **2026-09-06 — Shell width follows the ACTOR, not the route, and the grids follow the container.** Route-based widths meant an official moving HOME → READY → GRID watched the column jump between 34rem and 76rem — and since the header and tab bar align to that column, the navigation resized under their finger between taps. Width is now a property of who is using the app: official on a laptop gets 76rem everywhere, resident and volunteer keep the centred phone column.

  That change made viewport breakpoints actively wrong. `lg:grid-cols-[1.4fr_1fr]` fires on window width, so a resident on a 1440px laptop would have got the responder's map and queue side by side inside a 544px column — the squashed layout those rules existed to prevent. Every such rule is now a container query against the shell (`@container` + `@2xl:` / `@4xl:`), so a two-column grid appears when there are two columns' worth of room. Measured both ways: resident at 1440px renders one column of 516px, official renders two of 590px, and the tab bar holds 544px and 1216px respectively across every tab.

- **2026-09-06 — Responsive: a centred column, not a stretched one.** Every screen was designed at phone width and rendered full-bleed, so on a 1440px laptop the responder screen had a 1,400px-wide Acknowledge button and a wordmark stranded a screen away from its content. The fix is deliberately not "make everything fluid": stretching a 44px control to 1,400px does not make it easier to hit, it just destroys the line lengths and the thumb-zone geometry the controls depend on. Content is held to a centred 34rem column instead.

  Width is only taken where it is used. PRD §4 puts the official "at a laptop at the barangay hall", so `/responder`, `/coverage` and `/readiness` opt into a 76rem shell and genuinely rearrange — the rescue queue sits beside its map with the map pinned while the queue scrolls, readiness pairs its checks into two columns, and the coverage matrix stops scrolling sideways. `/map` is wide on any device because a map is worth every pixel it is given. Deliberately NOT wide: `/headcount` and `/checkin`, which are operated by a volunteer standing at an evacuation centre holding a phone — the +1/-1 controls and the camera framing *are* the design.

  The chrome bars stay full-bleed while their contents align to the same column. The severity rail in particular must not stop at 34rem: it is the ambient across-the-room indicator, and a rail that ends two-thirds of the way across a laptop screen stops doing that job.

  Risk that needed checking rather than assuming: the evacuation map sizes itself through an unbroken flex chain from `min-h-dvh` down to its container, and a single `height: auto` anywhere in it collapses the map to zero — a bug this project has already had once. `Shell` is therefore `flex flex-1 flex-col`. Verified after the change: the map container measures 1186x647, not 0.

- **2026-09-06 — The home nav was already too narrow on a phone, before any of this.** Seven destinations in one flex row gave each about 45px on a 393px handset — under the 44px minimum target once the gaps are counted, and far under what the tracked 10px labels need, so they truncated. It read as a desktop problem but was a phone problem. Now a grid: three across on a handset, four on a tablet, seven on a laptop. Measured zero horizontal overflow at 360px across every route.

- **2026-09-06 — Pinch-zoom is still disabled (`maximumScale: 1`), and that is worth revisiting.** It is a deliberate documented choice — the app is a field instrument whose fixed thumb-zone layout zooming breaks — but it fails WCAG 1.4.4, and the people most likely to need to magnify text are the elderly residents this product explicitly serves. Not changed here because it is a product decision rather than a responsive-layout one, but flagged rather than left silent.

- **2026-09-06 — Phase 9 bug: the readiness dashboard reported the viewer's permissions as the barangay's readiness.** Two of the five checks count RLS-scoped tables, and RLS returns *zero rows*, not an error, to a viewer who may not read them. `read_own_role` shows you only your own row unless you are an official; `read_residents` is staff-only (NFR-4.3). So a resident opening `/readiness` saw **0/2 volunteers** and **0/48 residents**, both in alarm red, for a barangay that has one volunteer and five registered residents — and a volunteer saw **1/2 volunteers**, which is just their own row counted back to them, and would still have read `1` with fifty volunteers on the roster.

  Measured, not inferred: a freshly minted role-less session was asked for both counts over REST and got `0` and `0`. The wrong-way-round failure of the module's own stated principle — it was written to never show green for something it had not checked, and was showing red for something it was not allowed to look at. Before a storm that is the more damaging direction: a dashboard that cries wolf gets ignored, and the one time it is right, it is ignored too.

  Fixed by carrying knowability alongside each count (`staffCountKnown`, `residentCountKnown`) and reporting `unknown` with an explanation — "Only an official can see this count" — instead of a verdict. `scripts/readiness-test.mjs` now pins the invariant in both directions: a hidden roster is `unknown`, an empty roster the viewer *can* read is still `missing`. Suppressing the false alarm must not suppress the true one.

- **2026-09-06 — F4 is a configuration dashboard, not the household go-bag checklist designed in Q5.** `stage-2/design/Readiness.dc.html` shows a resident ticking off water, radio and documents against the leave-by countdown. The PRD's F4 is a different thing entirely — protocols configured, volunteers assigned, residents registered, gaps actionable — an *official* asking whether the barangay is ready, not a household. Built to the PRD and flagging the divergence rather than quietly building one and calling it the other. The designed screen is not wasted: the household checklist is a real feature, it is simply not F4, and it has no requirement behind it yet.

  F13 divides the same way. The `Guide.dc.html` artboard is a resident-facing signal-level guide; FR-13.1–13.3 describe ingesting this repository's own `/docs/*.md` into `documents` for reference during an event. Built as specified.

- **2026-09-06 — RESOLVED: the barangay had zero officials, so the knowledge base had no audience.** The only `user_roles` row was a **volunteer**. FR-13.3 says admin-only and the policy implements that correctly, which meant nobody could read the runbook in the app — including the person at the barangay hall it was written for. A configuration gap rather than a code one, but the kind only ever discovered during the event it matters in.

  Granted `official` to the demo device (`4cd758f8…`) rather than adding a second row: `user_id` is the primary key, so one identity holds one role, and this was the only identity attached to a device. `official` implies `is_staff()`, so nothing that worked for the volunteer stopped working — headcount and check-in are unaffected. The trade is that there is now no volunteer to demonstrate the volunteer-vs-official distinction with; adding one means a second device's code (see `docs/RUNBOOK.md`), and reverting is a one-line `update`.

  That also closed the verification gap. **FR-13.3 is now proven from both sides**: "Officials only" as a non-official, and the full runbook as an official — 3,128 characters, matching `length(content)` exactly. It simultaneously exercised the *other* branch of the readiness fix: the volunteer check flipped from `—` to a real `1/2` the moment the viewer was permitted to count, confirming that suppressing the false alarm did not suppress the true verdict.

- **2026-09-06 — Environment limitation: synthetic clicks in this browser pane do not reach React handlers.** Expanding the runbook by clicking the document row left `aria-expanded="false"` through three attempts, at correct coordinates, on a 44px target with nothing overlaying it (`elementFromPoint` returned the button's own child). A programmatic `element.click()` toggled it immediately and rendered all 3,128 characters. So the behaviour is verified and the *gesture* is not — the same class of limitation as `requestAnimationFrame` never firing and the camera being blocked. Recorded because a click that silently does nothing looks exactly like a broken handler, and it is worth knowing which of the two this pane produces.

- **2026-09-06 — Test methodology: a Service Worker from an earlier production build was silently serving stale code on `localhost:3000`.** The readiness fix was verified as *not working* — the page kept rendering the old numbers through a full navigation while the dev server logged recompiles. Dev disables Serwist, so nothing registers a worker; but a worker registered by a previous `npm run build && next start` on the same origin **survives**, keeps controlling the page, and serves its precached chunks to the dev server's HTML. Unregistering it and clearing `caches` made the change appear immediately.

  Worth recording because the failure looks exactly like a bug in the code under test, and because the same origin is used for both. Any dev-mode verification after a production build on this port needs the worker cleared first, or it is testing the previous build.

- **2026-09-06 — The database cannot be rebuilt from this repository.** `supabase/migrations/` holds the eleven schema migrations, but every translation seed (`sos_translations`, `map_translations`, `readiness_translations`, and now `readiness_not_permitted_translations`) was applied straight to the remote project with no local file. The remote list has 43 migrations; the repo has 11. A fresh Supabase project checked out from this repo would come up with the schema and no UI strings — the app would render bare message keys on every screen. Not fixed here because it is not Phase 9 work, but it should be, before anyone tries to stand up a second environment.

- **2026-09-06 — The service-role key is never stored.** `ingest-docs.mjs` reads `SUPABASE_SERVICE_ROLE_KEY` from the environment before `.env.local`, so it can be supplied for one run and never written to disk. Ingest is an administrative act — documents are official-only to write — and that key bypasses RLS entirely, so it must never be committed and must never reach the browser. `RUNBOOK.md` was ingested via a privileged migration instead, for the same reason.

- **2026-09-06 — Phase 8: the manual fallback is a peer of the camera, not a rescue path.** The §7.9 criterion says a typed token must produce the same result as a scanned one, and the way to get that is to have nothing to compare: the scanner emits a string, the text box emits a string, and from `normaliseToken` onward there is exactly one path. The text box is also on screen at all times rather than appearing after a failure — a volunteer whose camera is failing in the rain should not have to discover that an alternative exists.

- **2026-09-06 — Token normalisation forgives separators but not shape.** A card reads `SB-0142`, and a volunteer at 2am may type `sb0142`, `sb 0142` or `SB_0142` — all of which mean the card in their hand, and all of which would otherwise miss. So punctuation and case are stripped and the printed shape re-formed. What is deliberately NOT forgiven is length or characters: `SB-0143` reshapes to `SB-0143` and still fails to match, because coercing a typo into a neighbouring token would record **the wrong person as safe**. Both halves are tested — five accepted spellings and four rejected near-misses.

- **2026-09-06 — The scanner debounces repeats, and this is a data-integrity guard rather than a UI nicety.** A camera decodes the same card many times a second. Without the two-second guard, one card held to the lens files a dozen check-ins, and the roll — the record used to decide who is unaccounted for after a storm — fills with duplicates of the people who did arrive.

- **2026-09-06 — Camera failures say which failure.** Permission denied, insecure origin and no-camera-present are three different problems with three different remedies, and a scanner that renders a black rectangle for all of them just gets cards held up to it repeatedly. Confirmed live in this session: the browser pane blocks camera access, and the screen correctly reported denial and pointed at manual entry.

- **2026-09-06 — Two more modules split for testability, on the same principle as `ledger.ts`.** `token.ts` and `ledger.ts` hold the pure decisions — does this input mean that person, is this centre full — with no imports, so they run under Node's native TypeScript stripping with no bundler. The I/O modules re-export them so callers still have one import site. The rule that forced it is worth remembering: a test can only import a `.ts` file directly if that file's own imports resolve, so anything reaching `./offlineQueue` is untestable this way.

- **2026-09-06 — The attribution pattern is now closed in all four tables that had it.** `insert_rescue` (0007), `insert_hazards` (0009), and now `insert_headcounts` and `insert_checkins` (0010). Every one permitted a row with no owner, and in every case the consequence was different but never cosmetic: an SOS invisible to its sender, a hazard its reporter could never resolve, and — worst here — a ledger entry attributed to nobody. The headcount screen tells a volunteer the ledger is append-only and cannot be erased, which is precisely why a count assembled by several people in a crowded hall can be trusted; an unattributable entry removes that accountability while still looking like a complete audit trail. The general rule, learned four times: **a column that records who did something must be required, not merely permitted.**

- **2026-09-06 — The count is never stored, and that is the whole feature.** A `count` column incremented per tap fails in exactly the conditions this app exists for: two volunteers at one door, both reading 68, both writing 69 — one person gone from a building that may be flooding, with no error anywhere and nothing noticed until a post-storm roll call. `SUM(delta)` over an append-only ledger has no shared value to overwrite, so there is no race. It also makes corrections honest: a mistake is fixed by appending its opposite, never by editing history.

- **2026-09-06 — A sequential test would have proved nothing.** Two `+1`s one after another pass against a stored counter too. The gate fires both inserts in flight together, from two clients with separate sessions, and checks that the total moved by exactly 2 *and* that two distinct recorders appear. Run five times rather than once, because a concurrency test that passes once has only shown that one interleaving works.

- **2026-09-06 — The ledger may legitimately go negative, and is not clamped.** Corrections can outrun entries at a shift change. Clamping to zero would hide a reconciliation error behind a plausible-looking number; showing `-3` makes it visible that something needs fixing. Covered by `check:headcount`.

- **2026-09-06 — The vulnerability breakdown cannot come from the ledger, by design.** A `+1` is deliberately anonymous: a volunteer counting people through a door has no time to ask each one who they are. The breakdown is derived from `checkins` joined to `residents.vulnerability_tags` — Phase 8's data — and is staff-only by RLS, matching §9's treatment of those tags as the most sensitive field in the system. Four check-in fixtures were seeded in `0010` so the panel demonstrates something true rather than three zeros that look like a broken query.

- **2026-09-06 — Two test-harness bugs of my own, both worth noting for the same reason.** A capacity assertion used 112/150 as "75% or more" when 75% of 150 is 112.5, and the Phase 4 geometry test offset a hazard along its route instead of perpendicular to it. Both failed for their own arithmetic rather than the code's. When a new test fails first time, check the test before the implementation.

- **2026-09-06 — `process.exit()` in the TypeScript tests tripped a libuv assertion on Windows.** Calling it races Node's native type-stripping loader as it tears down, and the run failed *after* printing 13/13. Both tests now set `process.exitCode` and let Node exit on its own.

- **2026-09-06 — Phase 6: two browser tabs are not two devices, and an earlier version of this gate proved nothing because of it.** Tabs share an origin, so they share IndexedDB, localStorage and the Service Worker cache. The "observer" tab was showing the reporter's report by reading the reporter's *local write queue* — no server, no websocket, nothing across the network. It looked like a pass. `scripts/realtime-latency.mjs` replaces it with two separate Supabase clients, each with its own anonymous session and its own socket: **652ms**, against a 5s criterion.

- **2026-09-06 — The browser-side network block is not reliable, and that matters for how these gates are read.** `supabase-js` captures `globalThis.fetch` when the client is constructed, so an override applied after the app has booted is simply bypassed — writes go through while `navigator.onLine` reports false and the UI honestly says "queued". Two Phase 6 runs were invalidated by this before it was spotted; the tell was a row reaching Postgres while the queue was supposedly held. Where an offline claim matters, verify it against raw IndexedDB (as Phase 2 does) rather than trusting the block.

- **2026-09-06 — `insert_hazards` had the same attribution hole as `insert_rescue`.** It accepted `reported_by IS NULL`, which is not merely untidy: `resolve_hazards` is scoped to `reported_by = auth.uid() or is_staff()`, so an unattributed report lands successfully and can then never be resolved by the person who filed it — they would watch their own cleared hazard sit in the feed forever. Same shape as the SOS bug from Phase 3, in a second table. Fixed in `0009`. Worth noting the pattern: every table with an owner column needs the owner *required*, not merely permitted.

- **2026-09-06 — Photos are queued separately from rows, on purpose.** They could not share the ordered row queue: that queue sends JSON to PostgREST and stops at the first retryable failure, so a 4 MB upload timing out on a dying tower would hold up every write behind it — including a rescue request. So the report row is sent on its own and never waits for its picture, the photo retries independently, and the row is patched with the object path only once the bytes are safely stored. The visible consequence is that a report can exist without its photo for a while; that is the intended trade, because the alternative loses the urgent half to protect the optional half.

- **2026-09-06 — The photo bucket is private.** A hazard photo shows somebody's street, often their house, taken at the worst moment of their year. A public bucket hands out a permanent unauthenticated URL for that, which sits badly beside §9, where even vulnerability tags are staff-only. Reads go through short-lived signed URLs instead. Object paths are `{uid}/{hazardId}` so the storage policy can prove ownership from the path rather than from a column a client could set.

- **2026-09-06 — Known gap, not yet addressed: the reports feed is not cached offline.** The advisory snapshot is, but water and hazard reads go straight to Supabase, so offline the community feed collapses to just this device's queued items. It demos perfectly (online) and degrades in the field (offline), which is exactly the failure mode this project keeps trying to avoid. Not in the §7.6/§7.7 requirements, which cover realtime push rather than offline reads — flagged here rather than silently expanded into.

- **2026-09-05 — Phase 5 bug: a reporter could not see their own report.** The write returns as soon as it is durable on the device, so the re-read fired immediately afterwards raced the flush and came back stale; and the originating tab could not rely on its own Realtime echo to fill the gap. Offline it was worse — the report would not have appeared at all. That matters more than it sounds: someone who files a flood report, sees nothing in the list, and concludes it failed will file it again, and duplicate reports from one street are exactly the noise responders cannot afford. Fixed with `allWaterReports()`, merging the local write queue into the list on the same pattern as `allMyRequests()` for SOS, plus an `onQueueChanged` subscription so the row updates when the flush lands.

- **2026-09-05 — The water scale stores text, not a number.** `knee` / `waist` / `chest` / `above_head` go to the database as the reporter chose them. Converting to centimetres at any point would invent precision nobody measured: a stranger's "waist-deep" is comparable and honest, their "60cm" is a guess wearing a number's clothes. It is also why the picker is four figures with the water drawn at height — the picture is the question, answerable without reading the label.

- **2026-09-05 — Water depth uses the state colours, never the signal ramp.** Chest-deep water is dangerous but it is not a storm signal level, and the ramp means severity-of-signal and nothing else. Reusing it here would be the first crack in the one rule the colour system has.

- **2026-09-05 — Measuring sync latency needed instruments outside the browser.** In-browser timings drifted from 1.0s to 10.5s across runs with no code change, because the hidden pane throttles render scheduling. Splitting the measurement settled it: a Node poller at 100ms showed tap→server at **387ms**, and a supabase-js subscriber in Node showed insert→event at **935ms**. Both are environment-independent. Recorded because an in-browser number alone would have been either falsely reassuring or falsely alarming depending on which run was taken.

- **2026-09-05 — Phase 4 was chased through four real bugs and one environment limit; the order matters because each one masked the next.** All four produced the identical symptom — a blank map with no exception — which is why it took so long to separate them:
  1. **Container had zero height.** `flex-1` gives the wrapper a height, but a percentage height inside a flex item resolves against an indefinite containing block, and `absolute` as a *utility class* loses to `maplibre-gl.css`, which sets `.maplibregl-map { position: relative }` on the very element MapLibre tags after mount. Fixed with an inline absolute style, which is outside that cascade fight. Confirmed: container 0px → 560px.
  2. **`glyphs: undefined` invalidated the style.** Setting the key to undefined is not the same as omitting it; MapLibre validates and rejects "glyphs: string expected, undefined found", which kills the whole style. There are no text layers, so the key is simply gone now.
  3. **MapLibre rejects CSS variables *and* `oklch()`.** The severity tokens are authored in oklch, so the route layer failed with "color expected". `resolveColour()` converts by painting to a 1×1 canvas and sampling the pixel — reading `fillStyle` back does *not* normalise, because a browser that understands oklch serialises it straight out again. Resolving at runtime rather than hard-coding hex keeps the map's severity colour identical to the placard above it by construction.
  4. **MapLibre 6 could not load its worker under Next + webpack.** v6 loads the worker as a separate module resolved from `import.meta.url`, which inside a bundled chunk points at `/_next/static/chunks/…`, returns Next's HTML 404, and is rejected for MIME type. Nothing throws. Pinned to **maplibre-gl@5**, which inlines the worker and needs no workaround; the vendoring script written for v6 was deleted rather than left behind.

- **2026-09-05 — `requestAnimationFrame` never fires in this session's browser pane, which is why the map could not be verified visually.** Measured directly: 0 rAF callbacks in 3 seconds while `setInterval` fired 15 times, with `document.hidden` reporting false. MapLibre loads inline styles via `frameAsync` and renders from rAF, so `isStyleLoaded()` stays false forever and the canvas stays blank no matter what the code does. This also explains the Phase 3 hold-to-cancel gesture, which is rAF-driven and never completed. Worth recording because the symptom is indistinguishable from a real bug and cost most of Phase 4's time; the four genuine bugs above were all found and fixed *before* this was identified as the remaining cause.

- **2026-09-05 — The base map is drawn from GeoJSON, not fetched from a tile source.** Barangay San Isidro is synthetic, so no tile provider has streets for it, and every layer being GeoJSON is what makes the view offline by construction: boundary and route ride in the advisory snapshot already cached in IndexedDB, and the street grid is a precached static file. There is no network call in this view at all. When real geography arrives, the same layers sit on top of a PMTiles basemap — one file per barangay, cached the same way.

- **2026-09-05 — Geometry is tested rather than eyeballed (`npm run check:geo`).** A wrong "path blocked" answer does not look wrong on screen: the map still draws a confident line. The tests cover the case a naive implementation misses — a hazard in the middle of a long straight rather than near a vertex, which is the most likely place for a flooded road. Point-to-*segment* distance is what catches it. The tests import the TypeScript source directly (Node strips types natively), so they exercise exactly what ships. One test initially failed for the wrong reason: it offset the hazard north, along the route toward its corner, instead of perpendicular to the leg.

- **2026-09-05 — Phase 3 security hole: the SOS rate limit could be bypassed by omitting one field.** `private.recent_rescue_count()` counts rows `where requested_by = auth.uid()`, but nothing required `requested_by` to be set — so a row inserted with a NULL owner counted against nobody and the limit never fired. Confirmed against the live REST API: **seven consecutive inserts all returned 201 against a limit of five**, using nothing more exotic than leaving a field out of the JSON body. Fixed in `0007` by requiring `requested_by = auth.uid()` in the insert policy. This does not reintroduce a login — every caller already holds an anonymous uid — and it moves into the database a rule the client was only following voluntarily. Re-verified: five accepted, sixth and seventh 403, bypass 403.

- **2026-09-05 — I repeated a mistake this file already documented.** `0006` added `revoke all on function private.recent_rescue_count()`, and every SOS insert immediately began failing with 403. Postgres evaluates an RLS policy expression with the *caller's* privileges, so revoking EXECUTE leaves the policy unable to call the helper it depends on — exactly what `0003` had already run into and written down for `is_staff()`. The revoke also bought nothing: what keeps the helper off `/rest/v1/rpc/` is living in the `private` schema. Caught by the RLS suite dropping to 16/18 within a minute of applying the migration.

- **2026-09-05 — Phase 3 bug: the resident's own SOS timer froze at 00:00 while offline.** `myRequests()` reads the server, so with no network the screen had no row to time and displayed a stopped clock on a distress call the person had just raised — the resident-side version of the exact failure the gate checks. Fixed with `queuedRequests()` / `allMyRequests()`, which merge the local write queue into the view; the queued payload already carried the tap time. Verified offline: 00:43 and counting while still queued.

- **2026-09-05 — GPS must never gate the SOS, so `lat`/`lng` are now nullable.** They were `NOT NULL`, which quietly made a satellite fix a precondition for asking for help. Indoors, in a concrete house, during a storm, a first fix can take 30+ seconds or never arrive — precisely the situation the button exists for. The Purok is already known, so "Purok 3, no GPS" still tells responders which street to search, and it is enormously better than no request. The UI shows GPS state as information, never as a reason to wait.

- **2026-09-05 — Two timestamps, deliberately.** `ts` is when the human tapped: client-supplied, may predate arrival by hours, and drives every elapsed timer. `created_at` is when the row reached Postgres: server-stamped, un-forgeable, and used only for rate limiting. They exist separately because `ts` must be trusted for the timer and must *not* be trusted for the limit — a client could backdate it to slip the window.

- **2026-09-05 — The write-path guard caught my own new code, and it was right.** `check-write-paths.mjs` flagged three direct `.update()` calls in `lib/sos.ts` (cancel, acknowledge, mark-rescued). The queue was insert-only, so status changes had no choice but to bypass it — and a resident cancelling offline would have had that cancel evaporate, sending a rescue team through a storm to someone already safe, with capacity somebody else needed. Rather than allowlist the file, the queue gained `enqueueUpdate` and an `op` field. Ordering already guarantees an update cannot overtake the insert it depends on. Verified: an acknowledge made offline queued as an update and applied on reconnect.

- **2026-09-05 — The responder map uses the dark basemap, not the default.** OpenFreeMap's `liberty` renders white, which in a near-black interface read at night both wrecks the reader's dark adaptation and makes the severity-coloured pins harder to pick out. `/styles/dark` exists and was verified to return a near-black background. Not a preference — the same reasoning as the rest of the single dark theme.

- **2026-09-05 — `support.js` was referenced by every artboard but had never been committed.** Opening any `.dc.html` in a browser showed raw `{{...}}` placeholders, and the eight original PNGs could only have been produced by hand. Written now: it resolves placeholders and `<sc-if>`, and reads prop defaults from `data-props` with query-string overrides. The artboards are self-contained again — openable, tweakable, and re-renderable by anyone with a browser.

- **2026-09-05 — The PNGs in `screens/` are now a build output (`npm run render:design`).** Hand-made exports drift from their sources with no way to notice. They are regenerated from `artboards/` at 2x, sized from `canvas.json`, and reviewable as a diff.

- **2026-09-05 — Bug in my own render script: it reported success without rendering anything.** Success was judged by the output file existing, but the script never deleted the target first — so a render that produced nothing "passed" by finding the previous run's PNG. One screen silently kept a stale image across two consecutive "15/15 rendered" runs while its source had changed underneath it, and I only caught it because the stale image was of a browser error page. Fixed by deleting each target before rendering. The retry counts that then appeared (2–3 attempts on nearly every screen) show the underlying flakiness had been there all along, masked.

- **2026-09-05 — Headless screenshotting on Windows needed three accommodations, all found by testing.** `--headless=new` frequently exits 0 having written nothing, so the script uses `--headless=old`; forward-slash output paths are silently ignored, so paths are converted to backslashes; and the file lands slightly after the process exits, so an immediate existence check reports a false failure. Even then roughly one attempt in four produces nothing, with no error — hence up to five attempts per artboard.

- **2026-09-05 — Phase 2 bug: the tap waited on the network, which is the one thing it must never do.** `enqueueWrite` tried Supabase first and fell back to the queue on failure, so acceptance was gated on the network *failing*. Measured at 270ms offline against NFR-3.2's 200ms budget — but the number understates it. Offline you pay a fast rejection; on a tower that is up but saturated, the expected mid-storm condition, you pay a multi-second timeout with nothing yet written down anywhere, while a resident stares at an unconfirmed SOS. The function's own docstring already promised the opposite ("the tap never waits on the network"). Inverted the order: persist to IndexedDB first, return, then flush in the background. Now 7–16ms, and independent of the network by construction rather than by timing. `WriteOutcome.synced` is consequently always false on return, and delivery is reported through the queue count the sync strip already shows.

- **2026-09-05 — Phase 2 bug: one undeliverable write could block every write behind it, forever.** `flushQueue` stopped at the first error to preserve ordering (FR-3.2), which is right for a network failure and catastrophic for a row that can never be accepted. A malformed water report would have left a rescue request queued and invisible for the whole storm. Now failures are classified: provably-permanent ones (not-null, FK, check, invalid input, schema mismatch) mark the row `blocked` and the queue steps over it; everything else still stops and preserves order. Deliberately NOT treated as permanent: `42501` (a write queued before the anonymous session existed has no owner and succeeds once it does) and expired-JWT codes. The bias is to keep retrying unless the row provably cannot land — retrying a doomed write costs a request, giving up on a good one loses a resident's report. Verified end to end: a poison row was blocked after 1 attempt and a valid row queued behind it was delivered.

- **2026-09-05 — Blocked writes are counted and worded separately from queued ones.** "3 queued" and "3 failed to send" mean opposite things to someone deciding whether to walk to the barangay hall in a storm. Blocked rows are excluded from the queued count (a number that never falls reads as a broken queue rather than as specific failures), shown in alarm colour, and never deleted automatically. `retry` and `discard` exist because without them one bad row would leave a permanent failure indicator on every screen, and residents would learn to ignore it.

- **2026-09-05 — The write-path rule is enforced by a script, not by review.** `scripts/check-write-paths.mjs` fails the build if any file outside `lib/offlineQueue.ts` performs a Supabase write. It matches `.from(<table>).<verb>(` rather than the verb alone, so `Set.delete` and Dexie's `.update()` do not trip it. The guard was itself verified by planting a violation and confirming it reported the right file and line and exited non-zero — an assertion that has never once failed is not evidence of anything.

- **2026-09-05 — Test methodology correction: stopping the local server does not simulate being offline.** The first Phase 2 gate run appeared to show writes vanishing from the queue after a reload. They had not been lost — they had been *delivered*. Stopping `next start` makes the app shell unreachable but leaves Supabase perfectly reachable, and overriding `navigator.onLine` only changes a JS property that supabase-js never consults. The real test rejects `fetch` to the Supabase origin, which is what a lost connection actually does to the client. Re-run under those conditions, the queue behaved correctly. Recorded because the earlier method looked convincing and proved nothing.

- **2026-09-05 — `window.salbabayan` is a deliberate diagnostics surface, not debug residue.** The queue is the one component whose failure is invisible from the UI — a resident sees "accepted" either way, and only the device knows a row has been stuck for six hours. It adds no attack surface: everything it exposes is device-local data plus calls the page can already make, the anon key ships in the bundle by design, and the real boundary is RLS, which `scripts/rls-test.mjs` holds. It is also what made the Phase 2 gate testable before the Phase 3 write screens exist.

- **Housekeeping — `scripts/rls-test.mjs` leaves rows behind on every run.** It inserts a water report and a rescue request, and the schema has no delete policies by design (append-only ledgers, auditable reports), so the test cannot tidy up after itself. They need clearing with a privileged migration periodically, or the demo data slowly fills with `rls-test` rows.

- **2026-09-05 — `npm run dev` refused to start: Turbopack vs the Serwist webpack config.** Next 16 runs dev on Turbopack by default, and it errors out when it finds a `webpack` config it did not expect. Setting Serwist's `disable: true` in dev was not enough — the plugin still wraps the config with a `webpack` function, so Turbopack still saw one. The fix is to skip the wrapper entirely in dev (`isDev ? nextConfig : withSerwist(nextConfig)`), which keeps Turbopack's fast refresh; `npm run build` stays pinned to `--webpack`, where Serwist actually runs. Verified: dev starts clean on Turbopack, the advisory renders, and `navigator.serviceWorker.getRegistrations()` is empty in dev — the SW is absent by design, so there is no stale precache to debug against.

- **2026-09-05 — `AGENTS.md` / `CLAUDE.md` are generated by `next dev` and committed on purpose.** Next 16 rewrites them on every dev run, so leaving them untracked just recreates the same uncommitted diff every time. The generated file says as much itself.

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
