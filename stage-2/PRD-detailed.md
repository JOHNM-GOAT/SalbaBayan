# SalbaBayan — Product Requirements Document

**Barangay-Level Typhoon Early Warning & Evacuation Coordination System**

| Field | Value |
|---|---|
| Product name | SalbaBayan (formerly BayanAlerto) |
| Document version | 1.0 |
| Status | Draft — for review |
| Team | RCGOAT |
| Members | John Micooh Ugot · Nicole Anne Arciaga |
| Track / Theme | Climate Resilience and Hydrometeorological Disaster Management |
| Source documents | `BayanAlerto_concept_and_architecture_2.md` (v4), `RCGOAT_Ideation_Stage1.pdf` |
| Related assets | SalbaBayan Wireframes (8 artboards — resident, volunteer, responder, official) |

---

## 1. Overview

### 1.1 Summary

SalbaBayan is a Progressive Web App that turns a national PAGASA typhoon signal level into a specific, street-level instruction for a specific resident, delivered in their own language, and keeps working through the connectivity gaps that typhoons create.

Barangay officials pre-configure evacuation protocols once per season. Trained community volunteers supply real-time ground truth — water levels, hazards, headcounts, resident check-ins. Residents receive a plain-language instruction for their Purok, an offline-capable evacuation map, and a one-tap rescue button.

### 1.2 Design philosophy

The system replaces expensive infrastructure with **structure**: pre-configured local knowledge entered once by people who already have it, plus real-time observation from people already present, delivered over a standard web stack a small team can build, deploy, and maintain.

Two deliberate consequences:

- **No hardware.** No IoT water-level sensors, no radios, no mesh nodes. The community is the sensor network.
- **No exotic engineering.** No machine learning, no peer-to-peer networking, no custom cryptography. Every component is a mainstream library or managed service.

### 1.3 Explicit scope boundary

SalbaBayan is **not** built to survive a total, indefinite communications blackout. It is built to survive the realistic case of **intermittent connectivity** during a storm: the client keeps working through gaps (reading cached data, queueing new writes) and reconciles once a connection returns. This trade-off is stated up front rather than discovered in the field.

---

## 2. Problem Statement

The Philippines experiences an average of **twenty tropical cyclones annually**. Four specific gaps make existing systems fail at the barangay level.

### 2.1 Cloud-dependency gap

When severe typhoons strike, infrastructure collapse severs internet and cellular connections. Centralized, cloud-based early warning systems become inaccessible precisely when they are most needed. A warning system that goes dark when the typhoon knocks out the network is not a warning system when it matters.

### 2.2 National-to-local translation gap

PAGASA signal levels tell a barangay *what category of storm* is coming. They do not tell a resident on a specific street *what to do*. Officials are left to improvise that translation mid-storm, under pressure, without a record of what was decided.

### 2.3 Sensor affordability gap

Dedicated IoT water-level sensors are too costly to deploy and maintain at barangay scale. Without them, there is no local, real-time flood signal at all.

### 2.4 Rescue-response gap

A resident in immediate danger has no fast way to summon help and be located precisely. Shouting, or waiting for a volunteer to pass by, is often the only option.

---

## 3. Goals & Non-Goals

### 3.1 Goals

| ID | Goal |
|---|---|
| G1 | A resident can see what they specifically should do right now, in their own language, with zero connectivity. |
| G2 | No user action is ever blocked or lost because the network is down. |
| G3 | Officials can configure every Purok × Signal Level protocol before the season and see coverage gaps before the storm. |
| G4 | A resident in danger can summon geolocated help in one tap, without a login. |
| G5 | Volunteers can report ground truth and run an evacuation center from a phone, in the rain. |
| G6 | The whole system is deployable and maintainable by a small team on free/low-cost tiers. |

### 3.2 Non-goals

| ID | Non-goal | Rationale |
|---|---|---|
| NG1 | Surviving a total, prolonged internet blackout | Requires peer-to-peer mesh; deferred to roadmap |
| NG2 | Automated water-level sensing | Requires hardware or on-device CV; deferred |
| NG3 | Adversarial-grade security on check-in | Cooperative internal coordination is the actual threat model |
| NG4 | A native mobile app | PWA reaches low-end Android without an install barrier |
| NG5 | Replacing PAGASA or NDRRMC as an authority | SalbaBayan localizes official advisories, it does not issue them |
| NG6 | Multi-barangay / municipal rollout tooling in v1 | Pilot is single-barangay scoped |

