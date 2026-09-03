# SalbaBayan

### Product Requirements Document

A barangay-level typhoon early warning and evacuation-coordination Progressive Web App, designed to turn one national storm signal into a street-specific instruction and to keep working when the network does not.

**Team RCGOAT** — John Micooh Ugot · Nicole Anne Arciaga
**Climate Resilience and Hydrometeorological Disaster Management**

---

## 1. Background

The Philippines experiences about twenty tropical cyclones a year. Two failures stack during a severe one.

**Resolution failure.** PAGASA publishes a signal level at the scale of a province or municipality. A resident deciding whether to leave for the evacuation center right now cannot act on a signal number alone — the information that matters is street-level: which route, which center, by when, in a language they actually speak. That translation from national category to local instruction does not exist unless someone builds it in advance.

**Delivery failure.** The moment that information becomes most valuable — the storm is worsening, power is out, towers are down or congested — is exactly when a cloud-dependent system stops being reachable. A warning system that requires connectivity switches itself off during the emergency.

SalbaBayan addresses both, deliberately, in that order. It closes the resolution gap by making the national-to-local translation a **one-time, in-advance configuration task**: a barangay official populates a Signal Level × Purok lookup table once per season, so nothing is improvised mid-storm. It closes the delivery gap by keeping every read available from a local cache and every write captured on the device first, so an outage degrades the network, not the application.

It does not forecast. It does not predict where flooding will appear. It does not replace the human water-level sensor a barangay cannot afford — it structures that human observation instead, discussed under Data Sources.

---

## 2. Product Vision

**The instruction a specific resident needs, in the language they speak, delivered on the phone they already own — and it still works after the signal drops.**

The governing architectural principle is the inverse of a typical app: **the device is the source of what the user sees right now, the server is the source of what is true.** A read never blocks on the network — it renders from whatever the Service Worker has cached. A write never blocks on the network either — it lands in a local queue immediately and the interface confirms it, regardless of connectivity. The server is where every write eventually reconciles into the single record everyone shares, not something the resident has to wait for at the moment they need help.

This is deliberately **not** a peer-to-peer system. Every device talks only to Supabase, never to another device. That constraint is what keeps the architecture simple enough for a two-person team to build and maintain, at the accepted cost stated in §17: if the backend itself is unreachable for the full duration of an event, there is no fallback path for new information to spread. SalbaBayan is built for the realistic case — intermittent connectivity — not for a total, indefinite blackout.

---

## 3. Governance & Stakeholders

| Stakeholder | Interest | Authority in the system |
|---|---|---|
| **Resident** | A correct, current instruction; a way to call for help | Reads advisory, protocols, map, public reports. Writes own water/hazard reports and own rescue requests. No privileged read. |
| **Volunteer** | Effective, safe ground response | Registered by an official, not self-declared. Submits and resolves reports, updates headcounts and check-ins, updates rescue-request status. Sees vulnerability tags for triage; never assigns roles. |
| **Barangay official** | Accountability for the barangay's response | Configures `protocols` and `translations`; sets the current signal level; registers volunteers and residents; can resolve any report; oversees rescue dispatch. |
| **PAGASA / NDRRMC** | Authoritative national advisory | Source only. The signal level an official enters is **relayed as reported**, never computed or reinterpreted by SalbaBayan. |

**Custody and control.** Role assignment happens through the `user_roles` table, populated by an official — a resident cannot grant themselves `volunteer` or `official` status by filling in a form. Row Level Security enforces every boundary in this table at the Postgres layer, so a compromised or modified client still cannot write outside its role (see §4.2 of `PRD-detailed.md` for the full matrix).

**Escalation.** Any official can edit a protocol at any time; edits carry `signal_set_by` / `signal_set_at` (or the equivalent audit fields on `protocols`) so a change is always attributable. This is last-write-wins with a visible author, not a dual-signature or cryptographic scheme — appropriate for a barangay-hall trust model, and an explicit non-goal to build anything heavier (§17).

**Single-barangay scope.** A municipal or multi-barangay governance tier (an LGU/MDRRMO layer coordinating several barangays) is not built in this version. Every table and every RLS policy is scoped to one barangay.

---

## 4. Scope

Nine core capabilities, all delivered inside one PWA, none of them optional once built:

| # | Feature |
|---|---|
| 1 | Evacuation Protocol Mapping & Public Advisory |
| 2 | Localized-Language Alerts |
| 3 | Offline-First Client |
| 4 | One-Tap SOS & Live Rescue Map |
| 5 | Interactive Offline Evacuation Map |
| 6 | Community Water-Level Reporting |
| 7 | Community Hazard Reports & Realtime Aggregation |
| 8 | Evacuation Center Headcount Tracking |
| 9 | Resident Check-In via QR |

Two features are built only once all nine above are demonstrably working end to end, including offline:

| # | Feature |
|---|---|
| 10 | Pre-Storm Readiness Checklist |
| 11 | Documentation Knowledge Base |

There is no separate coordination console for officials. Protocol configuration, the readiness checklist, and the documentation base are role-gated views inside the same PWA a resident uses — not a second product built last, unlike a typical admin-dashboard split. Every core feature must work with the admin surface closed.

### 4.1 Out of scope

Acknowledged as valuable, harder problems, deferred so a working, maintainable system ships first.

| Item | Why deferred |
|---|---|
| Peer-to-peer local mesh sync (e.g. WebRTC over a barangay-hall WiFi router) for zero-internet operation | Substantially higher engineering cost and risk than a two-person team can carry in this build |
| On-device computer vision for automated water-level reading from a calibrated landmark photo | Requires model training, calibration, and per-site setup |
| Cryptographically signed offline records for adversarial-resistant identity | Custom cryptography is an explicit non-goal; the QR check-in threat model is cooperative, not adversarial |
| Acoustic or other zero-infrastructure fallback channels for isolated residents | Unproven at barangay scale |
| Multi-barangay / municipal aggregation | Governance and RLS scoping both assume one barangay |
| Automated PAGASA feed ingestion | The current signal level is entered by an official, not pulled from an API — see §10 |
| A native mobile app | A PWA reaches a low-end Android phone with no install step and no app-store gate |

---

## 5. Target Users

| Role | Who they are | What they need | What they may see |
|---|---|---|---|
| **Resident** | Anyone in the barangay. Likely a low-end Android phone, prepaid data, and variable literacy | The one instruction for their street, right now; a way to call for help that never asks them to log in first | Public advisory, protocols, translations, the shared hazard/water feed, their own check-in and rescue-request status |
| **Volunteer** | A trained community member present on the ground during the event, not barangay staff | A fast reporting form, a triage-ready check-in scanner, a headcount counter that survives concurrent taps | Everything a resident sees, plus every active rescue request and every resident's vulnerability tags for triage |
| **Barangay official** | Kagawad or barangay staff, typically working from the barangay hall | The ability to translate one national signal into every Purok's instruction before the storm, and to see gaps before they become failures | Everything, including the documentation base and full protocol edit history |

Constraints shared by residents and volunteers: outdoor glare or total darkness, wet or gloved hands, high stress, frequently degraded connectivity, and no tolerance for a screen that requires reading a paragraph to act on.

---

## 6. Design Language & Crisis UX

A single high-contrast, near-black interface by design — not a "dark mode" toggle, because the product's real operating condition is a storm at night with a dying battery, not a well-lit office. The same visual language runs on every screen, at every signal level.

**Severity is constant and exclusive.** A fixed five-state ramp — green through deep red for Signal 1 through 5 — carries meaning nowhere else in the interface. A separate high-visibility accent colour handles every interactive control (buttons, links, active tabs), so a resident never has to ask whether an orange element means "tap this" or "this is dangerous." The current signal level rides as a thin, persistent colour rail across the top of every screen, so severity is ambient rather than something the user has to go find.

**Crisis UX rules, carried from the wireframes into every future screen:**

- Severity is stated as an instruction, not a measurement — *"Lumikas na"* (evacuate now), not a raw signal number alone.
- Water-level reporting uses a body-referenced depth scale — knee, waist, chest, above the head — because that is the reading an untrained person under stress can give reliably, and it requires no typing.
- Every irreversible action (cancelling a rescue request) requires a deliberate hold, not a single tap, so a panicked mis-tap cannot withdraw a distress call.
- Connection and sync state — cache age, queued-write count — is always visible in the interface, never a toast that disappears.
- Numeric data (counts, timers, coordinates, distances) is set in a monospaced face, read at a glance like an instrument panel rather than parsed as prose.
- All interactive targets meet a 44px minimum, and the busiest controls (evacuation-center headcount +1/−1) are sized larger still and placed in the thumb zone.

