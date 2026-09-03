# SalbaBayan — Hackathon PRD

## 1. Header Information

**Project Name:** SalbaBayan — *"Salba"* (save) + *"Bayan"* (town/nation). Barangay-Level Typhoon Early Warning & Evacuation Coordination System.

**Team:** RCGOAT

**Members:**
- John Micooh Ugot
- Nicole Anne Arciaga

**Hackathon Track/Theme:** Climate Resilience and Hydrometeorological Disaster Management

---

## 2. The Problem & Value Proposition

**Problem Statement:**
The Philippines takes about 20 typhoons a year, and when one hits, the network dies exactly when people need warnings most. Worse, national PAGASA signal levels tell a barangay *what kind of storm* is coming but never tell a specific resident on a specific street *what to actually do*.

**Target User:**

- **Residents** of a flood-prone barangay — on low-end Android phones, variable literacy, under stress, often offline mid-storm.
- **Barangay officials** who must turn one national signal into street-level instructions.
- **Community volunteers** running evacuation centers and responding to rescue calls on the ground.

**The Solution:**
SalbaBayan is a Progressive Web App that turns a national typhoon signal into a specific, street-level instruction for a specific Purok, delivered in the resident's own dialect — and it keeps working when the network doesn't. Officials pre-configure protocols once per season; the app caches everything to the device; every user action is written to a local queue first and syncs the moment a signal returns. No hardware sensors, no mesh networking — the community is the sensor network and the offline cache is the resilience layer.

---

## 3. Core Scope (The MVP)

Features are tiered by build order, not by importance. Tier 1 is the demo spine and must be working and stay working once complete; every later tier layers on top without breaking it.

Bracketed IDs map to the full requirement sets in [`PRD-detailed.md`](PRD-detailed.md).

### In-Scope (Must-Haves)

#### Tier 1 — Demo spine (never allowed to break)

**1. Localized Signal → Purok Advisory** · *F1, F2, F3*
An official sets the barangay's current signal level. Every resident instantly sees the instruction for *their* Purok — evacuation route, assigned center, plain-language action — resolved through a translations table into their chosen dialect. The core value proposition: national data becomes local instruction.

**2. Offline-First Client** · *F12*
The whole app keeps working with zero connection. The Service Worker caches advisory, protocols, and translations for reads. One reusable utility (`lib/offlineQueue.ts`) wraps every write: attempt a direct Supabase write, on failure enqueue in IndexedDB, auto-flush in order on reconnect. The differentiator, and the most memorable thing in the demo because it is done live in airplane mode.

**3. One-Tap SOS + Live Rescue Map** · *F10*
A resident in danger taps one button — no login required. GPS is captured and the request is written through the same offline queue. Responders see every active request appear live on a map via Supabase Realtime and mark it acknowledged, which pushes back to the resident's phone.

**4. Interactive Offline Evacuation Map** · *F11*
MapLibre GL base map with the resident's live GPS position, Purok boundary polygons, and the routing line to their assigned center — all rendering from pre-cached tile packs with **zero connection**. This is the visual proof that "offline-first" is real and not a slogan.

#### Tier 2 — Ground truth layer

**5. Community Water-Level Reporting** · *F5*
Purok, location label, and a body-referenced depth scale (knee / waist / chest / above head), auto-timestamped. Open to residents and volunteers. This is the feature that demonstrates the sensor-affordability gap — *the community is the sensor network* — and without it that founding claim goes unproven in the demo.

**6. Community Hazard Reports** · *F6*
Categories (fallen tree, blocked road, downed lines, flooding, other), Purok, description, optional photo. Instant shared feed, no moderation queue. Resolvable by reporter, volunteer, or official. Hazards plot onto the evacuation map and flag affected routes.

**7. Realtime Alert Aggregation** · *F7*
Supabase Realtime subscriptions on `water_reports`, `hazard_reports`, `protocols`, and `rescue_requests`. Push, never poll.

#### Tier 3 — Evacuation center operations