### 3.3 Success metrics

Proposed targets — to be confirmed with the pilot barangay before launch.

| Metric | Target |
|---|---|
| Protocol coverage before storm season | 100% of Puroks × Signal 1–5 configured |
| Resident registration | ≥ 60% of barangay households registered with a QR |
| Pre-storm cache rate | ≥ 80% of registered residents opened the app in the 72h before landfall |
| Offline write loss | 0 queued writes lost across a storm event |
| Rescue acknowledgement time | Median < 10 minutes from request to `acknowledged` |
| Headcount accuracy | Center ledger within ±3 of manual count at post-storm reconciliation |
| Report volume | ≥ 1 water-level report per Purok per 3h during an active event |

---

## 4. Users & Roles

### 4.1 Personas

**Resident** — lives in a specific Purok. May have a low-end Android phone, limited data, and variable literacy. Needs one clear instruction and a way to call for help. Under stress; will not read paragraphs.

**Volunteer** — trained community member, present on the ground during the event. Reports water levels and hazards, scans residents into evacuation centers, maintains headcounts, responds to rescue requests. Working outdoors, possibly in rain, with wet or gloved hands.

**Official (Barangay staff / Kagawad)** — configures protocols and translations before the season, sets the current signal level when a PAGASA bulletin arrives, monitors the readiness dashboard, oversees rescue dispatch, and reconciles records after the storm. Works from a laptop at the barangay hall.

### 4.2 Permission matrix

Enforced by Postgres Row Level Security, not only in the UI, so a compromised client cannot write outside its role.

| Role | Can read | Can write |
|---|---|---|
| **Resident** | Public advisory, protocols, translations, own check-in status, hazard reports feed, own rescue requests | `water_reports` (own), `hazard_reports` (own, may resolve own), `rescue_requests` (create + cancel own) |
| **Volunteer** | All of the above, plus all active rescue requests | `water_reports`, `hazard_reports` (submit + resolve any), `headcounts`, `checkins`, `rescue_requests` (update status) |
| **Official** | Everything, including `documents` | `protocols`, `translations`, `evac_centers`, `residents`, `documents`, resolve any `hazard_reports`, `rescue_requests` (update status) |

**Unauthenticated exception:** creating a `rescue_request` requires no authentication. A resident in danger must never be blocked by a login screen. See FR-10.4, NFR-4.4, and Risk R6.

---

## 5. Feature Requirements

Priority: **P0** = required for pilot launch · **P1** = required for full v1.

### 5.1 Evacuation Protocol & Public Advisory

#### F1 — Evacuation Protocol Mapping · P0

Officials populate a Signal Level × Purok lookup table defining what happens for every combination.

| ID | Requirement |
|---|---|
| FR-1.1 | Officials can create/edit a protocol row for each (Purok, signal_level 1–5) pair: route, route geometry, evacuation center, action key |
| FR-1.2 | Protocols are editable at any time, not locked to a season |
| FR-1.3 | The admin view shows coverage as a Purok × Signal matrix, with unconfigured cells visibly flagged |
| FR-1.4 | Route geometry (`route_geojson`) is stored as line geometry and renders as the map's routing overlay |
| FR-1.5 | A protocol edit shows how many residents of that Purok it will reach |

#### F2 — Public Advisory View · P0

| ID | Requirement |
|---|---|
| FR-2.1 | Residents select their Purok, or it is pre-set at registration |
| FR-2.2 | The view shows the barangay's current signal level joined against that Purok's protocol |
| FR-2.3 | The current signal level is set manually by an official when a PAGASA bulletin arrives, and is stored on `barangays.current_signal_level` with `signal_set_at` / `signal_set_by` for audit |
| FR-2.4 | The signal level is colour-coded on a fixed 1–5 severity ramp (green through deep red) used nowhere else in the interface |
| FR-2.5 | The view displays a plain-language action instruction, an assigned evacuation center, and distance |
| FR-2.6 | When offline, the view renders the last cached advisory and clearly labels it with cache age |
| FR-2.7 | For evacuation-level signals, the view shows a leave-by deadline and remaining time |
| FR-2.8 | A resident can self-report as safe/evacuated from this view |

#### F3 — Localized-Language Alerts · P0