---

## 7. Core Features

Each feature below lists its functional requirements (FR) and one observable acceptance criterion (AC). The complete requirement set, including P1 and Tier-4 items, is in [`PRD-detailed.md`](PRD-detailed.md).

### 7.1 Evacuation Protocol Mapping & Public Advisory

> As a resident, I want to see exactly what my barangay's current signal level means for my street, so I know what to do without interpreting a national bulletin myself.

- **FR-1.1** Officials populate a Signal Level (1–5) × Purok lookup table: route, route geometry, assigned evacuation center, and a plain-language action.
- **FR-1.2** The current signal level is a single value an official sets when a PAGASA bulletin arrives; every advisory query joins against it.
- **FR-1.3** A resident's advisory view joins the current signal level against their own Purok's protocol row.
- **FR-1.4** The admin view renders coverage as a Purok × Signal matrix, with any unconfigured cell visibly flagged before the storm, not during it.
- **FR-1.5** For evacuation-level signals, the view shows a leave-by deadline and remaining time.

**AC-1** With the device in airplane mode, a resident in a configured Purok sees the correct route, center, and action text for the last signal level synced to their device.

### 7.2 Localized-Language Alerts

> As a resident who is more comfortable in Cebuano than Tagalog, I want every instruction in my own dialect, so nothing is lost in translation at the moment it matters.

- **FR-2.1** Every displayed message resolves through a `translations` table by message key and the resident's selected language.
- **FR-2.2** Adding a dialect is a data-entry task, never a code change.
- **FR-2.3** Launch languages: Tagalog, Cebuano, English.
- **FR-2.4** A missing string in the selected language falls back to a configured default language rather than rendering blank.

**AC-2** Switching the language control re-renders the current advisory instruction correctly in the newly selected language, with no reload.

### 7.3 Offline-First Client

> As a resident during a storm, I want the app to still show me correct information and still accept my report, even with no signal.

- **FR-3.1** A single reusable utility wraps every write action: attempt a direct Supabase write; on failure, enqueue the payload in a Dexie.js IndexedDB table.
- **FR-3.2** A background listener flushes the queue **in order** once connectivity returns.
- **FR-3.3** The Service Worker **precaches the application shell** (document, JS/CSS bundles, fonts) in addition to advisory, protocol, and translation data — a data cache alone does not survive a full page reload while offline.
- **FR-3.4** The interface never blocks on a network call; no user action waits on a spinner tied to connectivity.
- **FR-3.5** Queued-write count and cache age are persistently visible, never a transient notification.

**AC-3** With the device in airplane mode: the app reloads to a working interface (not a browser error page), the last-cached advisory renders with its cache age shown, and a new write is accepted and confirmed to the user immediately.

### 7.4 One-Tap SOS & Live Rescue Map

> As someone in danger, I want to call for help in one tap and know it was received, without a login screen standing between me and that tap.

- **FR-4.1** A single prominent control captures GPS (`getCurrentPosition`, falling back to `watchPosition` while the request stays open) and writes a rescue request through the same offline queue as every other action.
- **FR-4.2** **No authentication is required to create a request.**
- **FR-4.3** The resident sees request state — pending → acknowledged → rescued — plus elapsed time and, once assigned, who is responding.
- **FR-4.4** Cancelling a request requires a deliberate hold, not a tap, so a mis-tap cannot withdraw a distress call.
- **FR-4.5** Volunteers and officials see every `pending`/`acknowledged` request on a live map via Supabase Realtime, sorted by wait time, with the oldest unassigned request escalated.
- **FR-4.6** A responder marks `acknowledged` on dispatch and `rescued` on completion.

**AC-4** A request raised on a device in airplane mode queues locally, confirms to the sender immediately, and appears on the responder's live map with accurate coordinates within seconds of the device regaining a connection.

### 7.5 Interactive Offline Evacuation Map

> As a resident on the move, I want to see my position, my Purok's boundary, and my route to safety, even with zero connection.

- **FR-5.1** MapLibre GL renders the resident's live GPS position, the Purok boundary polygon, and the routing line to the assigned evacuation center.
- **FR-5.2** Base map tiles, boundaries, and routes are downloaded as tile packs and cached in the Service Worker's Cache Storage — **not** fetched live.
- **FR-5.3** Active hazard reports plot onto the route and warn the resident when a hazard blocks their assigned path.
- **FR-5.4** Destination capacity is shown, so a resident is not routed toward a full center.

