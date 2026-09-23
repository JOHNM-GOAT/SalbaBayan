/**
 * The app icons, from one source image.
 *
 *   node scripts/make-icons.mjs
 *
 * Input:  brand/logo-source.png — the logo as supplied, on its own background.
 * Output: public/logo.png       — trimmed, background keyed out (the header mark)
 *         public/icon-192.png   — PWA icon, padded on white so a round or
 *         public/icon-512.png     squircle mask cannot clip the mark
 *         src/app/icon.png      — the browser tab icon Next.js links
 *         src/app/apple-icon.png — the iOS home-screen icon
 *         src/app/favicon.ico   — the same, for /favicon.ico
 *
 * Kept as a script rather than done once by hand so a new logo is one command,
 * and so the icons in git can always be traced back to their source.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "brand/logo-source.png");

/** Anything this close to white is the backdrop, not the mark. */
const WHITE = 232;

/** The mark on transparency, cropped to itself. */
async function transparent() {
  const { data, info } = await sharp(SOURCE)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] >= WHITE && data[i + 1] >= WHITE && data[i + 2] >= WHITE) {
      data[i + 3] = 0;
    }
  }

  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .png()
    .toBuffer()
    .then((png) => sharp(png).trim({ threshold: 1 }).png().toBuffer());
}

/** A square icon: the mark centred on white, with room for a mask to bite into. */
async function square(mark, size) {
  const inner = Math.round(size * 0.74);
  const fitted = await sharp(mark).resize(inner, inner, { fit: "contain", background: "#ffffff00" }).toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: "#ffffff" },
  })
    .composite([{ input: fitted, gravity: "centre" }])
    .png()
    .toBuffer();
}

/**
 * An .ico holding PNG images. Every browser in use reads this form, and it
 * saves pulling in an encoder for the old bitmap one.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // colours in palette: none, it is a PNG
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const mark = await transparent();
writeFileSync(join(ROOT, "public/logo.png"), await sharp(mark).resize(512, 512, { fit: "inside" }).png().toBuffer());

for (const size of [192, 512]) {
  writeFileSync(join(ROOT, `public/icon-${size}.png`), await square(mark, size));
}

mkdirSync(join(ROOT, "src/app"), { recursive: true });
writeFileSync(join(ROOT, "src/app/icon.png"), await square(mark, 180));
// iOS home screen: it ignores the manifest icons and looks for this one.
writeFileSync(join(ROOT, "src/app/apple-icon.png"), await square(mark, 180));
writeFileSync(
  join(ROOT, "src/app/favicon.ico"),
  ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await square(mark, size) })))),
);

console.log("icons written: public/logo.png, public/icon-192.png, public/icon-512.png, src/app/icon.png, src/app/favicon.ico");
