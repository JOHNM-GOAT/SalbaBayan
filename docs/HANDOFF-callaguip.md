# Handoff — relocation to #5 Callaguip, Batac City, Ilocos Norte

**Date:** 2026-09-19
**Branch:** `feat/callaguip` (not yet merged into `main`)
**Live database:** already relocated — migrations 0026, 0027 and 0028 are applied to project `mpdzehfmxwuxjklgeqrz`.

This replaces the fictional "San Isidro, Sta. Cruz, Laguna" the app was built on with the real barangay #5 Callaguip. Everything below lists what was done, every assumption made along the way, and what is still open.

---

## 1. What changed

### The barangay

| | value | source |
|---|---|---|
| Name | **#5 Callaguip** | as requested |
| Municipality / province | Batac City / Ilocos Norte | as requested |
| Point | 18.0634855 N, 120.5615882 E | OpenStreetMap node 8883724672 ("Barangay 5 Callaguip", PSGC 0102805012) |
| Outline | 44-point polygon, about 16.4 ha | traced along OSM streets — see §2 |
| Population | **832**, shown with "Source: PhilAtlas" | as requested |
| Household count | *not set* | to be entered by staff — see §4 |
| Default language | Tagalog (unchanged) | see §2 |

### Areas residents choose from

Six areas, named after the streets supplied: **Asuncion, Oeste, Otis, Rigonan, Smith, Taft**. They replace Puroks 1–8 until the barangay provides its real Purok list. A street has no outline of its own, so the map draws the barangay's outline instead.

### Evacuation centre

One centre: **#5 Callaguip Barangay Hall**, placed at OSM way 1189277453. Its capacity is **not set** — nobody supplied it, and it drives the FULL warning, so it was not guessed. Officials can move it and set its capacity (§3).

### Routes

One walking route from each area to the hall, for Signals 1–5 (30 protocol rows), along real streets. Each area's route starts at the end of its street farthest from the hall, so the route runs the length of that street.

| area | distance | via |
|---|---|---|
| Asuncion Street | 190 m | Asuncion St. |
| Oeste Street | 391 m | Oeste St. |
| Rigonan Street | 278 m | Taft St. → Asuncion St. |
| Smith Street | 429 m | Taft St. → Asuncion St. |
| Otis Street | 533 m | Taft St. → Asuncion St. |
| Taft Street | 533 m | Taft St. → Asuncion St. |

The instructions per signal are the app's existing ones: stay alert, prepare, evacuate now, evacuate immediately, stay inside.

### New features

- **Language picker.** A dropdown in the header replaces the TAG/BIS/ENG buttons. It lists 37 languages of the Philippines plus English, grouped into *Translated* (English, Tagalog, Cebuano) and *Not translated yet — shown in Tagalog*. The grouping is read from the `translations` table, so a language moves into *Translated* automatically once its strings are added. (`src/lib/i18n.ts`, `src/components/LanguageSwitch.tsx`)
- **Evacuation-centre editor (officials only).** On `/map`: tap **SET EVACUATION CENTRE**, tap the map inside the barangay, adjust the name and capacity, then press and hold to save. A tap outside Callaguip is refused on the spot, and the database refuses it again. On save, **every area's route is recomputed on the phone** — using the same code as the generator — and saved through the offline queue together with the centre. (`src/components/CentreEditor.tsx`, `src/lib/walkRoute.ts`)
- **Household count (volunteers and officials).** A card on both homes. The database lets a volunteer change this one field and nothing else on the barangay row. (`src/components/HouseholdsCard.tsx`, migration 0026)
- **Population (officials).** A card on the official home: 832, source PhilAtlas. (`src/components/PopulationCard.tsx`)
- **Live updates.** Hazards, areas, the centre and routes now reach every open phone within seconds. The evacuation map previously refreshed its hazards only on reload. Your own GPS position was already live on `/map`. (`subscribeAdvisory` in `src/lib/advisory.ts`)

### Fixes made along the way

- **The offline queue could lose a signal change.** A second update to the same row replaced the first, so an official who issued a signal offline and then entered the household count would have lost the signal. Updates to the same row now merge. (`mergeUpdatePayload` in `src/lib/queuePolicy.ts`, tested)
- **Readiness would have gone permanently amber.** "Translations" required every string in every *listed* language, and 37 new languages have none. It now counts only languages that have strings.
- **Capacity displayed wrongly.** A blank capacity rendered as "CAPACITY null" (volunteer home) or "0" (headcount); it now reads "not set" / "—".
- **Hard-coded coordinates.** Three hard-coded Sta. Cruz map centres were replaced by the barangay's own point.

### The old test records

Cleared, as chosen — but **archived first**, not destroyed. Every row is in the database's `archive` schema, which the app's API does not expose:

`archive.barangays_20260919`, `archive.puroks_20260919`, `archive.evac_centers_20260919`, `archive.protocols_20260919`, `archive.residents_20260919`, `archive.checkins_20260919`, `archive.headcounts_20260919`, `archive.hazard_reports_20260919`, `archive.water_reports_20260919`, `archive.rescue_requests_20260919`, `archive.signal_history_20260919`

To restore any of it, e.g. the hazard reports (they reference old Puroks, so point them at a current area first):

```sql
insert into public.hazard_reports
select * from archive.hazard_reports_20260919;
```

Kept as they were: the real roles (official D-4CD7, volunteer D-1D35), all translations, and the runbook.

---

