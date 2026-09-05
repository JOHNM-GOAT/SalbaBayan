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
