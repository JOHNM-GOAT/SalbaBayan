# User manual

`SalbaBayan-User-Manual.html` is the source. The PDF beside it is rendered from
it, and both are committed so the manual can be handed to the barangay without
anyone having to build it first.

Edit the HTML, then regenerate:

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --headless=new --disable-gpu --no-first-run `
  --user-data-dir="$env:TEMP\edge-pdf" --virtual-time-budget=8000 `
  --no-pdf-header-footer `
  --print-to-pdf="docs\manual\SalbaBayan-User-Manual.pdf" `
  "file:///$((Resolve-Path docs\manual\SalbaBayan-User-Manual.html).Path -replace '\','/')"
```

Any browser's Print → Save as PDF produces the same thing; the page size,
margins and page breaks are set in the stylesheet.

Keep it in step with the app. The manual quotes the wording on the screens —
`SYNCED JUST NOW`, `USE THIS BULLETIN`, `FULL — DIRECT PEOPLE ELSEWHERE` — and a
manual that quotes wording the app no longer uses is worse than none, because a
volunteer reads it during a storm and starts looking for a control that is not
there.
