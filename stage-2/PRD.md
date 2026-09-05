# SalbaBayan

### Product Requirements Document

A barangay-level typhoon early warning and evacuation-coordination Progressive Web App: turns one national storm signal into a street-specific instruction, and keeps working when the network does not.

**Team RCGOAT** — John Micooh Ugot · Nicole Anne Arciaga
**Climate Resilience and Hydrometeorological Disaster Management**

---

## 1. Background

The Philippines experiences about twenty tropical cyclones a year. Two failures stack during a severe one.

**Resolution failure.** PAGASA publishes a signal level at provincial or municipal scale. A resident deciding whether to leave for the evacuation center right now cannot act on a signal number alone — what matters is street-level: which route, which center, by when, in a language they speak. That translation from national category to local instruction does not exist unless someone builds it in advance.

**Delivery failure.** The moment that information is most valuable — the storm worsening, power out, towers down or congested — is exactly when a cloud-dependent system stops being reachable. A warning system that requires connectivity switches itself off during the emergency.

SalbaBayan closes both. The resolution gap closes by making the national-to-local translation a **one-time, in-advance configuration task**: an official populates a Signal Level × Purok lookup table once per season, so nothing is improvised mid-storm. The delivery gap closes by keeping every read cached locally and every write captured on-device first, so an outage degrades the network, not the application.

It does not forecast, and does not predict where flooding will appear. It structures human observation instead of replacing the sensor network a barangay cannot afford (§10).

---

## 2. Product Vision

**The instruction a specific resident needs, in the language they speak, on the phone they already own — still working after the signal drops.**

Governing principle, the inverse of a typical app: **the device is the source of what the user sees right now; the server is the source of what is true.** A read never blocks on the network — it renders from whatever is cached. A write never blocks either — it lands in a local queue immediately and the interface confirms it, regardless of connectivity. The server is where writes eventually reconcile into one shared record, not something a resident waits on at the moment they need help.

This is deliberately **not** peer-to-peer. Every device talks only to Supabase, never to another device — the constraint that keeps the architecture buildable by a two-person team, at the accepted cost in §17: if the backend is unreachable for an entire event, there is no fallback path for new information to spread. SalbaBayan is built for intermittent connectivity, not a total, indefinite blackout.

---

## 3. Governance & Stakeholders

| Stakeholder | Interest | Authority in the system |
|---|---|---|
| **Resident** | A correct, current instruction; a way to call for help | Reads advisory, protocols, map, public reports. Writes own water/hazard reports and own rescue requests. No privileged read. |
| **Volunteer** | Effective, safe ground response | Registered by an official, not self-declared. Submits/resolves reports, updates headcounts and check-ins, updates rescue status. Sees vulnerability tags for triage. |
| **Barangay official** | Accountability for the response | Configures `protocols` and `translations`; sets the current signal level; registers volunteers and residents; resolves any report; oversees dispatch. |
| **PAGASA / NDRRMC** | Authoritative national advisory | Source only. The signal level an official enters is **relayed as reported**, never computed or reinterpreted. |

Role assignment runs through `user_roles`, populated by an official — a resident cannot self-grant `volunteer` or `official`. Row Level Security enforces every boundary at the Postgres layer, so a compromised client cannot write outside its role.

Any official can edit a protocol at any time; edits carry an attributable author and timestamp — last-write-wins with a visible author, not a signature scheme, which stays out of scope (§17). A multi-barangay governance tier is not built in this version; every table and RLS policy is scoped to one barangay.

---

## 4. Scope

Nine core capabilities, all inside one PWA, none optional once built:

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

Two features build only after all nine above are demonstrably working end to end, including offline: **Pre-Storm Readiness Checklist**, **Documentation Knowledge Base**.

There is no separate coordination console. Protocol configuration and the readiness checklist are role-gated views inside the same PWA a resident uses — not a second product built last.

### 4.1 Out of scope

