# Handoff — relocation to Nilombot, Mapandan, Pangasinan

**Date:** 2026-09-28
**Live database:** already relocated — migration `0063_nilombot_geography.sql` is applied to project `mpdzehfmxwuxjklgeqrz`.

This replaces **#5 Callaguip, Batac City, Ilocos Norte** (see [HANDOFF-callaguip.md](HANDOFF-callaguip.md)) with **Nilombot, Mapandan, Pangasinan**. Everything below lists what was done, where each fact came from, and what is still open.

The short version: this relocation rests on better evidence than the last one. Callaguip had no boundary in OpenStreetMap, so its outline had to be traced along the streets that appeared to bound it. Nilombot has a real administrative boundary relation, and that is what the app now uses.

---

## 1. The barangay

| | value | source |
|---|---|---|
| Name | **Nilombot** | as requested |
| Municipality / province | Mapandan / Pangasinan | as requested |
| Point | 16.0253207 N, 120.4286234 E | OSM node `4369884571` — `place=village`, `admin_level=10` |
| Outline | 35-point polygon, **225.9 ha** | OSM relation `13315002` — `boundary=administrative`, `admin_level=10`, `border_type=barangay` |
| PSGC | `0105528012` | the `ref` tag on that relation |
| Population | **4,411** | `population` on the same relation, `population:date` 2020-05-01 (PSA census) |
| Wikidata | Q31812645 | on the relation |

The outline is the **official mapped line**, stitched from the relation's five member ways into one closed ring. It is not a trace, not a guess, and not copied from Google (whose licence does not permit it).

For scale: Nilombot is about **14× the area** of the Callaguip outline and has **5× the population** (4,411 vs 832).

---

## 2. The areas

Seven named streets have geometry inside the boundary, and they are what residents choose from until the barangay supplies a Purok list:

| area | route to the centre | via |
|---|---|---|
| Santan Street | 103 m | Santan St. |
| Rose Street | 579 m | Rose St., Santan St. |
| Orchids Street | 647 m | Rose St., Santan St. |
| Cosmos Street | 1,239 m | Cosmos St., Pandan Ave., Santan St. |
| Gumamela Street | 1,701 m | Gumamela St., Pandan Ave., Santan St. |
| Zenia Street | 1,742 m | Pandan Ave., Santan St. |
| Pandan Avenue | 1,989 m | Pandan Ave., Santan St. |

Each route starts at the far end of that street's stretch inside the barangay, so the line runs its whole length and everybody living on it is standing on the route they will walk.

### Streets deliberately NOT offered

These appear in the map extract but lie outside the boundary — they belong to neighbouring barangays: **Santa Barbara-Mangaldan Road**, **Rosal Street**, **Pico Avenue**, **Cacao Street**, **Golden Shower Street**, **Apayas Street**, **Lawin Street**.

Rosal Street is worth naming specifically. It shares exactly one node with the boundary and lies entirely on the far side of it. An early version of the generator accepted any street within 3 m of the line — a rule inherited from Callaguip, where the outline *was* the streets — and so offered Rosal Street as an area of Nilombot. Somebody living there would have been handed an evacuation route from a barangay they do not live in. The generator now requires a point **strictly inside**, and `NOT_OURS` in `scripts/generate-nilombot.mjs` fails the build if any of these reappears.

### What the street names cannot tell you

**26 unnamed ways** touch the barangay — mostly residential. Residents on those streets have to pick the nearest named one. A Purok list from the barangay fixes this properly and should replace the street names when it arrives.

---

## 3. The evacuation centre

**Nilombot Elementary School**, OSM way `790262129`, at 16.0281798 N, 120.4362941 E — inside the boundary, on Santan Street.

Two things to know:

- **OSM maps no barangay hall inside Nilombot.** None was invented. If the barangay evacuates to its hall, an official should add it on the map — the app supports up to three centres and redraws every route when one is added or moved.
- **The school stands ~40 m back from Santan Street**, behind its gate. Stored routes include that final leg, matching what the live map draws, so the offline fallback and the online route agree. `scripts/check-routes.mjs` enforces both halves: every vertex before the last sits on a mapped road to within a metre, and the last one is the school itself.
- **Capacity is unset.** Nobody knows it but the barangay.

