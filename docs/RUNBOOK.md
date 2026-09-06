# Barangay Runbook

What to do, in order, when a storm is coming. Written for whoever is at the
barangay hall — not for developers.

This document is ingested into the app (`npm run ingest:docs`), so it can be
read on a phone with no connection.

---

## Before the season

1. **Fill the protocol grid.** Open **Coverage**. Every Purok needs a row for
   every signal level 1–5. A dashed cell is a Purok whose residents will open
   the app during a storm and be told nothing.
2. **Check the translations.** A protocol nobody can read in their own language
   is not configured. The Readiness screen counts these.
3. **Give the volunteers their roles.** A volunteer's phone shows a **device
   code** on the Device & Role screen. Add that code to the roster; their role
   changes at the next sync. Two volunteers minimum — one is a single point of
   failure.
4. **Check the evacuation centres have locations.** A centre with no
   coordinates cannot be a destination on the map.

## When a PAGASA bulletin arrives

1. **Set the signal level.** This is the single value every advisory joins
   against. Everyone's screen changes the moment you set it.
2. **Set the leave-by time** for signal 3 and above. Residents see a countdown
   to it. Set it earlier than you think — people take longer to leave than they
   expect, and the last hour before a storm is the worst hour to travel.
3. Bulletin number, storm name and wind speed are optional. Do not let a
   missing wind speed delay setting the level.

## During the event

- **Rescue requests** arrive on the Responder screen, sorted by how long
  someone has been waiting. The oldest unanswered one is escalated to a banner.
  Acknowledge it so the resident sees that they have been seen — their screen
  shows the change.
- **A request with no GPS** is not a broken request. It carries the Purok. Send
  someone to the street.
- **Headcounts** are `+1` / `−1` per person, or a bulk count for a family
  arriving together. The ledger cannot be erased. If a count is wrong, correct
  it by entering the opposite — never by trying to edit history.
- **Check people in** by scanning their card, or by typing the code if the
  camera will not cooperate. Both do exactly the same thing.
- **Tags on a check-in card** (MEDICAL, MATANDA, SANGGOL) mean that person
  needs attention sooner. They are visible only to volunteers and officials.

## When something looks wrong

- **"Naka-queue" on a resident's screen** means their report is saved on their
  phone and has not reached the barangay yet. It is not lost. It sends when
  they get signal.
- **A number that will not update** usually means that device is offline. The
  strip at the top of every screen says how old its information is — read that
  before trusting anything below it.
- **A centre showing as full** stops nobody from walking there. Direct people
  to the alternate centre yourself; the app cannot turn anyone around.

## After

The ledger, the check-ins and the rescue log are the record. Nothing in this
app deletes them, and that is deliberate — they are what reconciliation and any
later claim rests on.