**8. Evacuation Center Headcount Tracking** · *F8*
Append-only `+1`/`−1` ledger per center; count is `SUM(delta)`, concurrency-safe by construction. Capacity warning state, vulnerability breakdown for triage.

**9. Resident Check-In via QR** · *F9*
Static `qr_token` per registered resident, scanned by volunteers with `jsqr` via the device camera. Vulnerability tags surface on scan for triage. Status: checked-in / evacuated / needs-help.

#### Tier 4 — Build only if Tiers 1–3 are stable

**10. Pre-Storm Readiness Checklist** · *F4* — pure read-side aggregation over existing tables; flags Puroks with no protocol configured.
**11. Documentation Knowledge Base** · *F13* — `scripts/ingest-docs.ts` upserts `/docs/*.md` into `documents`; admin-only render page.

### Out-of-Scope (Nice-to-Haves)

Acknowledged as valuable, harder problems, intentionally deferred in favour of shipping a working, maintainable system first.

| Item | Why deferred |
|---|---|
| Peer-to-peer local mesh sync (e.g. WebRTC over a barangay-hall WiFi router) for true zero-internet operation | Substantially higher engineering cost and risk |
| On-device computer vision for automated water-level reading from a calibrated landmark photo | Requires model training, calibration, and per-site setup |
| Cryptographically signed offline records for adversarial-resistant identity and data integrity | Custom crypto is an explicit non-goal for v1 |
| Acoustic or other zero-infrastructure fallback channels for isolated residents | Unproven at barangay scale |
| Multi-barangay / municipal aggregation | Pilot is single-barangay scoped |

### Scope discipline rules

1. **Vertical slice first.** The first phase ends with one thin path working end to end, not four half-built features.
2. **The demo path stays green.** If a Tier 2+ change breaks Tier 1, it gets reverted, not debugged under pressure.
3. **Feature freeze before the hardening phase.** Once hardening starts it is polish, seed data, and rehearsal only — no new features, no exceptions.
4. **A tier is only "done" when it works offline**, because offline is the product, not a mode.

---

## 4. User Flow & Key Features

### The "Golden Path" Flow

One unbroken run. Two devices: a phone (resident / volunteer) and a laptop (official / responder). Roughly 3 minutes at the short cut, ~5 with the Tier 2–3 beats included.

**Core spine — always demoed, never cut:**

1. **Official sets the signal.** On the laptop admin panel, official picks Barangay San Isidro and sets **Signal No. 3**. The Purok × Signal coverage matrix shows every Purok configured.
2. **Resident sees their instruction.** On the phone, the home screen turns Signal-3 orange: *"LUMIKAS NA — Pumunta na sa evacuation center. Huwag hintayin ang dilim."* Route to Barangay Gym, 850m, leave-by countdown running.
3. **Switch the dialect.** Tap the language control — the same instruction re-renders in Cebuano. Nothing hardcoded; it resolved from the `translations` table.
4. **Open the evacuation map.** Live GPS position, Purok boundary, routing line to the Gym, next-turn guidance.
5. **Kill the network.** Airplane mode on. Reload the app. Advisory *and map* are still there — tiles, boundaries, and route served from cache, labelled with cache age.
6. **Tap SOS while offline.** Resident taps "I need rescue." GPS captured, request queued in IndexedDB, UI confirms immediately — never spins, never blocks, never fails. Header shows the queued-write count.
7. **Restore the network.** Airplane mode off. Queue auto-flushes in order.
8. **The pin appears live.** On the responder dashboard the rescue pin drops onto the map via Realtime, elapsed timer running — no refresh, no polling.
9. **Responder acknowledges.** Click Acknowledge. The resident's phone updates to *"NAKUMPIRMA"* with the assigned team name.

**The line at step 6:** *"That tap happened with no internet. Watch what happens when the signal comes back."*

**Extended beats — included when time allows, and in the full-stage submission:**

