// The desktop app's icons, drawn from the knitted mark (apps/site/app/icon.svg) into
// apps/studio/build, where electron-builder turns them into each system's format.
// icon-mac.png sits inside macOS's icon grid (824 of 1024 pixels, centred), as Mac
// icons do; icon.png fills the square, for Windows and Linux.

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
console.log("drew the app icons in apps/studio/build");