---

## 4. What was regenerated

| file | what |
|---|---|
| `scripts/osm/nilombot-boundary.json` | the stitched 35-point ring, with the relation's tags |
| `scripts/osm/nilombot-roads.json` | 255 highway ways in a bbox covering Nilombot + ~900 m |
| `public/geo/streets.json` | the offline base map and routing network |
| `supabase/migrations/0063_nilombot_geography.sql` | archive, clear, and insert |
| `scripts/generate-nilombot.mjs` | the generator that produces the last two |

The extract came from `api.openstreetmap.org/api/0.6/map.json`, not Overpass: every Overpass mirror was timing out when this was built. Way geometry is resolved from node refs in the generator instead of by the server.

**Network quality:** 3,035 nodes in the largest connected component, **323 of them inside the barangay**. Callaguip managed 32 of 1,809 — this is a far better base to route on.

---

## 5. The buildings

Nilombot has **thirteen** buildings in OpenStreetMap, twelve of them the elementary school's own blocks. That is why the map looked like bare fields next to Callaguip's: the online base map draws buildings from OSM, and Batac City's centre is densely mapped by volunteers while this barangay has never been surveyed by one. Nothing was lost in the move; there was nothing there to draw.

So the app carries its own: **1,529 footprints** (923 inside the boundary, the rest within 200 m of it) in `public/geo/buildings.json`, about 294 KB, generated by `scripts/generate-buildings.mjs`.

**Source: Microsoft's Global ML Building Footprints, ODbL** — the same licence as the OSM data the app already carries, credited on every map through the layer's own source attribution.

**Not Google Maps.** Google's terms forbid deriving data from their service, and this repository is public and openly licensed; tracing their footprints would put the barangay in the wrong, not just the developer. Microsoft's dataset is machine-extracted from satellite imagery, which is how it exists for a barangay no volunteer has mapped.

What they are and are not:

- They are **decoration**. Nothing routes, measures or decides from them. They are drawn beneath the boundary, the route and every pin.
- A footprint may be a few metres out, may merge two roofs, and will miss anything built or demolished since the imagery.
- They also fill a real gap: the **drawn fallback map** — the one a phone falls back to with no signal — never had buildings at all. Now the map a resident sees in a blackout shows the houses on their street, not just the street.

## 6. The old data

Every Callaguip record was **archived, not destroyed**, into the `archive` schema (which the app's API does not expose) as `archive.<table>_20260928`:

`checkins`, `headcounts`, `residents`, `hazard_reports`, `water_reports`, `rescue_requests`, `signal_history`, `protocols`, `evac_centers`, `puroks`.

Any of it is one `INSERT ... SELECT` away if it is wanted back.

**Not cleared:** `user_roles`, `translations`, `documents`, `push_subscriptions` — those belong to devices and people, not to a place.

**Not reachable from SQL:** photos in the `hazard-photos` storage bucket. Supabase only deletes storage objects through its Storage API, so any orphans are left for the dashboard.

---

## 7. Still open

Ranked by how much it matters.

1. **The language.** `default_language` is still `tl` (Filipino). Mapandan speaks **Pangasinan**, and Ilocano is widely spoken across the province. Both are offered and both are **machine-translated**. The app labels that honestly, but "evacuate now" is the one string that must not be wrong. A native speaker should write them before the barangay depends on the app.
2. **The Purok list.** Street names are a stand-in. The barangay's own Puroks are what residents actually identify with, and 26 unnamed streets currently have no area of their own.
3. **The barangay hall.** Not in OSM. If it is the evacuation centre, or a second one, an official should place it.
4. **Capacity and the household count.** Both unset. Readiness and headcount reporting need them.
5. **Confirm the boundary with the LGU.** The OSM relation is the official line *as mapped*. It is a much stronger basis than Callaguip's trace, but it is still worth a look from someone at the barangay hall.
6. **Release hygiene, unchanged by this move.** The default PIN `1234` and the access code `#RCGOAT#1` are still live.

---

Road and boundary data © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/). The app carries the required attribution on every map screen.