| ID | Requirement |
|---|---|
| FR-3.1 | Every displayed message resolves through the `translations` table by `message_key` + selected language |
| FR-3.2 | Adding a language is a data-entry task, not a code change |
| FR-3.3 | Launch languages: Tagalog, Cebuano/Bisaya, English. Ilocano and Waray supported by the same mechanism |
| FR-3.4 | The admin protocol editor shows per-language completeness for each action string |
| FR-3.5 | If a string is missing in the selected language, it falls back to a configured default language rather than rendering blank |

#### F4 — Pre-Storm Readiness Checklist · P1

A dashboard computed from existing tables — no new state machine, pure read-side aggregation.

| ID | Requirement |
|---|---|
| FR-4.1 | "Protocols configured" — checks for a `protocols` row per Purok per signal level |
| FR-4.2 | "Volunteers assigned" — checks `user_roles` for volunteer entries |
| FR-4.3 | "Residents registered" — counts `residents` against expected population |
| FR-4.4 | "App cached on devices" — reports how many registered residents have synced recently |
| FR-4.5 | Incomplete items are actionable: clicking a gap opens the editor for it |

### 5.2 Community Reporting & Realtime Alerts

#### F5 — Community Water-Level Reporting · P0

| ID | Requirement |
|---|---|
| FR-5.1 | A form captures Purok, location label, level category, and auto-timestamp |
| FR-5.2 | Open to both Residents and Volunteers |
| FR-5.3 | Level category is selected via a body-referenced depth scale (knee / waist / chest / above head) rather than a numeric entry or dropdown, so it is answerable under stress and regardless of literacy |
| FR-5.4 | Every report is attributable to its reporter and timestamped |
| FR-5.5 | No calibration, computation, or maintenance is required — the raw human observation *is* the signal |

#### F6 — Community Hazard Reports · P0

| ID | Requirement |
|---|---|
| FR-6.1 | Categories: fallen tree, blocked road, downed lines, flooding, other |
| FR-6.2 | Captures Purok, free-text description, and an optional photo |
| FR-6.3 | Photo upload uses Supabase Storage; `photo_url` is nullable |
| FR-6.4 | Posts appear instantly in a shared live feed visible to everyone — no moderation queue |
| FR-6.5 | Any report can be marked `resolved` by its original reporter, a volunteer, or an official — a status field update, not a workflow engine |
| FR-6.6 | Hazards are plotted on the evacuation map and flag affected routes |

#### F7 — Realtime Alert Aggregation · P0

| ID | Requirement |
|---|---|
| FR-7.1 | The advisory view subscribes to Supabase Realtime on `water_reports`, `hazard_reports`, and `protocols` |
| FR-7.2 | New entries push to all connected clients immediately — no polling |
| FR-7.3 | The responder rescue map subscribes to `rescue_requests` on the same mechanism |

### 5.3 Evacuation Center Operations

#### F8 — Evacuation Center Headcount Tracking · P0

| ID | Requirement |
|---|---|
| FR-8.1 | Each center has +1 / −1 controls writing an append-only `headcounts` row; no row is ever overwritten |
| FR-8.2 | Current count is `SUM(delta)` per `evac_center_id` — concurrency-safe by construction |
| FR-8.3 | Count displays against capacity, with a visible warning state as the center approaches full |
| FR-8.4 | A breakdown by vulnerability tag (elderly / infant / medical) is shown for triage |
| FR-8.5 | The ledger is visible with timestamp and recording volunteer |
| FR-8.6 | A bulk-entry control supports adding a family group in one action |
| FR-8.7 | Counter controls sit in the thumb zone and meet a 44px minimum target for wet or gloved hands |

#### F9 — Resident Check-In via QR · P0

| ID | Requirement |
|---|---|
| FR-9.1 | Each resident receives a static `qr_token` and a generated QR image at registration |
| FR-9.2 | Tokens are regenerated only on reissue; no encryption or cryptographic signing |
| FR-9.3 | A volunteer-facing scanner opens the device camera (`getUserMedia`) and decodes with `jsqr` |
| FR-9.4 | On scan, the resident is looked up by token and their `vulnerability_tags` surface immediately, colour-weighted for triage |
| FR-9.5 | The volunteer logs a status: checked-in / evacuated / needs-help |
| FR-9.6 | Security model is token uniqueness plus RLS scoping to the volunteer role — appropriate for cooperative internal camp coordination, explicitly not adversarial |

