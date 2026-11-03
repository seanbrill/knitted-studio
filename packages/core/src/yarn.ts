// Yarn: raw material, imported once and used everywhere.
//
// EVERY way in (the upload route, paste, a URL, MCP, the notch.fm migration)
// ends in `importYarn`, so there is one set of rules for what a file must be:
// content-checked rather than trusted by its extension, SVG cleaned, hashed so a
// re-upload is recognised, probed for the facts the rest of the product needs,
// and stored under an id so renaming never touches the disk.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp, { type Sharp } from "sharp";
import type { Yarn, YarnKind, YarnMeta } from "./types.ts";
import { newId } from "./ids.ts";
import { NotFoundError, ValidationError, type Store } from "./store.ts";
import { hasTool, run } from "./proc.ts";
import { looksLikeSvg, sanitiseSvg } from "./svg.ts";
import { readFont } from "./fonts.ts";

const EXT: Record<string, { kind: YarnKind; mime: string }> = {
  ".png": { kind: "image", mime: "image/png" }, ".jpg": { kind: "image", mime: "image/jpeg" }, ".jpeg": { kind: "image", mime: "image/jpeg" },
  ".webp": { kind: "image", mime: "image/webp" }, ".gif": { kind: "image", mime: "image/gif" }, ".avif": { kind: "image", mime: "image/avif" },
  ".svg": { kind: "image", mime: "image/svg+xml" },
  ".mp4": { kind: "video", mime: "video/mp4" }, ".mov": { kind: "video", mime: "video/quicktime" }, ".webm": { kind: "video", mime: "video/webm" }, ".m4v": { kind: "video", mime: "video/mp4" },
  ".mp3": { kind: "audio", mime: "audio/mpeg" }, ".wav": { kind: "audio", mime: "audio/wav" }, ".m4a": { kind: "audio", mime: "audio/mp4" },
  ".ogg": { kind: "audio", mime: "audio/ogg" }, ".aac": { kind: "audio", mime: "audio/aac" }, ".flac": { kind: "audio", mime: "audio/flac" },
  ".ttf": { kind: "font", mime: "font/ttf" }, ".otf": { kind: "font", mime: "font/otf" }, ".woff": { kind: "font", mime: "font/woff" }, ".woff2": { kind: "font", mime: "font/woff2" },
  ".txt": { kind: "copy", mime: "text/plain" }, ".md": { kind: "copy", mime: "text/markdown" },
};
export const SUPPORTED = "PNG, JPG, WebP, GIF, AVIF, SVG, MP4, MOV, WebM, MP3, WAV, M4A, OGG, TTF, OTF, WOFF, WOFF2 or a text file";
export const DEFAULT_MAX_BYTES = 2 * 1024 ** 3;

type Row = Record<string, unknown>;