## 2. Assumptions and judgement calls — please check these

1. **Spelling.** OpenStreetMap has no "Cal-Laguip"; its only match is "Callaguip", which you confirmed is the same place. The app shows **#5 Callaguip**.
2. **The outline is approximate.** It follows the streets matching the outline on Google Maps: Manila North Road (west), Washington and Taft Streets (east), and Smith, Oeste and Otis Streets (south). Google's own boundary was not copied — its licence doesn't allow it — and OSM has only a point for this barangay. The south edge runs along **Otis** so that Otis Street, which you listed, is inside. Checks: the barangay marker and the hall are inside; Nalupta's barangay hall, next door, is outside. **Confirm against the official PSA/city map.**
3. **"Smith Oetese ST." was read as two streets, Smith and Oeste.** Both exist in OSM and both border the south edge.
4. **The barangay hall is OSM's "5 Callaguip Community Center"** on Asuncion Street, operated by Barangay 5 Callaguip. Batac's barangay halls are mapped as community centres; Aglipay and Acosta are tagged the same way. An official can move it in the app if this is wrong.
5. **Population.** You gave 832 from PhilAtlas, and that is what is shown. OpenStreetMap records **832 as the 2015 census** and **845 as of July 2024**, so PhilAtlas may be showing the older figure.
6. **"Hover to set the centre" became tap-to-place.** Phones have no hover. A tap places a dashed draft marker, which is saved only after the press-and-hold.
7. **"All languages" became 37 widely spoken languages** plus English. The Philippines has about 180. Adding one is a single line in `src/lib/i18n.ts`.
8. **The default language stays Tagalog.** Batac speaks mainly Ilocano, but the app has no Ilocano strings yet — see §4, item 1.
9. **Where each area's route starts** is the far end of its street inside the barangay. This is a heuristic, pending real Purok locations.
10. **The blocked-path demonstration is gone.** San Isidro had two invented hazards placed to show the "route blocked" warning; clearing the test records removed them, and none were invented for Callaguip. The logic is still tested (`scripts/geo-test.mjs`).

---

## 3. How to check it by hand

The automated gate is green (`npm run verify`, exit 0; live RLS suite 25 passed). These still need a person and real devices:

1. **Residents' view.** Open the app. The area picker reads *Brgy. #5 Callaguip* with the six streets. `/map` opens on Callaguip with its outline and a route to the barangay hall.
2. **Language picker.** Open the dropdown. English, Tagalog and Cebuano appear under *Translated*, and the rest under *Not translated yet — shown in Tagalog*. Choosing Ilocano should show Tagalog text.
3. **Centre editor** (on an official's device — D-4CD7, or a device granted the role in SQL):
   - `/map` → **SET EVACUATION CENTRE**.
   - Tap outside Callaguip: it should be refused.
   - Tap inside, set a capacity, then press and hold.
   - On a second phone with `/map` open, the centre and route should move within seconds.
4. **Household count.** On a volunteer's home, enter a number and save. It should appear on the official's home and in readiness.
5. **Offline.** Repeat 3 or 4 in airplane mode, then reconnect. The change should arrive, and nothing already queued should be lost.

---

## 4. What is still open, in priority order

1. **Translate the app into Ilocano**, with a native speaker writing or checking it. Without that, Callaguip residents who choose Ilocano read Tagalog. Add the rows to a migration; the picker picks them up automatically.
2. **Merge `feat/callaguip` into `main` and deploy.** The live database is already Callaguip, but the new screens only exist on this branch. If your deployment builds from `testing`, update that too — it is well behind `main`.
3. **Replace the street areas with the real Purok list** when the barangay provides it (names, boundaries if available, and which streets each covers). Edit `AREAS` in `scripts/generate-callaguip.mjs` and regenerate.
4. **Confirm the boundary** against the official map (§2, item 2).
5. **Set the hall's capacity** — an official, in the centre editor.
6. **Enter the household count** — a volunteer or official. Readiness shows "no baseline" until then.
7. **Create a dedicated test-official account** so the live RLS suite can run its 7 official checks again. They are skipped since self-promotion was closed.
8. **Delete the 4 orphaned hazard photos** in the `hazard-photos` storage bucket (Supabase dashboard → Storage). SQL cannot delete storage objects.
9. **Native-speaker review** of all Tagalog and Cebuano wording added recently.

---

## 5. Where things are

| file | what |
|---|---|
| `scripts/generate-callaguip.mjs` | builds the base map, outline, areas, centre and routes from OSM; writes 0027. `--fetch` refreshes the OSM extract. |
| `scripts/osm/batac-callaguip-roads.json` | the cached OSM extract (ODbL) |
| `public/geo/streets.json` | the offline base map, and the network routes are computed on |
| `src/lib/walkRoute.ts` | shortest walking path, point-in-outline, route wording — shared by the generator and the phone |
| `supabase/migrations/0026_callaguip_schema.sql` | new columns, the household rule, the inside-the-barangay rule, live updates |
| `supabase/migrations/0027_callaguip_geography.sql` | generated: archive, clear, write Callaguip |
| `supabase/migrations/0028_callaguip_strings.sql` | wording for the new screens (en / tl / ceb) |
| `scripts/check-routes.mjs` | fails the build if routes and the base map disagree |
| `scripts/walkroute-test.mjs`, `scripts/languages-test.mjs` | unit tests for the routing and the language list |

Road data © OpenStreetMap contributors, ODbL. The app shows the required attribution on both map screens.
