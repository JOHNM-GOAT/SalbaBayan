# Pitch deck

`SalbaBayan-Pitch-Deck.html` is the source; the PDF beside it is rendered from
it. Eleven slides, 338 × 190 mm (16:9), painted from the app's own dark-theme
tokens so the deck and the product read as one thing.

The screenshots in `assets/` are real screens, photographed from the running
app rather than drawn — see the note below on regenerating them.

## Regenerating the PDF

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --headless=new --disable-gpu --no-first-run `
  --user-data-dir="$env:TEMP\edge-pdf" --virtual-time-budget=20000 `
  --no-pdf-header-footer `
  --print-to-pdf="docs\pitch\SalbaBayan-Pitch-Deck.pdf" `
  "file:///$((Resolve-Path docs\pitch\SalbaBayan-Pitch-Deck.html).Path -replace '\','/')"
```

## Regenerating the screenshots

Run the app (`npm run dev`), then drive a headless browser over the DevTools
protocol: set `salbabayan.language` to `en` in localStorage, dismiss the
first-run name sheet, and capture `/`, `/map`, `/sos`, `/report` at 430 × 932,
and `/official` at 1440 × 900. The dashboard needs an official device, so
capturing it means being signed in as one.

The numbers on slide 10 come from `npm run verify`; if suites are added or
checks change, update them rather than letting the deck drift.