| Item | Why deferred |
|---|---|
| Peer-to-peer local mesh sync for zero-internet operation | Higher engineering cost/risk than a two-person build can carry |
| On-device computer vision for water-level reading | Needs model training, calibration, per-site setup |
| Cryptographically signed offline records | Custom crypto is a non-goal; check-in is cooperative, not adversarial |
| Acoustic / zero-infrastructure fallback channels | Unproven at barangay scale |
| Multi-barangay / municipal aggregation | Governance and RLS both assume one barangay |
| Automated PAGASA feed ingestion | Signal level is entered by an official, not pulled from an API (§10) |
| A native mobile app | A PWA reaches a low-end Android phone with no install step |

---

## 5. Target Users

| Role | Who they are | What they need | What they may see |
|---|---|---|---|
| **Resident** | Low-end Android, prepaid data, variable literacy | The instruction for their street, now; help without logging in first | Advisory, protocols, translations, shared feed, own status |
| **Volunteer** | Trained community member on the ground, not staff | Fast reporting, a triage-ready scanner, a headcount that survives concurrent taps | All of the above, plus every active rescue request and vulnerability tags |
| **Barangay official** | Kagawad or staff, usually at the barangay hall | Translate one national signal into every Purok's instruction before the storm, and see gaps first | Everything, including edit history and the documentation base |

Shared constraints: outdoor glare or darkness, wet or gloved hands, high stress, degraded connectivity, no tolerance for a screen that requires reading a paragraph to act.

---

## 6. Design Language & Crisis UX

A single high-contrast, near-black interface by design, not a toggle — the real operating condition is a storm at night on a dying battery, not a lit office.

- **Severity is constant and exclusive.** A fixed five-state ramp — green through deep red, Signal 1–5 — carries meaning nowhere else. A separate accent colour handles every interactive control, so colour never means two things at once. The current level rides a persistent rail across every screen.
- Instructions are stated as action, not measurement — *"Lumikas na"* (evacuate now), not a bare signal number.
- Water-level reporting uses a body-referenced scale — knee, waist, chest, above the head — the reading an untrained person under stress gives reliably, with no typing.
- Irreversible actions (cancelling a rescue request) require a deliberate hold, so a mis-tap cannot withdraw a distress call.
- Connection and sync state — cache age, queued-write count — is always visible, never a toast that disappears.
- Numeric data is set in a monospaced face, read at a glance. All targets meet 44px minimum; the busiest controls (headcount +1/−1) sit in the thumb zone.

---

## 7. Core Features

Each lists its key functional requirements (FR) and one observable acceptance criterion (AC). Full requirement set in [`PRD-detailed.md`](PRD-detailed.md).

**7.1 Evacuation Protocol Mapping & Public Advisory** — *As a resident, I want to see what my barangay's signal level means for my street, without interpreting a bulletin myself.*
- FR Officials populate a Signal × Purok table: route, geometry, evacuation center, plain-language action.
- FR A single `current_signal_level` value, set by an official, is what every advisory joins against.
- FR Coverage renders as a Purok × Signal matrix; unconfigured cells are flagged before the storm.
- FR Evacuation-level signals show a leave-by deadline and remaining time.

**AC** Offline, a resident in a configured Purok sees the correct route, center, and action for the last synced signal level.

**7.2 Localized-Language Alerts** — *As a Cebuano-speaking resident, I want every instruction in my dialect.*
- FR Every message resolves through `translations` by key + selected language; adding a dialect is data entry, not code.
- FR Launch languages: Tagalog, Cebuano, English. Missing strings fall back to a default language, never blank.

**AC** Switching language re-renders the current instruction correctly with no reload.

**7.3 Offline-First Client** — *As a resident mid-storm, I want correct information and an accepted report with no signal.*
- FR One reusable utility wraps every write: attempt a direct Supabase write, on failure enqueue in Dexie/IndexedDB.
- FR A background listener flushes the queue **in order** on reconnect.
- FR The Service Worker precaches the **app shell**, not just data — a data cache alone does not survive an offline reload.
- FR The interface never blocks on network; queued-write count and cache age stay visible.

**AC** In airplane mode: the app reloads to a working interface, the cached advisory shows its age, and a new write is accepted and confirmed immediately.

**7.4 One-Tap SOS & Live Rescue Map** — *As someone in danger, I want to call for help in one tap, with no login in the way.*
- FR One control captures GPS and writes a rescue request through the same offline queue.
- FR **No authentication required to create a request.**
- FR Resident sees state — pending → acknowledged → rescued — plus elapsed time and responder identity.
- FR Cancelling requires a deliberate hold, not a tap.
- FR Responders see every active request on a live map via Realtime, sorted by wait time; oldest unassigned is escalated.