### 5.4 Rescue & Mapping

#### F10 — One-Tap Rescue Request & Live Location Map · P0

| ID | Requirement |
|---|---|
| FR-10.1 | A single prominent "I need rescue" control is reachable from every resident screen |
| FR-10.2 | On tap, the client calls `navigator.geolocation.getCurrentPosition`, falling back to `watchPosition` while the request is open so the pin updates if the resident moves |
| FR-10.3 | Writes `{lat, lng, accuracy_m, purok_id, status: 'pending'}` through the shared offline queue — the tap never blocks on connectivity |
| FR-10.4 | **No authentication is required to send a request** |
| FR-10.5 | The resident sees request state: pending → acknowledged → rescued, plus elapsed time |
| FR-10.6 | The resident sees who is responding and their position in the queue, so they know they have been seen |
| FR-10.7 | Cancelling a request requires a deliberate press-and-hold; a single mis-tap must not withdraw a distress call |
| FR-10.8 | Volunteers and officials see all `pending`/`acknowledged` requests plotted on a Google Maps view, live-updated via Realtime |
| FR-10.9 | Tapping a marker shows resident name (if registered), Purok, and elapsed time |
| FR-10.10 | A responder marks `acknowledged` on dispatch and `rescued` on completion |
| FR-10.11 | The responder queue sorts by wait time, and the oldest unassigned request is escalated persistently |

#### F11 — Interactive Live Evacuation Map · P0

The base map every resident opens the app to.

| ID | Requirement |
|---|---|
| FR-11.1 | Renders the user's live GPS position over a MapLibre GL base map |
| FR-11.2 | Overlays Purok boundary polygons from `puroks.boundary_geojson` |
| FR-11.3 | Overlays the routing line from `protocols.route_geojson` for the current signal level, to the assigned evacuation center |
| FR-11.4 | **Works with zero connection** — base map tiles, boundaries, and routes are downloaded as tile packs and cached in the Service Worker's Cache Storage |
| FR-11.5 | Shows next-turn guidance and remaining distance |
| FR-11.6 | Plots active hazard reports on the route and warns when a hazard blocks the assigned path |
| FR-11.7 | Shows destination capacity so a resident is not routed to a full center |
| FR-11.8 | This map is architecturally distinct from the Google Maps responder view in F10, which requires connectivity |

### 5.5 Offline-First Client

#### F12 — Offline-Resilient Client · P0

This is the core design constraint of the project, not an add-on.

| ID | Requirement |
|---|---|
| FR-12.1 | A single reusable utility (`lib/offlineQueue.ts`) wraps **every** write action across F5, F6, F8, F9, F10 |
| FR-12.2 | Behaviour: attempt a direct Supabase write; on failure, enqueue the payload in a Dexie.js IndexedDB table |
| FR-12.3 | A background listener (`window.ononline` + periodic retry) flushes the queue **in order** once connectivity returns |
| FR-12.4 | The Service Worker (`next-pwa`) separately caches GET requests for protocols, translations, and advisory data so the read side works offline |
| FR-12.4a | The Service Worker **precaches the app shell** — the Next.js document, JS/CSS bundles, fonts, and icons — so a full page reload while offline still boots the app instead of a browser error page. Data caching alone is not sufficient; without this the offline demo fails at reload |
| FR-12.5 | Queued photo uploads are held as local blobs until reconnect |
| FR-12.6 | Connection and sync state is **persistently visible** in the interface — cache age and queued-write count — not hidden behind a transient toast |
| FR-12.7 | The UI never blocks on a network call. No spinner gates a user action |
| FR-12.8 | One pattern, reused everywhere — not custom logic per feature |

### 5.6 Support Feature

#### F13 — Documentation Knowledge Base · P1

| ID | Requirement |
|---|---|
| FR-13.1 | A Node/TS script (`scripts/ingest-docs.ts`) reads every `/docs/*.md`, extracts title + content, and upserts into `documents` keyed by filename |
| FR-13.2 | Re-running the script is safe (idempotent upsert) |
| FR-13.3 | An admin-only page lists and renders these for reference during an event |

---

## 6. Technical Architecture

