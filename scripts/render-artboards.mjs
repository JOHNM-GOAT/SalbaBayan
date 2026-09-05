/**
 * Export every artboard in stage-2/design/artboards to a PNG in
 * stage-2/design/screens.
 *
 * The original eight PNGs were produced by hand, which meant the exports drifted
 * from their sources with no way to tell. This makes the screens folder a build
 * output: re-runnable, and reviewable as a diff.
 *
 * Renders through headless Edge at 2x for legible text, sized per artboard from
 * canvas.json. Waits on `data-dc-ready`, which support.js sets after it has
 * substituted every placeholder — screenshotting before that produced images
 * full of raw `{{...}}`.
 *
 * Run:  node scripts/render-artboards.mjs
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ARTBOARDS = join(HERE, "..", "stage-2", "design", "artboards");
const SCREENS = join(HERE, "..", "stage-2", "design", "screens");
const PORT = 4399;
const SCALE = 2;

const EDGE_CANDIDATES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

const browser = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error("No Edge or Chrome found. Checked:\n  " + EDGE_CANDIDATES.join("\n  "));
  process.exit(1);
}

/** Artboard sizes come from canvas.json; anything unlisted gets phone size. */
const canvas = JSON.parse(readFileSync(join(ARTBOARDS, "canvas.json"), "utf8"));
const sizes = new Map(canvas.artboards.map((a) => [a.file, { w: a.w, h: a.h }]));

/**
 * Export filenames are kebab-cased from the artboard, except where an existing
 * screen already has a name — those are pinned so committed READMEs and the
 * PRD keep resolving.
 */
const PINNED = {
  "Main.dc.html": "advisory-home",
  "EvacMap.dc.html": "evacuation-map",
  "RescueSOS.dc.html": "sos-rescue",
  "HazardReport.dc.html": "hazard-report",
  "QRScanner.dc.html": "qr-checkin",
  "Headcount.dc.html": "headcount",
  "ResponderDashboard.dc.html": "responder-dashboard",
  "AdminProtocols.dc.html": "protocol-admin",
};

function outputName(file) {
  if (PINNED[file]) return PINNED[file];
  return file
    .replace(/\.dc\.html$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
};

const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split("?")[0]);
  const file = join(ARTBOARDS, path === "/" ? "index.html" : path);
  if (!file.startsWith(ARTBOARDS) || !existsSync(file)) {
    res.writeHead(404);
    return res.end("not found");
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Headless screenshotting on Windows needs three accommodations, all found by
 * testing rather than from the docs:
 *
 *   - `--headless=old`. The new headless mode frequently exits 0 having written
 *     nothing at all.
 *   - A Windows-style output path. Forward slashes are silently ignored.
 *   - A pause after exit. The file lands slightly after the process is gone, so
 *     checking immediately reports a false failure.
 *
 * Even then it fails perhaps one run in four, with no error and no output, so
 * every artboard gets several attempts. Without the retry a full export
 * reliably lost a third of the screens.
 */
function shotOnce(file, { w, h }, out) {
  return new Promise((resolve, reject) => {
    // A fresh profile per shot. Reusing one lets a previous run's cache serve
    // stale fonts, which showed up as fallback type in the exports.
    const profile = join(
      process.env.TEMP || "/tmp",
      `dc-render-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const args = [
      "--headless=old",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=" + SCALE,
      `--window-size=${w},${h}`,
      `--screenshot=${out.replace(/\//g, "\\")}`,
      `--user-data-dir=${profile}`,
      // Fonts load from Google Fonts, and the placeholder substitution runs on
      // DOMContentLoaded. Without a budget the shot lands mid-layout.
      "--virtual-time-budget=6000",
      `http://localhost:${PORT}/${file}`,
    ];
    const child = spawn(browser, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", async () => {
      await sleep(700);
      // The browser can still hold handles in this directory for a moment
      // after exit. A leftover temp profile is not worth failing a render over.
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      } catch {
        /* swept up by the OS later */
      }
      if (existsSync(out)) resolve();
      else reject(new Error("no output"));
    });
  });
}

async function shot(file, size, out, attempts = 5) {
  /*
   * Delete the target first.
   *
   * Success is judged by the output file existing, so leaving a previous run's
   * PNG in place lets a render that produced nothing report success — which is
   * exactly what happened: one screen silently kept a stale image across two
   * "15/15 rendered" runs while its source had changed underneath it. Removing
   * it first makes existence actually mean something.
   */
  rmSync(out, { force: true });

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await shotOnce(file, size, out);
      return attempt;
    } catch (error) {
      if (attempt === attempts) throw error;
      await sleep(300);
    }
  }
}

server.listen(PORT, async () => {
  mkdirSync(SCREENS, { recursive: true });

  const files = readdirSync(ARTBOARDS).filter((f) => f.endsWith(".dc.html")).sort();
  let failed = 0;

  for (const file of files) {
    const size = sizes.get(file) ?? { w: 390, h: 844 };
    const out = join(SCREENS, `${outputName(file)}.png`);
    try {
      const tries = await shot(file, size, out);
      const note = tries > 1 ? `  (${tries} attempts)` : "";
      console.log(`  ${outputName(file)}.png  ${size.w}x${size.h} @${SCALE}x${note}`);
    } catch (error) {
      failed += 1;
      console.error(`  FAILED ${file}: ${error.message}`);
    }
  }

  server.close();
  console.log(`\n${files.length - failed}/${files.length} artboards rendered`);
  process.exit(failed === 0 ? 0 : 1);
});