**AC** A request raised offline queues locally, confirms to the sender, and reaches the responder map with accurate coordinates within seconds of reconnecting.

**7.5 Interactive Offline Evacuation Map** — *As a resident on the move, I want my position, boundary, and route with zero connection.*
- FR MapLibre renders live GPS, Purok boundary, and the routing line to the assigned center.
- FR Base tiles, boundaries, and routes are pre-downloaded tile packs cached in the Service Worker — not fetched live.
- FR Active hazards plot on the route and warn when they block the assigned path.

**AC** With tile packs downloaded and the device in airplane mode, the map opens, pans, and renders the boundary and route correctly.

**7.6 Community Water-Level Reporting** — *As anyone standing in rising water, I want to report it in seconds without a measurement I can't take precisely.*
- FR A report captures Purok, a location label, and a depth from the body-referenced scale — no numeric entry.
- FR Open to residents and volunteers; every report is timestamped and attributable. No calibration required.

**AC** A submitted report appears on a second connected device within five seconds, no refresh.

**7.7 Community Hazard Reports & Realtime Aggregation** — *As anyone in the barangay, I want to know instantly about a blocked road nearby.*
- FR Categories: fallen tree, blocked road, downed lines, flooding, other. Optional photo; no moderation queue.
- FR Any report resolvable by its reporter, a volunteer, or an official.
- FR Realtime subscriptions push reports, protocols, and rescue requests to every client — no polling.

**AC** A hazard reported offline appears in every connected client's feed within five seconds of the reporter reconnecting.

**7.8 Evacuation Center Headcount Tracking** — *As a volunteer running a center, I want a count I can trust with two people tapping at once.*
- FR +1/−1 controls write an **append-only** ledger row; the count is `SUM(delta)`, concurrency-safe by construction.
- FR Displays against capacity with a warning near full, broken down by vulnerability tag.

**AC** Two simultaneous `+1` taps from different devices both land as separate rows, and the total reflects both.

**7.9 Resident Check-In via QR** — *As a volunteer at the gate, I want to scan a resident and see who needs extra help, at a glance.*
- FR A static `qr_token` per resident, decoded by `jsqr` via the camera; vulnerability tags surface on scan.
- FR Volunteer logs checked-in / evacuated / needs-help. Security is token uniqueness plus RLS — cooperative, not adversarial (§9).

**AC** With the camera unavailable, a manual token-entry fallback produces the same check-in result.

---

## 8. Accessibility & Inclusion

- **Language.** Tagalog and Cebuano at launch, English as fallback, on every screen — never hardcoded. New dialects are data entry.
- **Literacy.** The depth scale and hazard tiles are icon-driven; no core path requires typing.
- **Vision.** 4.5:1 text contrast, 3:1 on severity fills; a text-size control exists; severity is carried by numeral and word, never colour alone.
- **Motor.** 44px minimum targets; busiest controls in the thumb zone; no gesture is the only route to an action.
- **Device inclusion.** Runs on a low-end Android phone in Chrome, no install step — the reason for a PWA over a native app.

---

## 9. Privacy & Consent

A resident provides a name and Purok once, at registration, for a QR token. No email or password gates the core advisory, map, or SOS paths.

**Two deliberately different trust models coexist.** A rescue request needs **no identity at all** (§7.4) — a resident in danger must never be blocked by a login screen. QR check-in requires prior registration, because it exists to know who is present at a physical center. These are not the same threat model, and the product does not pretend they are: check-in is cooperative-trust, explicitly not designed to resist a forged or replayed token.

**Sensitive fields are role-scoped by RLS, not just hidden by the UI.** `vulnerability_tags` are readable only by `volunteer` and `official` roles at the database layer.

**Deletion is tractable, by architecture.** One source of truth, no peer replication, means a deletion request removes a row everywhere — none of the "copies on a stranger's phone can't be recalled" limitation a mesh design would carry.

**Regulatory position.** The barangay (or the LGU behind it) is the practical data controller under the Data Privacy Act (RA 10173). A privacy review is a prerequisite before any deployment beyond the pilot barangay.