10. **A volunteer reports rising water.** Depth picker: taps *Baywang* (waist-high) at Mabini St. Report posts to the shared feed and appears on every connected device instantly — *this is the community acting as the sensor network, with no hardware.*
11. **The hazard reroutes people.** A blocked-road hazard on Mabini St. surfaces on the resident's evacuation map with an *IWASAN* (avoid) warning against the assigned route.
12. **Check-in at the center.** Volunteer scans a resident's QR; the vulnerability tags (*Matanda*, *Medical*) surface immediately for triage; status logged.
13. **Headcount ticks up.** `+1` on the append-only ledger; center count moves 68 → 69 against a capacity of 150.

### Feature Breakdown

What each step needs technically.

**Step 1 — Official sets signal**
- `protocols` table seeded with (Purok × signal_level 1–5) rows: route, `route_geojson`, `evac_center_id`, `action_key`
- Admin form writes `barangays.current_signal_level` (plus `signal_set_at` / `signal_set_by`) — this is the single value every advisory query joins against
- RLS policy: only `official` role can write `protocols` and the barangay signal level

**Step 2 — Resident advisory**
- Query joins current signal level against the resident's `purok_id` in `protocols`
- Resolves `action_key` through `translations` by `message_key` + language
- Severity ramp (1–5, green to deep red) reserved exclusively for signal colour
- Renders assigned `evac_center`, distance, leave-by deadline

**Step 3 — Dialect switch**
- `translations` table: `{message_key, language, text}`
- Language switch is a data lookup, not a code path; adding a dialect is data entry
- Launch languages: Tagalog, Cebuano, English

**Step 4 — Evacuation map**
- MapLibre GL JS base map; `puroks.boundary_geojson` as boundary overlay; `protocols.route_geojson` as routing line
- Live position from `navigator.geolocation`

**Step 5 — Offline read**
- **App shell precached** — Next.js document, JS/CSS bundles, fonts, icons. Without this a reload in airplane mode hits a browser error page and the demo dies here. Data caching alone is not enough
- `next-pwa` Service Worker caches GET requests for advisory, protocols, translations
- Map tile packs cached in the Service Worker's Cache Storage
- Cache age is computed and displayed persistently, not hidden in a toast

**Step 6 — Offline write**
- `navigator.geolocation.getCurrentPosition` captures `{lat, lng, accuracy_m}`
- `lib/offlineQueue.ts`: try direct Supabase insert → on failure, enqueue payload in Dexie.js IndexedDB table
- Write target: `rescue_requests` with `status: 'pending'`
- **No auth required** — a resident in danger is never blocked by a login screen
- Queued-write count is visible in the header

**Step 7 — Reconnect flush**
- `window.ononline` listener plus periodic retry
- Queue flushes **in order**; each success removes its row from IndexedDB

**Step 8 — Live responder map**
- Google Maps JavaScript API renders pending/acknowledged pins
- Supabase Realtime subscription on `rescue_requests` — push, no polling
- Queue sorted by wait time, elapsed timer per request

**Step 9 — Acknowledge round-trip**
- Status update `pending → acknowledged`, written by `volunteer` or `official` role
- Realtime pushes the change back to the resident's client

**Steps 10–13 — Extended beats**
- `water_reports` with `level_category` enum driven by the depth picker
- `hazard_reports` with nullable `photo_url`; open/resolved status field
- `residents.qr_token` decoded by `jsqr`; `vulnerability_tags` surfaced on scan
- `headcounts` append-only rows; current count is `SUM(delta)` per center

**Cross-cutting**
- Roles (`resident` / `volunteer` / `official`) enforced by Postgres Row Level Security, not just UI
- Append-only and status-field patterns only — no workflow engine anywhere
- 44px minimum tap targets; high-contrast dark UI for outdoor glare and low-end phone battery

---

## 5. Tech Stack & Integration

**Frontend:**
- Next.js (App Router) + React
- Tailwind CSS
- `next-pwa` — Service Worker, offline read cache
- Dexie.js — IndexedDB wrapper for the write queue
- MapLibre GL JS — offline evacuation map with cached tile packs

**Backend & Database:**
- Supabase — Postgres, Auth, Realtime, Row Level Security
- Supabase Storage — hazard photos
- No custom backend server

