// Collect what the installer carries beside the app: ffmpeg and ffprobe for this
// platform, with their licences. They run as separate programs, so the app stays MIT
// while the GPL ffmpeg build keeps its own terms (see docs/THIRD-PARTY.md).

import { copyFile, mkdir, rm, chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "apps/studio/package.json"));
const out = join(root, "build/bin");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const exe = process.platform === "win32" ? ".exe" : "";
const ffmpeg = require("ffmpeg-static");
const ffprobe = require("ffprobe-static").path;
for (const [name, src] of [["ffmpeg", ffmpeg], ["ffprobe", ffprobe]]) {
  if (!src) throw new Error(`No ${name} for ${process.platform}-${process.arch}.`);
  await copyFile(src, join(out, name + exe));
  await chmod(join(out, name + exe), 0o755);
}
await copyFile(join(dirname(ffmpeg), "ffmpeg.LICENSE"), join(out, "ffmpeg.LICENSE")).catch(() => {});
console.log(`staged ffmpeg and ffprobe for ${process.platform}-${process.arch} in build/bin`);
