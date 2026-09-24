# Stage 5 — MVP deliverables

| | |
|---|---|
| **Final MVP** | https://salba-bayan.vercel.app |
| **Source code** | https://github.com/JOHNM-GOAT/SalbaBayan |
| **Pitch deck** | [SalbaBayan-Pitch-Deck.pdf](SalbaBayan-Pitch-Deck.pdf) — 11 slides, 16:9 |
| **User manual** | [SalbaBayan-User-Manual.pdf](SalbaBayan-User-Manual.pdf) — 12 pages, A4 |

The app is live for Barangay #5 Callaguip, Batac City, Ilocos Norte. Open it on
a phone, turn airplane mode on and reload: the signal, the map, the walking
route and the SOS button all still work, which is the point of the whole thing.

## What is in here

```
stage-5/
├── SalbaBayan-Pitch-Deck.pdf     the deck, for presenting
├── SalbaBayan-User-Manual.pdf    the manual, for the barangay
└── source/
    ├── SalbaBayan-Pitch-Deck.html    the deck's source
    ├── SalbaBayan-User-Manual.html   the manual's source
    └── assets/                       screenshots used by the deck
```

Both PDFs are rendered from the HTML beside them, and both are committed so
they can be handed over without anyone building anything first. The deck is
painted from the app's own dark-theme tokens (`src/app/globals.css`), so it and
the product read as one thing.

The screenshots in `source/assets/` are real screens captured from the running
app, not mockups. The dashboard shot shows an empty barangay because the test
data was cleared out of the live database before release.

## Regenerating a PDF

Edit the HTML, then print it. Any browser's *Print → Save as PDF* gives the same
result — the page size, margins and page breaks are set in each stylesheet.
From the repository root, headlessly:

```powershell
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

& $edge --headless=new --disable-gpu --no-first-run `
  --user-data-dir="$env:TEMP\edge-pdf" --virtual-time-budget=20000 `
  --no-pdf-header-footer `
  --print-to-pdf="stage-5\SalbaBayan-Pitch-Deck.pdf" `
  "file:///$((Resolve-Path stage-5\source\SalbaBayan-Pitch-Deck.html).Path -replace '\\','/')"

& $edge --headless=new --disable-gpu --no-first-run `
  --user-data-dir="$env:TEMP\edge-pdf" --virtual-time-budget=8000 `
  --no-pdf-header-footer `
  --print-to-pdf="stage-5\SalbaBayan-User-Manual.pdf" `
  "file:///$((Resolve-Path stage-5\source\SalbaBayan-User-Manual.html).Path -replace '\\','/')"
```

## Keeping them true

The manual quotes the wording on the screens — `SYNCED JUST NOW`,
`USE THIS BULLETIN`, `FULL — DIRECT PEOPLE ELSEWHERE`. A manual that quotes a
control the app no longer has is worse than no manual, because someone reads it
during a storm and looks for a button that is not there.

The deck's status numbers come from `npm run verify`. If suites are added or
checks change, update slide 10 rather than letting it drift.