function toYarn(r: Row): Yarn {
  return {
    id: r.id as string, projectId: r.project_id as string, kind: r.kind as YarnKind, name: r.name as string, file: r.file as string,
    originalName: r.original_name as string, mime: r.mime as string, bytes: Number(r.bytes), hash: r.hash as string,
    width: r.width == null ? undefined : Number(r.width), height: r.height == null ? undefined : Number(r.height),
    durationMs: r.duration_ms == null ? undefined : Number(r.duration_ms),
    tags: JSON.parse(r.tags as string), meta: JSON.parse(r.meta as string) as YarnMeta,
    deletedAt: (r.deleted_at as string) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}

const cleanTag = (t: string) => t.trim().toLowerCase().replace(/[^a-z0-9 _-]/g, "").slice(0, 30);
const cleanTags = (tags: string[]) => [...new Set(tags.map(cleanTag).filter(Boolean))].slice(0, 20);
function displayName(raw: string): string {
  const base = basename(raw).replace(extname(raw), "").replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim();
  return (base || "Untitled").slice(0, 120);
}

export function yarnPath(store: Store, y: Pick<Yarn, "projectId" | "file">): string {
  return join(store.paths.yarnDir(y.projectId), y.file);
}
export function yarnThumbPath(store: Store, y: Pick<Yarn, "projectId" | "meta">): string | null {
  return y.meta.thumb ? join(store.paths.yarnDir(y.projectId), ".thumbs", y.meta.thumb) : null;
}
/**
 * A bigger preview than the thumbnail, for one picture shown large (a project's card):
 * 960 pixels on its longest side, made from the original the first time it is asked
 * for, and named by the file's hash, so a replaced file gets a new one. Only an image
 * has one; anything else, or an image that cannot be read, gets its thumbnail.
 */
export async function yarnPicturePath(store: Store, y: Yarn): Promise<string | null> {
  if (y.kind !== "image" || !y.meta.thumb) return yarnThumbPath(store, y);
  const out = largePath(store, y);
  try {
    await stat(out);
    return out;
  } catch { /* not made yet */ }
  const part = `${out}.${Math.random().toString(36).slice(2)}.part`;   // two requests at once each write their own
  try {
    await sharp(yarnPath(store, y), { animated: false }).rotate().resize(960, 960, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toFile(part);
    await rename(part, out);
    return out;
  } catch {
    await rm(part, { force: true });
    return yarnThumbPath(store, y);
  }
}
const largePath = (store: Store, y: Pick<Yarn, "id" | "projectId" | "hash">) => join(store.paths.yarnDir(y.projectId), ".thumbs", `${y.id}-${y.hash.slice(0, 10)}.large.webp`);
/** Where an in-flight upload is written. Inside the yarn dir so the final rename never crosses a filesystem. */
export function uploadTempPath(store: Store, projectId: string): string {
  return join(store.paths.yarnDir(projectId), ".tmp", `${newId("yn")}.part`);
}

/** Where an in-flight REPLACEMENT is written; same rule as a new upload. */
export const replaceTempPath = uploadTempPath;

// ── reads ────────────────────────────────────────────────────────────────────
export function getYarn(store: Store, id: string): Yarn {
  const r = store.db.prepare("select * from yarn where id = ?").get(id) as Row | undefined;
  if (!r) throw new NotFoundError("That file is not in Yarn any more.");
  return toYarn(r);
}

export function listYarn(store: Store, projectId: string, f: { kind?: string; q?: string; tag?: string; deleted?: boolean } = {}): Yarn[] {
  const rows = (store.db.prepare(`select * from yarn where project_id = ? and deleted_at is ${f.deleted ? "not null" : "null"} order by created_at desc, rowid desc`).all(projectId) as Row[]).map(toYarn);
  const q = f.q?.trim().toLowerCase();
  return rows.filter((y) => (!f.kind || y.kind === f.kind) && (!f.tag || y.tags.includes(f.tag)) && (!q || y.name.toLowerCase().includes(q) || y.tags.some((t) => t.includes(q))));
}

/** Where a piece of Yarn is used: every Pattern with a Stitch pointing at it. */
export function yarnUsage(store: Store, yarnId: string): { patternId: string; patternName: string; projectId: string }[] {
  const y = getYarn(store, yarnId);
  return store.listPatterns(y.projectId).filter((p) => p.stitches.some((s) => s.yarnId === yarnId)).map((p) => ({ patternId: p.id, patternName: p.name, projectId: p.projectId }));
}

// ── writes ───────────────────────────────────────────────────────────────────
export function updateYarn(store: Store, id: string, patch: { name?: string; tags?: string[] }): Yarn {
  const y = getYarn(store, id);
  const name = patch.name !== undefined ? displayName(patch.name + ".x") : y.name;
  const tags = patch.tags !== undefined ? cleanTags(patch.tags) : y.tags;
  store.write(() => store.db.prepare("update yarn set name = ?, tags = ?, updated_at = ? where id = ?").run(name, JSON.stringify(tags), new Date().toISOString(), id));
  return getYarn(store, id);
}

/** Soft delete, like projects: Undo is real, files go at purge time. */
export function deleteYarn(store: Store, id: string) {
  const y = getYarn(store, id);
  store.write(() => {
    store.db.prepare("update yarn set deleted_at = ?, updated_at = ? where id = ?").run(new Date().toISOString(), new Date().toISOString(), id);
    store.logRow(y.projectId, "human", "yarn.deleted", y.name, null);
  });
}
export function undeleteYarn(store: Store, id: string) {
  getYarn(store, id);
  store.write(() => store.db.prepare("update yarn set deleted_at = null, updated_at = ? where id = ?").run(new Date().toISOString(), id));
}
export async function purgeDeletedYarn(store: Store, olderThanMs = 24 * 3600_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const rows = (store.db.prepare("select * from yarn where deleted_at is not null and deleted_at <= ?").all(cutoff) as Row[]).map(toYarn);
  for (const y of rows) {
    await rm(yarnPath(store, y), { force: true });
    const t = yarnThumbPath(store, y);
    if (t) await rm(t, { force: true });
    await rm(largePath(store, y), { force: true });
    store.write(() => store.db.prepare("delete from yarn where id = ?").run(y.id));
  }
  return rows.length;
}

export async function createCopy(store: Store, projectId: string, input: { name: string; text: string }): Promise<{ yarn: Yarn; existing: boolean }> {
  const text = String(input.text ?? "");
  if (!text.trim()) throw new ValidationError("Write some copy first.");
  const tmp = await writeTemp(store, projectId, Buffer.from(text, "utf8"));
  return importYarn(store, projectId, tmp, `${input.name || "Copy"}.txt`, { name: input.name || "Copy" });
}

async function writeTemp(store: Store, projectId: string, data: Buffer): Promise<string> {
  const tmp = uploadTempPath(store, projectId);
  await mkdir(join(tmp, ".."), { recursive: true });
  await writeFile(tmp, data);
  return tmp;
}

async function sha256(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

/** Up to five distinct, representative colours, as hex. Feeds Swatch extraction. */
async function dominantColors(img: Sharp): Promise<{ colors: string[]; hasAlpha: boolean }> {
  const { data, info } = await img.clone().resize(48, 48, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let hasAlpha = false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) { hasAlpha = true; continue; }
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
    buckets.set(key, b);
  }
  void info;
  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n).map((b) => [Math.round(b.r / b.n), Math.round(b.g / b.n), Math.round(b.b / b.n)] as const);
  const picked: (readonly [number, number, number])[] = [];
  for (const c of ranked) {
    if (picked.every((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) > 56)) picked.push(c);
    if (picked.length === 5) break;
  }
  return { colors: picked.map(([r, g, b]) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")), hasAlpha };
}

async function probe(file: string): Promise<{ durationMs?: number; width?: number; height?: number; fps?: number; hasAudio: boolean; hasVideo: boolean }> {
  const { out } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]);
  const j = JSON.parse(out.toString("utf8")) as { streams?: Record<string, string>[]; format?: { duration?: string } };
  const v = j.streams?.find((s) => s.codec_type === "video" && s.disposition !== "attached_pic");
  const a = j.streams?.find((s) => s.codec_type === "audio");
  const [num, den] = (v?.avg_frame_rate ?? "0/1").split("/").map(Number);
  const dur = Number(j.format?.duration ?? v?.duration ?? a?.duration);
  return { durationMs: Number.isFinite(dur) ? Math.round(dur * 1000) : undefined, width: v ? Number(v.width) : undefined, height: v ? Number(v.height) : undefined, fps: den ? Math.round((num / den) * 100) / 100 : undefined, hasAudio: !!a, hasVideo: !!v };
}

export interface ImportOptions { name?: string; tags?: string[]; replaceId?: string; maxBytes?: number; actor?: "human" | "model" | "import"; }
export interface ImportResult { yarn: Yarn; existing: boolean; }

/**
 * Take a finished file at `tmpPath` and make it Yarn. The file is MOVED into the
 * library (or deleted if it turns out to be a duplicate or invalid), so the
 * caller never has to clean up after a failure.
 */
export async function importYarn(store: Store, projectId: string, tmpPath: string, originalName: string, opts: ImportOptions = {}): Promise<ImportResult> {
  try {
    store.getProject(projectId);
    const ext = extname(originalName).toLowerCase();
    const spec = EXT[ext];
    if (!spec) throw new ValidationError(`knitted cannot use ${ext || "that kind of file"} yet. Try ${SUPPORTED}.`);
    const bytes = (await stat(tmpPath)).size;
    const max = opts.maxBytes ?? store.getSetting("yarn.maxBytes", DEFAULT_MAX_BYTES);
    if (bytes === 0) throw new ValidationError("That file is empty.");
    if (bytes > max) throw new ValidationError(`That file is ${(bytes / 1024 ** 3).toFixed(1)}GB. The limit is ${(max / 1024 ** 3).toFixed(0)}GB; raise it in Settings or trim it first.`);

    const hash = await sha256(tmpPath);
    if (!opts.replaceId) {
      const dup = store.db.prepare("select * from yarn where project_id = ? and hash = ? and deleted_at is null limit 1").get(projectId, hash) as Row | undefined;
      if (dup) { await rm(tmpPath, { force: true }); return { yarn: toYarn(dup), existing: true }; }
    }

    const id = opts.replaceId ?? newId("yn");
    const dir = store.paths.yarnDir(projectId);
    const file = `${id}${ext}`;
    const final = join(dir, file);
    const meta: YarnMeta = { warnings: [] };
    const warn = (w: string) => meta.warnings!.push(w);
    let width: number | undefined, height: number | undefined, durationMs: number | undefined;
    await mkdir(join(dir, ".thumbs"), { recursive: true });
    const thumbBase = join(dir, ".thumbs", id);

    if (spec.kind === "image") {
      let buf = await readFile(tmpPath);
      if (ext === ".svg") {
        if (!looksLikeSvg(buf)) throw new ValidationError("That file says it is an SVG but is not one.");
        const clean = sanitiseSvg(buf.toString("utf8"));
        if (clean.changed) { buf = Buffer.from(clean.svg, "utf8"); await writeFile(tmpPath, buf); warn("Scripts and external links were removed from this SVG for safety."); }
      }
      let img: Sharp;
      try { img = sharp(buf, { animated: false }); const m = await img.metadata(); width = m.width; height = m.height; if (!m.format) throw new Error("no format"); }
      catch { throw new ValidationError(`That file is not a real ${ext.slice(1).toUpperCase()} image. It may be corrupt or renamed from something else.`); }
      const c = await dominantColors(sharp(buf));
      meta.colors = c.colors; meta.hasAlpha = c.hasAlpha;
      await sharp(buf).rotate().resize(320, 320, { fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toFile(`${thumbBase}.webp`);
      meta.thumb = `${id}.webp`;
      if (width && width < 1000 && /logo|mark|wordmark/i.test(originalName + " " + (opts.name ?? ""))) warn(`That logo is ${width}px wide. Upload one at least 1000px wide to print sharp.`);
      else if (width && width < 600 && ext !== ".svg") warn(`This image is only ${width}px wide, so it may look soft on a large post.`);
    } else if (spec.kind === "video" || spec.kind === "audio") {
      if (await hasTool("ffprobe")) {
        let p;
        try { p = await probe(tmpPath); } catch { throw new ValidationError(`That file could not be read as ${spec.kind}. It may be corrupt, or in a format knitted does not know.`); }
        if (spec.kind === "video" && !p.hasVideo) throw new ValidationError("That file has no video in it.");
        if (spec.kind === "audio" && !p.hasAudio) throw new ValidationError("That file has no audio in it.");
        width = p.width; height = p.height; durationMs = p.durationMs; meta.fps = p.fps; meta.hasAudio = p.hasAudio;
        if (spec.kind === "video" && (await hasTool("ffmpeg"))) {
          try {
            const at = Math.min(0.5, (durationMs ?? 1000) / 2000);
            const jpg = `${thumbBase}.jpg`;
            await run("ffmpeg", ["-v", "error", "-y", "-ss", String(at), "-i", tmpPath, "-frames:v", "1", "-vf", "scale=320:-2", jpg]);
            meta.thumb = `${id}.jpg`;
            const c = await dominantColors(sharp(jpg)); meta.colors = c.colors;
          } catch { warn("A preview frame could not be made for this video."); }
        }
        if (spec.kind === "audio" && (await hasTool("ffmpeg"))) {
          try {
            const { out } = await run("ffmpeg", ["-v", "error", "-i", tmpPath, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { timeoutMs: 120_000 });
            const n = Math.floor(out.length / 2), bins = Math.min(160, Math.max(1, n));
            const peaks: number[] = [];
            for (let b = 0; b < bins; b++) {
              let m = 0;
              for (let i = Math.floor((b * n) / bins); i < Math.floor(((b + 1) * n) / bins); i++) m = Math.max(m, Math.abs(out.readInt16LE(i * 2)));
              peaks.push(Math.round((m / 32768) * 100) / 100);
            }
            meta.peaks = peaks;
          } catch { /* a waveform is a nicety */ }
        }
      } else warn("Install ffmpeg to preview and measure video and audio. The file is stored and will still knit once ffmpeg is available.");
    } else if (spec.kind === "font") {
      const f = readFont(await readFile(tmpPath));
      if (!f) throw new ValidationError("That file is not a font that knitted can read.");
      meta.family = f.family ?? displayName(originalName);
      meta.weight = f.weight;
    } else if (spec.kind === "copy") {
      const text = await readFile(tmpPath, "utf8");
      if (text.includes("\u0000")) throw new ValidationError("That does not look like a text file.");
      if (bytes > 1024 * 1024) throw new ValidationError("Copy over 1MB is probably not copy. Split it up.");
      meta.text = text;
    }
    if (!meta.warnings!.length) delete meta.warnings;

    await mkdir(dir, { recursive: true });
    let prior: Yarn | undefined;
    if (opts.replaceId) prior = getYarn(store, opts.replaceId);
    try { await rename(tmpPath, final); } catch { await copyFile(tmpPath, final); await rm(tmpPath, { force: true }); }

    const now = new Date().toISOString();
    const name = opts.name ? displayName(opts.name + ".x") : displayName(originalName);
    const tags = cleanTags(opts.tags ?? []);
    store.write(() => {
      if (opts.replaceId) {
        store.db.prepare("update yarn set file = ?, original_name = ?, mime = ?, bytes = ?, hash = ?, width = ?, height = ?, duration_ms = ?, meta = ?, updated_at = ? where id = ?")
          .run(file, basename(originalName), spec.mime, bytes, hash, width ?? null, height ?? null, durationMs ?? null, JSON.stringify(meta), now, id);
      } else {
        store.db.prepare("insert into yarn (id, project_id, kind, name, file, original_name, mime, bytes, hash, width, height, duration_ms, tags, meta, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(id, projectId, spec.kind, name, file, basename(originalName), spec.mime, bytes, hash, width ?? null, height ?? null, durationMs ?? null, JSON.stringify(tags), JSON.stringify(meta), now, now);
        store.logRow(projectId, opts.actor ?? "human", "yarn.imported", name, { kind: spec.kind });
      }
      store.db.prepare("update projects set updated_at = ? where id = ?").run(now, projectId);
    });
    if (prior && prior.file !== file) await rm(yarnPath(store, prior), { force: true });
    if (prior && prior.hash !== hash) await rm(largePath(store, prior), { force: true });
    return { yarn: getYarn(store, id), existing: false };
  } catch (e) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw e;
  }
}

// ── from a URL ───────────────────────────────────────────────────────────────
function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const l = ip.toLowerCase();
    return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:127.") || l.startsWith("::ffff:10.") || l.startsWith("::ffff:192.168.");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Refuse anything that is not a public http(s) address: a URL import must not be a way to reach the user's own network. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new ValidationError("That is not a web address. Paste a full link starting with https://."); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new ValidationError("Only http and https links can be imported.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw new ValidationError(`Could not find ${host}. Check the link.`); });
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new ValidationError("That link points at your own computer or network, which knitted will not fetch.");
  return u;
}

export async function importYarnFromUrl(store: Store, projectId: string, rawUrl: string, opts: ImportOptions = {}): Promise<ImportResult> {
  const max = opts.maxBytes ?? 200 * 1024 * 1024;
  let url = await assertPublicUrl(rawUrl);
  let res: Response | undefined;
  for (let hop = 0; hop < 4; hop++) {
    res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000), headers: { "user-agent": "knitted.studio" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = await assertPublicUrl(new URL(res.headers.get("location")!, url).href); continue; }
    break;
  }
  if (!res || !res.ok || !res.body) throw new ValidationError(`That link answered ${res?.status ?? "nothing"}. Check it opens in a browser.`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) throw new ValidationError("That file is too large to import from a link. Download it and upload it instead.");
  const tmp = uploadTempPath(store, projectId);
  await mkdir(join(tmp, ".."), { recursive: true });
  const { createWriteStream } = await import("node:fs");
  const { Readable } = await import("node:stream");
  const { pipeline } = await import("node:stream/promises");
  let got = 0;
  const limit = new (await import("node:stream")).Transform({ transform(c, _e, cb) { got += c.length; if (got > max) cb(new ValidationError("That file is too large to import from a link.")); else cb(null, c); } });
  try { await pipeline(Readable.fromWeb(res.body as never), limit, createWriteStream(tmp)); }
  catch (e) { await rm(tmp, { force: true }); throw e; }
  let name = basename(url.pathname) || "download";
  if (!extname(name)) {
    const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    const ext = Object.entries(EXT).find(([, v]) => v.mime === ct)?.[0];
    if (ext) name += ext;
  }
  return importYarn(store, projectId, tmp, name, opts);
}