### 6.1 Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | Next.js (App Router) + React + Tailwind CSS | Mainstream, well-documented, fast to build |
| Backend | Supabase (Postgres + Auth + Realtime + RLS) | Managed Postgres with built-in auth/realtime/RLS — no custom backend |
| Hosting | Vercel | Zero-config Next.js deploy, free tier covers pilot |
| Offline layer | `next-pwa` (Service Worker) + Dexie.js (IndexedDB) | Standard PWA caching + simple IndexedDB API |
| Offline evacuation map | MapLibre GL JS + cached vector/raster tile packs | Map is data the device already has, not a live fetch |
| QR check-in | `qrcode` (generation) + `jsqr` (scanning via `getUserMedia`) | Lightweight, no native app, no custom crypto |
| Rescue geolocation & live map | Geolocation API + Google Maps JavaScript API | One-tap GPS capture plus a live responder view |

### 6.2 Data flow model

**Local-first for writes, cloud-first for truth.** The UI never blocks waiting on the network, but there is exactly one source of truth (Supabase).

No conflict-resolution logic is needed beyond "retry the queued write when back online," because **devices never sync directly with each other**. Every device talks only to Supabase. No feature depends on another device being nearby.

```
ONLINE          Supabase (Postgres · Auth · Realtime · RLS)
                          │ HTTPS reads/writes + Realtime subscription
                  Next.js Client (Vercel-hosted PWA)
                   │                        │
        Service Worker cache        IndexedDB write queue
        (read-only reference        (reports, headcounts,
         data)                       check-ins, rescues)
                                            │ auto-flush on reconnect
                                    back to Supabase

OFFLINE (temporary): client reads from Service Worker cache,
writes queue in IndexedDB, UI stays fully usable.
```

### 6.3 Data model

| Table | Shape / purpose |
|---|---|
| `barangays` | `{id, name, municipality, province, current_signal_level, signal_set_at, signal_set_by}` — `current_signal_level` (0–5, 0 = no active signal) is the single value an official sets per PAGASA bulletin, and the value every advisory query joins against |
| `puroks` | `{id, name, barangay_id, boundary_geojson}` — sub-areas with boundary polygon for map overlay |
| `protocols` | `{purok_id, signal_level, route, route_geojson, evac_center_id, action_key}` — the Signal × Purok lookup |
| `translations` | `{message_key, language, text}` — dialect strings referenced by `action_key` and UI text |
| `evac_centers` | `{id, name, purok_id, capacity}` |
| `headcounts` | `{evac_center_id, delta, ts, recorded_by}` — append-only; current count = `SUM(delta)` |
| `water_reports` | `{id, purok_id, location_label, level_category, ts, reported_by}` |
| `hazard_reports` | `{id, purok_id, category, description, photo_url, status, ts, reported_by}` — status: open / resolved |
| `residents` | `{id, name, purok_id, qr_token, vulnerability_tags}` — tags: elderly / infant / medical |
| `checkins` | `{resident_id, status, ts, scanned_by}` — status: checked-in / evacuated / needs-help |
| `rescue_requests` | `{id, resident_id, purok_id, lat, lng, accuracy_m, status, ts, notes}` — status: pending / acknowledged / rescued / cancelled |
| `documents` | `{filename, title, content, updated_at}` — ingested `/docs/*.md` |
| `user_roles` | `{user_id, role}` — resident / volunteer / official; drives RLS |

### 6.4 Data integrity patterns

- **Append-only ledgers** for counters (`headcounts`) — no lost updates under concurrent taps.
- **Status-field updates** for lifecycle (`hazard_reports`, `rescue_requests`) — no workflow engine.
- **RLS at the database layer**, so role enforcement survives a compromised client.

---

## 7. Non-Functional Requirements

### 7.1 Device & environment targets

| ID | Requirement |
|---|---|
| NFR-1.1 | Must run on low-end Android phones on Chrome; no install step required |
| NFR-1.2 | Interface must be legible in direct outdoor glare and in darkness |
| NFR-1.3 | Interactive targets ≥ 44px; primary controls sized for wet or gloved hands |
| NFR-1.4 | Tile-pack storage footprint must be disclosed to the user before download and kept within a stated budget |

### 7.2 Accessibility & localization

| ID | Requirement |
|---|---|
| NFR-2.1 | All user-facing copy resolves through `translations` — no hardcoded strings |
| NFR-2.2 | A text-size control is available for outdoor and low-vision use |
| NFR-2.3 | Colour is never the sole carrier of meaning — severity is also conveyed by numeral and text |
| NFR-2.4 | Critical inputs (flood depth, hazard category) are answerable without reading prose |