---

## 10. Data Sources

| Source | Provides | Trust treatment |
|---|---|---|
| Resident & volunteer reports | Street-level water and hazard conditions | Raw human observation, timestamped and attributable, presented as reported |
| Barangay officials | Protocols, translations, evac centers, signal level | Authoritative for this barangay; edits are attributable, not signed |
| PAGASA / NDRRMC | National signal level and bulletins | **Relayed, never derived.** An official reads the bulletin and sets the level manually — no automated feed ingestion in this version |
| Purok boundary & route geometry | Map overlay data | Entered by officials during protocol setup, not sourced from external GIS in v1 |
| MapLibre / vector tile packs | Offline base map | Pre-downloaded per barangay, bundled into the Service Worker cache |

---

## 11. Architecture

**Centralized, not event-sourced, not peer-to-peer.** Supabase (Postgres) is the single source of truth. Every device talks only to Supabase, never to another device — removing the need for any conflict resolution beyond "retry the queued write when back online." A deliberate trade of zero-infrastructure resilience for a system a small team can build, test, and reason about.

**Local-first for writes, cloud-first for truth.** The client never blocks the UI on a network call. Writes attempt directly, then queue in IndexedDB on failure; reads render from Service Worker cache, then update live via Realtime once connected.

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js (App Router) + React + Tailwind | Mainstream, fast to build |
| Backend | Supabase — Postgres, Auth, Realtime, RLS | No custom backend server |
| Hosting | Vercel | Zero-config deploy, free tier covers pilot |
| Offline | `next-pwa` + Dexie.js (IndexedDB) | Standard PWA caching, simple queue API |
| Offline map | MapLibre GL JS + cached tile packs | Data the device already has |
| QR check-in | `qrcode` + `jsqr` | Lightweight, no native app, no custom crypto |
| Rescue map | Geolocation API + Google Maps JS API | One-tap capture plus a live responder view |

Role enforcement lives at the database, not the client — RLS holds even against a modified client (§3, §9). **If the backend is unreachable for an entire event:** new information cannot spread between devices at all. **What survives:** every cached read, and every write, queued safely on-device until reconnect. Stated here, not discovered mid-storm.

---

## 12. Data Flow

**Creating a write.** The user acts. The client attempts a direct Supabase write immediately; on success, Realtime pushes it to every subscribed client. On failure, the payload enqueues in IndexedDB with a stable client-generated ID, and the interface confirms the action either way — the tap never waits on the network.

**Flushing the queue.** A background listener flushes queued writes **in order** on reconnect. The stable ID makes a retried flush a no-op if the row already landed, not a duplicate.

**Reading.** The Service Worker serves cached GETs first (advisory, protocols, translations, tiles). Connected, a Realtime subscription pushes any change immediately — no client polls.

**The offline path, concretely.** A resident with no signal opens the app: the shell loads from the precached bundle, the advisory renders from the last cached protocol, labelled with its age. They tap SOS — GPS captured, request queued, interface confirms it was sent, accurately: durably queued, not lost. Minutes later, thirty seconds of signal returns. The queue flushes; the request lands in Postgres; Realtime pushes it to the responder map with an elapsed timer running from the original tap, not from arrival.

---

## 13. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-1 | Every core resident path (advisory, map, SOS) functions with zero connection — offline is the default, not a degraded mode |
| NFR-2 | Advisory renders from cache in under 1s on a cold, offline start |
| NFR-3 | A rescue write enqueues in under 200ms from tap, independent of network |
| NFR-4 | Realtime updates reach connected clients in under 5s |
| NFR-5 | Role-based access is enforced by Postgres RLS, not only the client UI |
| NFR-6 | Interactive targets meet a 44px minimum; primary controls suit wet or gloved hands |
| NFR-7 | Connection/sync state is always visible, never implied or hidden in a toast |
| NFR-8 | The Service Worker precaches the full app shell, so an offline reload never fails |
| NFR-9 | Runs entirely on free/low-cost Supabase and Vercel tiers at pilot scale |
| NFR-10 | Location data is captured only on an explicit rescue request, never passively tracked |

---

## 14. Error Handling