**AC-5** With the device in airplane mode and tile packs previously downloaded, the map opens, pans, and renders the boundary and route correctly.

### 7.6 Community Water-Level Reporting

> As a resident or volunteer standing in rising water, I want to report it in seconds without typing a number I'm not equipped to measure precisely.

- **FR-6.1** A report captures Purok, a location label, and a water level chosen from the body-referenced depth scale (knee / waist / chest / above head) — no numeric entry.
- **FR-6.2** Open to both residents and volunteers; every report is timestamped and attributable to its author.
- **FR-6.3** No calibration, computation, or maintenance is required — the raw human observation is the entire signal.

**AC-6** A submitted report appears in the shared feed on a second, already-connected device within five seconds, with no page refresh.

### 7.7 Community Hazard Reports & Realtime Aggregation

> As anyone in the barangay, I want to know instantly about a blocked road or downed line near me, reported by whoever found it first.

- **FR-7.1** Categories: fallen tree, blocked road, downed lines, flooding, other. Captures Purok, free-text description, and an optional photo.
- **FR-7.2** Posts appear instantly in a shared feed with no moderation queue; any report can be marked `resolved` by its reporter, a volunteer, or an official.
- **FR-7.3** Supabase Realtime subscriptions on reports, protocols, and rescue requests push to every connected client — no polling.
- **FR-7.4** A queued photo is held as a local blob until reconnect, since storage uploads also require connectivity.

**AC-7** A hazard reported while offline appears in every connected client's feed within five seconds of the reporting device regaining connectivity, without any client refreshing manually.

### 7.8 Evacuation Center Headcount Tracking

> As a volunteer running a center, I want a count I can trust even when two of us are tapping at once.

- **FR-8.1** Each center has +1/−1 controls writing an **append-only** ledger row — no row is ever overwritten.
- **FR-8.2** The current count is `SUM(delta)` per center, which is concurrency-safe by construction, not by locking.
- **FR-8.3** Count displays against capacity with a visible warning as the center approaches full, broken down by vulnerability tag for triage.

**AC-8** Two simultaneous `+1` taps from different devices both land as separate ledger rows, and the displayed total reflects both.

### 7.9 Resident Check-In via QR

> As a volunteer at the gate, I want to scan a resident in and see who needs extra help, at a glance, in the rain.

- **FR-9.1** Each registered resident has a static `qr_token` and a generated QR image; the scanner decodes with `jsqr` via the device camera.
- **FR-9.2** On scan, `vulnerability_tags` (elderly / infant / medical) surface immediately, colour-weighted for triage.
- **FR-9.3** The volunteer logs a status: checked-in / evacuated / needs-help.
- **FR-9.4** Security model is token uniqueness plus role-scoped RLS — appropriate for cooperative internal camp coordination, explicitly not adversarial-resistant (see §9).

**AC-9** Scanning a registered resident's QR code, with the camera unavailable, falls back to a manual token-entry path that produces the same check-in result.

---

## 8. Accessibility & Inclusion

- **Language.** Tagalog and Cebuano at launch, English as a fallback, on every core screen — never hardcoded prose. Additional dialects (Ilocano, Waray) use the same `translations` mechanism and are a data-entry task, not a rebuild.
- **Literacy.** The water-level depth scale and hazard-category tiles are icon- and picture-driven, answerable without reading a sentence. No core path requires typing.
- **Vision.** Text meets a minimum 4.5:1 contrast ratio against its background; severity fills meet 3:1. A text-size control is available for outdoor and low-vision use. Severity is carried by numeral and word, never colour alone.
- **Motor.** Every interactive target meets a 44px minimum. The busiest controls (headcount +1/−1) sit in the thumb zone. No gesture is the only route to a core action.
- **Device inclusion.** Runs on a low-end Android phone in Chrome with no install step — the entire point of shipping a PWA rather than a native app.

---

## 9. Privacy & Consent

**Minimum collection.** A resident provides a name and Purok once, at registration, to receive a QR token. No email or password is required to use the core advisory, map, or SOS paths.