### 7.3 Performance

| ID | Requirement |
|---|---|
| NFR-3.1 | Advisory view renders from cache in < 1s on a cold offline start |
| NFR-3.2 | Rescue request write is enqueued in < 200ms from tap, independent of network |
| NFR-3.3 | Realtime updates surface to connected clients in < 5s |

### 7.4 Security & privacy

| ID | Requirement |
|---|---|
| NFR-4.1 | RLS policies enforce the §4.2 matrix at the Postgres level |
| NFR-4.2 | Resident location data is captured only on explicit rescue request, never passively tracked |
| NFR-4.3 | `vulnerability_tags` are visible only to volunteers and officials, never in public feeds |
| NFR-4.4 | Unauthenticated rescue requests are rate-limited to mitigate flooding (see R6) |

### 7.5 Operations

| ID | Requirement |
|---|---|
| NFR-5.1 | Free tiers of Supabase and Vercel must cover pilot scale |
| NFR-5.2 | No infrastructure to operate beyond a web app and a managed database |
| NFR-5.3 | No hardware beyond phones and laptops already owned |

---

## 8. Operational Timeline

How the system is actually used across an event.

### 8.1 Pre-season / T-24 (online)

- Officials configure protocols and translations for every Purok and signal level.
- Residents register, generating their QR.
- Volunteers are assigned roles.
- The readiness dashboard shows what is still incomplete.
- **Residents open the app at least once** so the Service Worker caches advisory data and evacuation map tile packs to their device.

### 8.2 During the storm (intermittent connectivity)

- Residents check the advisory view. If offline, they see the last-cached instruction — still correct unless the signal level changed since their last sync.
- A resident in danger taps the rescue button; the GPS pin queues locally if offline and appears on the responders' live map the moment a signal returns.
- Volunteers submit water-level readings and headcount updates. If connection drops, the app queues locally and shows a "will sync when back online" indicator rather than failing.
- When connectivity returns, even briefly, queued writes flush automatically and the realtime view updates for everyone.

### 8.3 Post-storm (recovery)

- Officials review aggregated `water_reports` and `headcounts` history.
- Evacuation center numbers are reconciled.
- `checkins` data is used to account for residents.
- The readiness dashboard resets for the next event; protocols are updated based on what worked.

---

## 9. User Experience

Eight screens are specified as high-fidelity wireframes in the SalbaBayan Wireframes canvas.

| Screen | Role | Covers |
|---|---|---|
| Advisory Home | Resident | F2, F3, F7 |
| Evacuation Map | Resident | F11, F6 |
| SOS / Rescue Request | Resident | F10, F12 |
| Hazard & Water Report | Resident / Volunteer | F5, F6, F12 |
| QR Check-In Scanner | Volunteer | F9 |
| Headcount Tracker | Volunteer | F8 |
| Live Rescue Dashboard | Responder / Official | F10, F7 |
| Protocol Admin | Official | F1, F3, F4 |

**Design system constraints carried into build:**

- The 1–5 severity ramp (green → deep red) is reserved exclusively for signal severity. A separate high-visibility accent carries all interactive affordance, so severity colour is never ambiguous.
- Current signal level is ambient on every screen via a persistent severity rail.
- Connection and sync state is persistently visible, never a transient notification.
- All numeric data (counts, timers, coordinates, distances) is set in a monospaced face for instrument-panel legibility.

---

## 10. Release Plan

| Milestone | Contents | Exit criteria |
|---|---|---|
| **M1 — Foundation** | Supabase schema, RLS policies, auth, roles, Next.js shell, PWA scaffold | A resident, volunteer, and official can each sign in and see a role-appropriate empty shell |
| **M2 — Advisory core** | F1, F2, F3 | An official configures a protocol; a resident in that Purok sees the correct instruction in their language |
| **M3 — Offline layer** | F12, plus F11 tile-pack caching | Airplane-mode test: advisory and map render, writes queue, queue flushes in order on reconnect |
| **M4 — Reporting** | F5, F6, F7 | A volunteer report appears on every connected client within 5s |
| **M5 — Rescue** | F10 | An unauthenticated rescue request from a phone appears on the responder map with accurate GPS |
| **M6 — Center ops** | F8, F9 | A center runs a full check-in and headcount cycle offline, then reconciles |
| **M7 — Readiness & support** | F4, F13 | Readiness dashboard reflects true configuration state |
| **M8 — Pilot** | Field trial with one barangay | Success metrics in §3.3 measured against a real or simulated event |