- **Write fails offline.** Captured into the queue automatically; the action succeeds locally, queued-write count visible — never a raw error for a condition the queue already handles.
- **Retried flush after partial success.** A stable client-generated ID makes re-sending a landed item a harmless no-op.
- **GPS unavailable or denied.** Falls back to a free-text location label rather than blocking; `accuracy_m` shown to responders.
- **Camera fails for QR check-in.** A manual token-entry fallback sits beside the scanner (§7.9).
- **No signal level ever set.** Advisory shows an explicit "not configured" state, never a default number — no false severity or false calm.
- **Missing translation.** Falls back to a default language (§7.2), never blank text.
- **Unauthenticated SOS endpoint abused or flooded.** Rate-limited per device/IP; a responder can mark a request `cancelled`. Accepted trade-off for removing the login barrier (§7.4, §17), not fully solved.
- **Photo upload fails.** Stays a local blob, retries on the next connection window; the report is never blocked on it.

---

## 15. Testing Approach

**Airplane-mode test, as standing practice.** Every build that touches a core path is verified offline the day it lands, not assembled and tested only before a demo.

- **RLS-per-role test**, against the database directly: a resident cannot write `protocols`; a volunteer cannot see tags outside a scan context; an unauthenticated client can create a `rescue_request` and nothing else. Privacy claims are tested, not asserted.
- **Concurrency test** on the headcount ledger — simultaneous writes from two clients, confirm the summed total reflects both.
- **Realtime latency test** against the NFR-4 five-second budget.
- **Offline-reload test** — a full page reload in airplane mode boots the app shell (NFR-8), a different and easy-to-miss failure mode from "cached data renders inside an already-loaded page."
- **Seeded fixtures from day one.** An empty barangay demos and debugs worse.

**Named gap.** No field test yet on a real low-end Android device outdoors, and no pilot barangay has confirmed real Purok counts or volunteer availability. Stated open (§17), not assumed complete.

---

## 16. Success Metrics

| Metric | Target |
|---|---|
| Protocol coverage before storm season | 100% of Puroks × Signal Levels 1–5 |
| Resident registration | ≥ 60% of households registered with a QR |
| Pre-storm cache rate | ≥ 80% of residents opened the app in the 72h before landfall |
| Offline write loss | Zero queued writes lost across an event |
| Rescue acknowledgement time | Median under 10 minutes |
| Headcount accuracy | Within ±3 of a manual count at reconciliation |
| Report volume | ≥ 1 water-level report per Purok per 3h during an event |
| Advisory load time offline | Under 1s, cold start (NFR-2) |

Targets are proposed, pending confirmation against the pilot barangay's real population and volunteer capacity (§17).

---

## 17. Assumptions & Dependencies

**Assumptions**
- An official sets and updates the signal level promptly. A **single point of failure by design** (§10) — if they're unreachable, the advisory is stale until the next update, and the app can only disclose that, not correct it.
- Residents open the app before a storm, so there is something to cache. One who never opens it has no offline advisory and no offline map.
- Volunteers report consistently; reporting is episodic and depends on presence — a people dependency the architecture cannot close alone.
- A barangay registers volunteers and residents before or between events, not during one.
- Phones retain enough charge and storage; nothing here manages either beyond disclosing tile-pack size before download.

**Dependencies**
- Supabase and Vercel free-tier quotas hold at pilot scale, monitored before storm season with a documented upgrade path.
- Geolocation permission is granted; a denial degrades to the manual-label fallback (§14).
- The Google Maps JavaScript API stays available and in-quota — the one non-open-source, non-self-hosted piece here.
- Barangay staff availability for pre-season configuration; the readiness checklist exists to surface whether this was met.

**Two limits stated rather than designed around.** The system cannot verify a signal level entered by an official actually matches the current bulletin — it relays what is typed, honestly, no more. And the unauthenticated rescue endpoint (§7.4) trades verifiability for accessibility: a request cannot always be tied to a named, verified resident (§9). Both are consequences of choices made deliberately elsewhere in this document, and both are accepted.

---

*Full requirement IDs, permission matrix, data model, and risk register: [`PRD-detailed.md`](PRD-detailed.md). Wireframes and design language: [`design/`](design/).*