**Two deliberately different trust models coexist.** A rescue request requires **no** identity at all — creating one is anonymous by design (§7.4), because a resident in danger must never be blocked by a login screen. QR check-in, by contrast, requires prior registration, because it exists to coordinate a physical evacuation center where knowing who is present is the entire point. These are not the same threat model, and the product does not pretend they are: check-in is cooperative-trust, appropriate for internal camp coordination, and explicitly not designed to resist a malicious actor forging or replaying a token.

**Sensitive fields are role-scoped, not merely hidden by the interface.** `vulnerability_tags` are visible only to `volunteer` and `official` roles, enforced by Row Level Security at the database layer — a resident's client cannot read another resident's tags even if the UI were bypassed.

**Consent and deletion are tractable, by architecture.** Because SalbaBayan has exactly one source of truth and no peer-to-peer replication, a deletion request can actually be honored cleanly: removing a row from Supabase removes it everywhere, with none of the "copies already on a stranger's phone cannot be recalled" limitation that a mesh-replicated design would carry. This is a direct consequence of the centralized model chosen in §2, stated here as a benefit rather than assumed silently.

**Regulatory position.** The barangay (or the LGU standing behind it) is the practical data controller under the Data Privacy Act (RA 10173). A privacy review is a prerequisite before any real deployment beyond the pilot barangay, not a step folded into general development.

---

## 10. Data Sources

| Source | Provides | Trust treatment |
|---|---|---|
| Resident & volunteer reports | Street-level water and hazard conditions | Raw human observation, timestamped and attributable. Not corroborated or weighted — presented as reported |
| Barangay officials | Protocols, translations, evacuation center data, the current signal level | Authoritative for this barangay. Officials edit at any time; edits are attributable, not cryptographically signed |
| PAGASA / NDRRMC | National signal level and storm bulletins | **Relayed, never derived.** An official reads the bulletin and manually sets the signal level — SalbaBayan does not ingest a PAGASA feed automatically in this version, and does not compute or reinterpret the signal itself |
| Purok boundary & route geometry | Map overlay data (`boundary_geojson`, `route_geojson`) | Entered by officials during protocol configuration, not sourced from an external GIS feed in v1 |
| MapLibre / vector tile packs | Offline base map | Pre-downloaded per barangay, bundled into the Service Worker cache |

---

## 11. Architecture

**Centralized, not event-sourced, not peer-to-peer.** Supabase (Postgres) is the single source of truth. Every device talks only to Supabase — never to another device — which is precisely what removes the need for any conflict-resolution logic beyond "retry the queued write when back online." This is a deliberate simplification, made explicit because it is the opposite choice from a replicated event-store design: SalbaBayan trades zero-infrastructure resilience for a system a small team can actually build, test, and reason about.

**Local-first for writes, cloud-first for truth.** The client never blocks the UI on a network call. Every write attempts a direct Supabase call; on failure it lands in an IndexedDB queue and the interface confirms it regardless. Every read renders from whatever the Service Worker has cached, then updates live via Realtime once connected.

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js (App Router) + React + Tailwind CSS | Mainstream, fast to build, well-documented |
| Backend | Supabase — Postgres, Auth, Realtime, Row Level Security | Managed Postgres with built-in auth/realtime/RLS; no custom backend server |
| Hosting | Vercel | Zero-config Next.js deploy; free tier covers pilot scale |
| Offline layer | `next-pwa` (Service Worker) + Dexie.js (IndexedDB) | Standard PWA caching plus a simple IndexedDB API |
| Offline map | MapLibre GL JS + cached vector tile packs | Data the device already has, not a live fetch |
| QR check-in | `qrcode` (generation) + `jsqr` (scanning via `getUserMedia`) | Lightweight; no native app, no custom crypto |
| Rescue map | Browser Geolocation API + Google Maps JavaScript API | One-tap GPS capture plus a live responder view |

**Role enforcement lives at the database, not the client.** Every table's RLS policy is written so that even a modified or compromised client cannot write outside the permission matrix in §4.2 of `PRD-detailed.md`.

**What is lost with the backend unreachable for the entire duration of an event:** new information cannot spread between devices at all — there is no relay path. **What survives:** every previously cached read, and every write, sitting safely queued on-device until reconnect. This boundary is stated plainly in §17, not discovered by a user during a real storm.

---

## 12. Data Flow

