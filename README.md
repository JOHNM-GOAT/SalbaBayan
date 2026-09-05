# SalbaBayan

**Barangay-level typhoon early warning and evacuation coordination — that keeps working when the network doesn't.**

*Salba* (save) + *Bayan* (town, nation).

> **Status: pre-implementation.** This repository holds the product requirements and the design. No application code yet.

![Advisory Home](design/screens/advisory-home.png)

*The screen the app opens to — Signal 3, Purok-specific instruction, leave-by countdown, and cache state always visible. [All eight screens →](design/)*

---

## The problem

The Philippines takes roughly **20 tropical cyclones a year**. Two things break at exactly the wrong moment:

1. **The network dies.** Infrastructure collapse severs internet and cellular service mid-storm, so cloud-based early warning systems go dark precisely when people need them.
2. **National warnings aren't local instructions.** A PAGASA signal level tells a barangay *what category of storm* is coming. It never tells a resident on a specific street *what to actually do* — which route, which evacuation center, by when, in their own dialect.

On top of that, dedicated IoT water-level sensors cost too much to deploy at barangay scale, and a resident in immediate danger has no fast way to summon help and be found.

## The approach

SalbaBayan is a Progressive Web App that replaces expensive infrastructure with **structure**:

- **Officials pre-configure protocols once per season.** A Purok × Signal Level lookup table defines the route, evacuation center, and plain-language action for every combination — so the national-to-local translation happens in advance, not improvised mid-storm.
- **The community is the sensor network.** Residents and volunteers already on the ground report water levels and hazards. Zero hardware cost.
- **The offline cache is the resilience layer.** Reads come from a Service Worker cache; every write goes into a local IndexedDB queue first and syncs when a signal returns.

Deliberately **no** machine learning, **no** peer-to-peer networking, **no** custom cryptography, **no** IoT hardware. Every piece is a mainstream library or managed service, so a two-person team can actually build and maintain it.

### The honest boundary

SalbaBayan is **not** built to survive a total, indefinite communications blackout — that would need a peer-to-peer mesh, which is explicitly out of scope. It is built for the realistic case: **intermittent connectivity**, where the client keeps working through gaps and reconciles when a connection returns.

---

## How it works

```
ONLINE          Supabase (Postgres · Auth · Realtime · RLS)
                          │ HTTPS reads/writes + Realtime subscription
                  Next.js Client (Vercel-hosted PWA)
                   │                        │
        Service Worker cache        IndexedDB write queue
        (app shell + advisory,      (reports, headcounts,
         protocols, translations,    check-ins, rescue requests)
         map tile packs)                    │ auto-flush on reconnect
                                    back to Supabase

OFFLINE (temporary): reads come from cache, writes queue locally,
the UI stays fully usable. No feature depends on another device
being nearby — every device talks only to Supabase.
```

**Local-first for writes, cloud-first for truth.** The UI never blocks on the network, but there is exactly one source of truth. Because devices never sync directly with each other, no conflict-resolution logic is needed beyond "retry the queued write."

---

## Features

Tiered by build order. Tier 1 is the demo spine and must stay working as later tiers layer on.

**Tier 1 — Core**
- Localized Signal → Purok Advisory — the right instruction for your street, in your dialect
- Offline-First Client — one write-queue utility wrapping every action; Service Worker read cache
- One-Tap SOS + Live Rescue Map — geolocated distress signal, no login required
- Interactive Offline Evacuation Map — MapLibre with pre-cached tile packs, Purok boundaries, routing line

**Tier 2 — Ground truth**
- Community Water-Level Reporting — body-referenced depth scale (knee / waist / chest / above head)
- Community Hazard Reports — fallen trees, blocked roads, downed lines, flooding; plotted on the route
- Realtime Alert Aggregation — Supabase Realtime push, no polling

**Tier 3 — Evacuation center operations**
- Headcount Tracking — append-only `+1`/`−1` ledger, concurrency-safe by construction
- Resident Check-In via QR — camera scan, vulnerability tags surfaced for triage

**Tier 4 — If stable**
- Pre-Storm Readiness Checklist · Documentation Knowledge Base

Full requirements, data model, and acceptance criteria: [`PRD-detailed.md`](PRD-detailed.md).

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router) · React · Tailwind CSS |
| Backend | Supabase — Postgres, Auth, Realtime, Row Level Security |
| Hosting | Vercel |
| Offline | `next-pwa` (Service Worker) · Dexie.js (IndexedDB) |
| Offline map | MapLibre GL JS + cached vector tile packs |
| Responder map | Google Maps JavaScript API |
| QR | `qrcode` (generation) · `jsqr` (scanning) |

Roles (`resident` / `volunteer` / `official`) are enforced by Postgres Row Level Security at the database layer, not just in the UI.

---

## Documentation

| Document | Contents |
|---|---|
| [`PRD.md`](PRD.md) | The primary PRD — 17 sections: background, vision, governance, scope, target users, crisis UX, core features with FR/AC pairs, accessibility, privacy, data sources, architecture, data flow, NFRs, error handling, testing approach, success metrics, assumptions & dependencies |
| [`PRD-detailed.md`](PRD-detailed.md) | Deep-dive reference — 13 features with numbered requirement IDs, full data model, permission matrix, milestone-based release plan, risk register |
| [`PRD-pitch-brief.md`](PRD-pitch-brief.md) | Hackathon demo plan — scoped-down 9-feature build, golden-path walkthrough for the live pitch, phased build sequence |
| [`design/`](design/) | Eight high-fidelity wireframes — screen index, design language, PNG exports, and editable artboard sources |

---

## Known limitations

Stated up front — these are accepted trade-offs, not oversights.

- **Total prolonged blackout is not solved.** If the backend is unreachable for an entire event, writes stay queued and cached advisories can drift between residents. No device-to-device fallback.
- **Water-level accuracy depends on people.** Readings are episodic, not continuous, and require volunteers to be present, trained, and consistent.
- **QR check-in is cooperative-trust, not adversarial-proof.** Appropriate for internal evacuation camp coordination; not designed to resist forged or replayed check-ins.
- **The responder rescue map needs connectivity.** The resident-facing evacuation map does not — its tiles are pre-cached. Two different maps, deliberately.
- **Offline maps require a pre-storm download.** A resident who never opened the app has no cached map.

---

## Team

**RCGOAT**
- John Micooh Ugot
- Nicole Anne Arciaga

**Track:** Climate Resilience and Hydrometeorological Disaster Management
