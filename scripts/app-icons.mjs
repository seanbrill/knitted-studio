// The desktop app's icons, drawn from the knitted mark (apps/site/app/icon.svg) into
// apps/studio/build, where electron-builder turns them into each system's format.
// icon-mac.png sits inside macOS's icon grid (824 of 1024 pixels, centred), as Mac
// icons do; icon.png fills the square, for Windows and Linux. The tray icons, shown while
// knitted runs without its window, go in apps/studio/electron/tray: on a Mac the two
// stitches alone in black, which macOS tints to suit the menu bar; elsewhere the mark.

import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = await readFile(join(root, "apps/site/app/icon.svg"), "utf8");
const view = Number(svg.match(/viewBox="0 0 (\d+)/)[1]);
const mark = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const drawn = (inset) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><g transform="translate(${inset} ${inset}) scale(${(1024 - 2 * inset) / view})">${mark}</g></svg>`,
);

const out = join(root, "apps/studio/build");
await mkdir(out, { recursive: true });
await sharp(drawn(0)).png().toFile(join(out, "icon.png"));
await sharp(drawn(100)).png().toFile(join(out, "icon-mac.png"));
// The menu bar's 16 points, and twice that for a Retina screen. The stitches' paths, from the mark.
const stitches = [...svg.matchAll(/<path d="([^"]+)"[^>]*stroke="#1a0e05"/g)].map((m) => m[1]);
// As in the mark, the second stitch cuts a gap out of the first, so the two read apart even this small.
const template = (size) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="3 3 26 26"><defs><mask id="gap"><rect x="0" y="0" width="32" height="32" fill="#fff"/><path d="${stitches[1]}" fill="none" stroke="#000" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></mask></defs>`
  + `<path d="${stitches[0]}" mask="url(#gap)" fill="none" stroke="#000" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/><path d="${stitches[1]}" fill="none" stroke="#000" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
);
const tray = join(root, "apps/studio/electron/tray");
await mkdir(tray, { recursive: true });
await sharp(template(16)).png().toFile(join(tray, "trayTemplate.png"));
await sharp(template(32)).png().toFile(join(tray, "trayTemplate@2x.png"));
await sharp(drawn(0)).resize(32).png().toFile(join(tray, "tray.png"));
await sharp(drawn(0)).resize(64).png().toFile(join(tray, "tray@2x.png"));
console.log("drew the app icons in apps/studio/build and apps/studio/electron/tray");