**Creating a write.** The user acts — submits a report, taps SOS, taps +1. The client attempts a direct Supabase write immediately. On success, the row lands in Postgres and Realtime pushes it to every subscribed client. On failure, the payload is enqueued in a Dexie.js IndexedDB table with a stable client-generated ID, and the interface confirms the action to the user in either case — the tap itself never waits on the network.

**Flushing the queue.** A background listener (`window.ononline`, plus a periodic retry) flushes queued writes **in order** once connectivity returns. Each successful write removes its row from the local queue; a stable client-generated ID lets a retried flush be a no-op if the row already landed, rather than creating a duplicate.

**Reading, online or offline.** The Service Worker serves GET requests for the advisory, protocols, translations, and map tiles from cache first. When connected, a Realtime subscription on the relevant tables pushes any change immediately — no client ever polls for updates.

**The fully offline path, concretely.** A resident with no signal opens the app: the shell loads from the precached Service Worker bundle, the advisory renders from the last cached protocol and signal level, labelled with its cache age. They tap SOS: GPS is captured, the request is written to the local queue, and the interface confirms it was "sent" — accurately, in the sense that it is now durably queued on the device, not lost. Minutes later, connectivity returns for thirty seconds. The queue flushes; the rescue request lands in Postgres; Realtime pushes it to the barangay hall's responder map with an elapsed timer already running from the original tap time, not from the moment it arrived.

---

## 13. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-1 | Every core resident-facing path (advisory, map, SOS) functions with zero network connection; offline is the default assumption, not a degraded mode |
| NFR-2 | The advisory view renders from cache in under 1 second on a cold, offline start |
| NFR-3 | A rescue-request write is enqueued in under 200ms from tap, independent of network state |
| NFR-4 | Realtime updates reach connected clients in under 5 seconds |
| NFR-5 | Role-based access is enforced by Postgres RLS, not only by the client UI |
| NFR-6 | Interactive targets meet a 44px minimum; primary controls are sized for wet or gloved hands |
| NFR-7 | Connection and sync state (cache age, queued-write count) is always visible, never implied or hidden behind a transient toast |
| NFR-8 | The Service Worker precaches the full application shell, not only API data, so an offline reload never fails |
| NFR-9 | The system runs entirely on free or low-cost tiers of Supabase and Vercel at pilot scale, with no dedicated infrastructure to operate |
| NFR-10 | Resident location data is captured only on an explicit rescue request, never passively tracked |

---

## 14. Error Handling

The interface never fails silently on a write, and never implies a delivery it cannot confirm.

- **Write fails against Supabase (offline, or a transient server error).** The payload is captured into the IndexedDB queue automatically; the user sees the action succeed locally, with the queued-write count visible in the header — never a raw error message for a condition the offline queue already handles.
- **A queue flush is retried after partial success.** Each queued item carries a stable client-generated ID, so re-sending an item that already landed is a harmless no-op rather than a duplicate row.
- **GPS is unavailable or permission is denied.** The rescue-request and reporting flows fall back to a free-text location label rather than blocking the action entirely; `accuracy_m` is shown to responders so they can judge precision.
- **Camera access fails for QR check-in** (permission denied, poor lighting, broken hardware). A manual token-entry fallback sits beside the scanner, so check-in is never blocked by camera failure alone (§7.9, AC-9).
- **No signal level has ever been set for the barangay.** The advisory view shows an explicit "not yet configured" state rather than defaulting to any signal number, so a resident is never shown a false sense of severity — or false calm.
- **A translation string is missing for the resident's selected language.** The view falls back to a configured default language (FR-2.4) rather than rendering blank text.
- **The unauthenticated rescue endpoint is abused or flooded.** Requests are rate-limited per device/IP; a responder or official can mark a spurious request `cancelled`. This is an accepted trade-off for removing the login barrier (§7.4, §17), not treated as fully solved.
- **A photo upload fails to sync.** The photo remains a local blob and retries on the next successful connection window; the report itself is never blocked on the photo landing.

---

## 15. Testing Approach

**Airplane-mode test, as a standing practice, not a final check.** Every phase of the build that touches a core path (advisory, map, SOS, reporting) is verified in airplane mode on the day it lands — not assembled and tested for the first time before a demo. A build that has not been opened in airplane mode since its last change to the offline path is considered unverified.