---

## 11. Risks & Mitigations

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Residents never open the app pre-storm, so no cache and no offline map | High | Registration drive tied to QR issuance; readiness dashboard tracks cache rate; barangay announcement campaign |
| R2 | Volunteer reporting is inconsistent, so water-level data is sparse | High | Training as a launch dependency; assign named volunteers per Purok; the readiness checklist tracks volunteer coverage |
| R3 | Official forgets to update the signal level, so residents see stale guidance | High | Cache-age is always visible to residents; prompt officials on new PAGASA bulletins |
| R4 | Tile packs exceed storage on low-end phones | Medium | Disclose size before download; scope tile packs to the barangay boundary only |
| R5 | GPS accuracy degrades indoors or under heavy cloud | Medium | Display `accuracy_m` to responders; allow a free-text location note |
| R6 | Unauthenticated rescue endpoint is abused or flooded | Medium | Rate limiting per IP/device; responders can mark spurious requests `cancelled`; accepted as the cost of FR-10.4 |
| R7 | Two officials edit the same protocol concurrently | Low | Last-write-wins with visible "last edited by / at" metadata |
| R8 | Supabase or Vercel free-tier limits are hit mid-event | Medium | Monitor quotas before season; document the upgrade path |

---

## 12. Known Limitations

Stated explicitly. These are accepted trade-offs, not oversights.

- **Total, prolonged internet blackout.** If Supabase is unreachable for the entire duration of an event, queued writes stay queued and different residents' cached advisory data can silently drift out of sync with each other until connectivity returns. There is no device-to-device fallback.
- **Automated water-level sensing.** Accuracy and timeliness depend entirely on volunteers being present, trained, and reporting consistently. This is a process and people dependency, not one this architecture can close.
- **Adversarial security.** The QR check-in model suits cooperative internal camp coordination. It is not designed to resist a malicious actor forging or replaying check-ins.
- **The SOS responder map needs connectivity.** The Google Maps view responders use requires an active connection to load. If the barangay hall is offline, incoming rescue pins still queue and arrive when signal returns, but there is no offline fallback for that specific view. The resident-facing evacuation map (F11) is unaffected.
- **Unregistered rescue requests cannot always be tied to a named resident**, a direct consequence of the no-login requirement.
- **Offline map tile packs need upfront download and storage.** A resident who never opened the app, or cleared their cache, has no offline map — the same pre-season dependency as protocols, translations, and QR registration.

---

## 13. Out of Scope — Future Roadmap

Acknowledged as valuable, harder problems, intentionally deferred in favour of shipping a working, maintainable system first.

| Item | Why deferred |
|---|---|
| Peer-to-peer local mesh sync (e.g. WebRTC over a barangay-hall WiFi router) for true zero-internet operation | Substantially higher engineering cost and risk |
| On-device computer vision for automated water-level reading from a calibrated landmark photo | Requires model training, calibration, and per-site setup |
| Cryptographically signed offline records for adversarial-resistant identity and data integrity | Custom crypto is an explicit non-goal for v1 |
| Acoustic or other zero-infrastructure fallback channels for isolated residents | Unproven at barangay scale |
| Multi-barangay / municipal aggregation | Pilot is single-barangay scoped |

---

## 14. Open Questions

| ID | Question | Owner | Needed by |
|---|---|---|---|
| Q1 | Which barangay is the pilot site, and what is its actual Purok count and population? | RCGOAT | M2 |
| Q2 | Who is authorized to set the current signal level, and what is the backup if they are unreachable? | Barangay council | M2 |
| Q3 | Which dialects are required at launch beyond Tagalog, Cebuano, and English? | Pilot barangay | M2 |
| Q4 | Are the success metric targets in §3.3 realistic for this barangay? | RCGOAT | M8 |
| Q5 | What is the resident registration process — walk-in at the barangay hall, or house-to-house? | Barangay staff | M6 |
| Q6 | Who owns and maintains the deployment after the pilot ends? | RCGOAT | M8 |