**APIs / Sponsors:**

| Service | Used for | Sponsor prize? |
|---|---|---|
| Supabase | Postgres, Auth, Realtime, RLS | [CONFIRM] |
| Vercel | Hosting, zero-config Next.js deploy | [CONFIRM] |
| Google Maps JavaScript API | Live responder rescue map | [CONFIRM] |
| MapLibre GL JS | Offline resident evacuation map | Open source |
| Browser Geolocation API | One-tap GPS capture | Native |

**Deliberately not used:** machine learning, peer-to-peer networking, custom cryptography, IoT hardware. Everything is a mainstream library or managed service, so a small team can actually build it and maintain it afterward.

---

## 6. Build Sequence

Ordered phases, not dates. A phase is not started until the previous one meets its exit criteria.

| Phase | Build | Exit criteria |
|---|---|---|
| **Phase 1 — Foundation + vertical slice** | Supabase schema, RLS policies for all three roles, seeded barangay/Purok/protocol data, Next.js + Tailwind shell, PWA scaffold, Tier 1 advisory end to end. | An official sets Signal 3 and a resident in Purok 3 sees the correct instruction in Tagalog and Cebuano. Thin but complete. |
| **Phase 2 — Offline + rescue** | `lib/offlineQueue.ts` (Dexie), Service Worker read cache, MapLibre map with cached tile packs, SOS write path, Google Maps responder view, Realtime subscription. Tier 1 features 2–4. | **Airplane-mode test passes end to end**, and the demo can be run start to finish. This is the checkpoint that matters. |
| **Phase 3 — Ground truth + center ops** | Water-level reporting with depth picker, hazard reports + feed, hazards on the map, headcount ledger, QR check-in scanner. Tiers 2–3. | Every write goes through the offline queue. Nothing in Tier 1 has regressed. |
| **Phase 4 — Harden + rehearse** | **Feature freeze.** Tier 4 only if genuinely spare. Realistic seed data, error states, accessibility pass, device testing on a real low-end Android, repeated end-to-end demo runs. | Demo runs clean five times consecutively on venue-grade wifi, including the airplane-mode segment. |

**Standing risks**

| Risk | Mitigation |
|---|---|
| App shell not precached, so the offline reload in golden-path step 5 hits a browser error page | Verify the airplane-mode reload on a real device the day the Service Worker lands, not the week of the demo. This is the single most likely way the flagship moment fails. |
| Tile-pack caching is the least predictable piece of Phase 2 | Start it at the beginning of Phase 2, not the end. If it slips, the map degrades to online-only and the SOS offline demo still carries the pitch. |
| Camera / `jsqr` fails under venue lighting | Build a manual token-entry fallback beside the scanner. Cheap to add, saves the demo. |
| Realtime works locally, flakes on venue wifi | Rehearse on a phone hotspot, not just home wifi. Keep a recorded backup clip of the SOS segment. |
| Scope creep in Phase 3 breaks Tier 1 | Rule 2 in §3: revert, do not debug under pressure. |
| Two-person team across all stages | Split by layer — one on data/backend (schema, RLS, Realtime), one on client/UI (offline queue, maps, screens) — and cut Tier 4 first if capacity is short. |

---

## Appendix — What We Will Say About Limits

Judges ask. Honest answers, ready:

- **Total blackout?** Not solved. If the network is down for the entire event, writes stay queued and cached advisories drift. We chose intermittent-connectivity resilience deliberately; mesh is roadmap.
- **Automated sensors?** No. Volunteers are the sensor network. Episodic, not continuous — but it is the only sensor network a barangay budget affords today.
- **Security?** QR check-in is cooperative-trust, not adversarial-proof. Right threat model for an evacuation camp.
- **The responder map needs internet.** The resident's evacuation map does not — its tiles are pre-cached. Different maps, deliberately.

---

*Full product requirements — all features, complete data model, NFRs, risk register — in [`PRD-detailed.md`](PRD-detailed.md).*