- **RLS-per-role test.** Confirm directly against the database, not just the UI, that a resident's client cannot write to `protocols`, that a volunteer cannot see another resident's `vulnerability_tags` outside a scan context, and that an unauthenticated client can create a `rescue_request` but nothing else. Privacy and permission claims in §9 and §11 are tested, not merely asserted.
- **Concurrency test on the headcount ledger.** Fire simultaneous `+1`/`−1` writes from two clients and confirm the summed total reflects both — this is the check that protects FR-8.2's concurrency-safe-by-construction claim.
- **Realtime latency test.** Confirm a report or status change reaches a second connected client within the NFR-4 five-second budget.
- **Offline-reload test.** Confirm a full page reload in airplane mode boots the app shell correctly (NFR-8), not just that cached data renders inside an already-loaded page — the two are different failure modes and the second one is invisible unless tested explicitly.
- **Seeded fixtures from the start.** An empty barangay with no protocols configured and no sample reports demonstrates nothing and debugs worse; realistic seed data (a named barangay, several Puroks, sample protocols and reports) exists from the first working build.

**Named gap.** No field test has yet been run on a real low-end Android device under real outdoor conditions, and no pilot barangay has confirmed realistic Purok counts, population, or volunteer availability. Both are prerequisites before any claim of real-world readiness, and are stated as open in §17 rather than assumed complete.

---

## 16. Success Metrics

| Metric | Target |
|---|---|
| Protocol coverage before storm season | 100% of Puroks × Signal Levels 1–5 configured |
| Resident registration | ≥ 60% of barangay households registered with a QR |
| Pre-storm cache rate | ≥ 80% of registered residents opened the app in the 72 hours before landfall |
| Offline write loss | Zero queued writes lost across a storm event |
| Rescue acknowledgement time | Median under 10 minutes from request creation to `acknowledged` |
| Headcount accuracy | Center ledger within ±3 of a manual count at post-storm reconciliation |
| Report volume | At least one water-level report per Purok per 3 hours during an active event |
| Advisory load time offline | Under 1 second, cold start, per NFR-2 |

Targets are proposed and require confirmation against the pilot barangay's actual population and volunteer capacity (§17, Q1).

---

## 17. Assumptions & Dependencies

**Assumptions**

- A barangay official will set and update the current signal level promptly as PAGASA bulletins arrive. This is a **single point of failure by design** (§10) — if the official is unreachable or delayed, every resident's advisory is stale until the next update, and the interface can only disclose that staleness, not correct it.
- Residents open the app at least once before a storm, so the Service Worker has something to cache. A resident who never opens the app has no offline advisory and no offline map — the same pre-season dependency as registration itself.
- Volunteers report water levels and hazards consistently enough to be useful. Reporting is episodic and depends on someone being physically present; this is a process and people dependency the architecture cannot close on its own.
- A barangay can register volunteers and residents before or between events, not during one.
- Phones retain enough charge and storage to matter through the event; nothing in this version manages battery or storage beyond disclosing tile-pack size before download.

**Dependencies**

- Supabase and Vercel free-tier quotas remain sufficient at pilot scale; this needs monitoring before storm season, with a documented upgrade path if exceeded.
- Browser Geolocation permission is granted by the resident; a denied permission degrades to the manual location-label fallback in §14.
- The Google Maps JavaScript API remains available and within quota for the responder view — the one component in this architecture that is not open-source or self-hosted.
- Barangay staff availability to complete pre-season protocol and translation configuration; the readiness checklist (Tier-4 feature) exists specifically to surface whether this dependency has been met before the storm arrives.

**Two limits stated rather than designed around.**

First, the system has no way to verify that a signal level entered by an official actually matches the current PAGASA bulletin — it relays what is typed, honestly, and no more. Second, the unauthenticated rescue-request endpoint (§7.4) trades verifiability for accessibility: any device can create a request with no login, which means a request cannot always be tied to a named, verified resident (§9). Both are consequences of choices made deliberately elsewhere in this document, and both are accepted rather than quietly left unstated.

---

*Full requirement IDs (FR/NFR), the complete permission matrix, data model, and risk register live in [`PRD-detailed.md`](PRD-detailed.md). The hackathon-scoped demo plan — golden-path walkthrough, build phases, and standing risks for the live pitch — lives in [`PRD-pitch-brief.md`](PRD-pitch-brief.md).*
