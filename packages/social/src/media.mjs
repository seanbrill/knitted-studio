// A knit's file as a platform takes it. Videos go as they are knitted (H.264 and AAC, the
// index at the front, which every platform asks for). Pictures are knitted as PNG, which
// Instagram does not take and X takes only under 5 MB: those become a JPEG, made once per
// post, in the cache, and removed after.

import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { knitPath } from "@knitted/core/node";

const MB = 1024 * 1024;
/** Per platform: whether pictures must be JPEG, the widest they may be, and the biggest file. */
const RULES = {
  instagram: { jpeg: true, width: 1440, bytes: 8 * MB },
  threads: { jpeg: true, width: 1440, bytes: 8 * MB },
  x: { jpeg: false, width: 4096, bytes: 5 * MB },
  linkedin: { jpeg: false, width: 6000, bytes: 10 * MB },
  tiktok: { jpeg: false, width: 4096, bytes: 20 * MB },
  youtube: { jpeg: false, width: 4096, bytes: 20 * MB },
};

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };

/**
 * The files to post, each `{ path, name, kind, mime, bytes, width, height, durationMs, label }`,
 * and `cleanup()` to remove what was made for it.
 */
export async function prepareMedia(store, platform, knits, postId) {
  const rule = RULES[platform];
  const dir = join(store.paths.cacheDir, "social", postId);
  const out = [];
  for (const [i, k] of knits.entries()) {
    const path = knitPath(store, k);
    const ext = (k.file.split(".").pop() ?? "").toLowerCase();
    const base = { kind: k.kind, width: k.width, height: k.height, durationMs: k.durationMs, label: k.label };
    if (k.kind === "video") { out.push({ ...base, path, name: k.file.split("/").pop(), mime: MIME[ext] ?? "video/mp4", bytes: (await stat(path)).size }); continue; }
    const bytes = (await stat(path)).size;
    const isJpeg = ext === "jpg" || ext === "jpeg";
    if ((!rule.jpeg || isJpeg) && bytes <= rule.bytes && k.width <= rule.width) { out.push({ ...base, path, name: k.file.split("/").pop(), mime: MIME[ext] ?? "image/png", bytes }); continue; }
    await mkdir(dir, { recursive: true });
    const to = join(dir, `${i + 1}.jpg`);
    // Flattened on white: a JPEG has no transparency, and black is what it would get otherwise.
    let q = 92, info;
    for (;;) {
      info = await sharp(path).flatten({ background: "#ffffff" }).resize({ width: rule.width, withoutEnlargement: true }).jpeg({ quality: q, mozjpeg: true }).toFile(to);
      if (info.size <= rule.bytes || q <= 60) break;
      q -= 10;
    }
    out.push({ ...base, path: to, name: `${i + 1}.jpg`, mime: "image/jpeg", bytes: info.size, width: info.width, height: info.height });
  }
  return { media: out, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
