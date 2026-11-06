// Yarn: raw material, imported once and used everywhere.
//
// EVERY way in (the upload route, paste, a URL, MCP, the notch.fm migration)
// ends in `importYarn`, so there is one set of rules for what a file must be:
// content-checked rather than trusted by its extension, SVG cleaned, hashed so a
// re-upload is recognised, probed for the facts the rest of the product needs,
// and stored under an id so renaming never touches the disk.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp, { type Sharp } from "sharp";
import type { CropBox, Shelf, Yarn, YarnKind, YarnMeta } from "./types.ts";
import { newId } from "./ids.ts";
import { NotFoundError, ValidationError, type Store } from "./store.ts";
import { hasTool, run } from "./proc.ts";
import { looksLikeSvg, sanitiseSvg } from "./svg.ts";
import { readFont } from "./fonts.ts";
import { cleanFolder, fileInto, folderNamed } from "./folders.ts";
import { isInside } from "./folders-pure.ts";
import { drawPdfPage, readPdf, PDF_MAX_SIDE } from "./pdf.ts";

const EXT: Record<string, { kind: YarnKind; mime: string }> = {
  ".png": { kind: "image", mime: "image/png" }, ".jpg": { kind: "image", mime: "image/jpeg" }, ".jpeg": { kind: "image", mime: "image/jpeg" },
  ".webp": { kind: "image", mime: "image/webp" }, ".gif": { kind: "image", mime: "image/gif" }, ".avif": { kind: "image", mime: "image/avif" },
  ".svg": { kind: "image", mime: "image/svg+xml" },
  ".mp4": { kind: "video", mime: "video/mp4" }, ".mov": { kind: "video", mime: "video/quicktime" }, ".webm": { kind: "video", mime: "video/webm" }, ".m4v": { kind: "video", mime: "video/mp4" },
  ".mp3": { kind: "audio", mime: "audio/mpeg" }, ".wav": { kind: "audio", mime: "audio/wav" }, ".m4a": { kind: "audio", mime: "audio/mp4" },
  ".ogg": { kind: "audio", mime: "audio/ogg" }, ".aac": { kind: "audio", mime: "audio/aac" }, ".flac": { kind: "audio", mime: "audio/flac" },
  ".ttf": { kind: "font", mime: "font/ttf" }, ".otf": { kind: "font", mime: "font/otf" }, ".woff": { kind: "font", mime: "font/woff" }, ".woff2": { kind: "font", mime: "font/woff2" },
  ".txt": { kind: "copy", mime: "text/plain" }, ".md": { kind: "copy", mime: "text/markdown" },
  ".pdf": { kind: "pdf", mime: "application/pdf" },
};
export const SUPPORTED = "PNG, JPG, WebP, GIF, AVIF, SVG, MP4, MOV, WebM, MP3, WAV, M4A, OGG, TTF, OTF, WOFF, WOFF2, PDF or a text file";
/** A shelf, as a person reads it. */
export const SHELF_NAME: Record<Shelf, string> = { yarn: "Yarn", reference: "the reference" };
const KIND_WORD: Record<YarnKind, string> = { image: "a picture", video: "a video", audio: "a sound", font: "a font", copy: "copy", pdf: "a PDF" };
export function cleanShelf(s: unknown): Shelf {
  if (s === undefined || s === null || s === "" || s === "yarn") return "yarn";
  if (s === "reference") return "reference";
  throw new ValidationError("A file is in Yarn or in the reference: say yarn or reference.");
}
export const DEFAULT_MAX_BYTES = 2 * 1024 ** 3;

type Row = Record<string, unknown>;

function toYarn(r: Row): Yarn {
  return {
    id: r.id as string, projectId: r.project_id as string, kind: r.kind as YarnKind, shelf: (r.shelf as Shelf) ?? "yarn", name: r.name as string, file: r.file as string,
    originalName: r.original_name as string, mime: r.mime as string, bytes: Number(r.bytes), hash: r.hash as string,
    width: r.width == null ? undefined : Number(r.width), height: r.height == null ? undefined : Number(r.height),
    durationMs: r.duration_ms == null ? undefined : Number(r.duration_ms),
    tags: JSON.parse(r.tags as string), folder: (r.folder as string) ?? "", meta: JSON.parse(r.meta as string) as YarnMeta,
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

/** `folder`: only what is in that folder, or in the folders inside it. `shelf`: Yarn, unless it says the reference. */
export function listYarn(store: Store, projectId: string, f: { kind?: string; q?: string; tag?: string; folder?: string; deleted?: boolean; shelf?: Shelf } = {}): Yarn[] {
  const shelf = cleanShelf(f.shelf);
  const rows = (store.db.prepare(`select * from yarn where project_id = ? and shelf = ? and deleted_at is ${f.deleted ? "not null" : "null"} order by created_at desc, rowid desc`).all(projectId, shelf) as Row[]).map(toYarn);
  const q = f.q?.trim().toLowerCase();
  const folder = folderNamed(store, projectId, shelf, f.folder);
  return rows.filter((y) => (!f.kind || y.kind === f.kind) && (!f.tag || y.tags.includes(f.tag)) && isInside(y.folder, folder) && (!q || y.name.toLowerCase().includes(q) || y.tags.some((t) => t.includes(q))));
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
    store.logRow(y.projectId, "human", "yarn.deleted", y.name, { shelf: y.shelf });
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
    await dropDrawn(store, y);
    store.write(() => store.db.prepare("delete from yarn where id = ?").run(y.id));
  }
  return rows.length;
}

/** What was made from a file besides its thumbnail, named for it: a PDF's text and its pages, drawn. */
async function dropDrawn(store: Store, y: Pick<Yarn, "id" | "projectId">, keepHash?: string) {
  const dir = store.paths.yarnDir(y.projectId);
  for (const sub of [".text", ".thumbs"]) {
    const names = await readdir(join(dir, sub)).catch(() => [] as string[]);
    for (const n of names) if (n.startsWith(`${y.id}-`) && /-p\d+-|\.json$/.test(n) && !(keepHash && n.startsWith(`${y.id}-${keepHash.slice(0, 10)}`))) await rm(join(dir, sub, n), { force: true });
  }
}

export async function createCopy(store: Store, projectId: string, input: { name: string; text: string; tags?: string[]; folder?: string; shelf?: Shelf }, actor: ImportOptions["actor"] = "human"): Promise<{ yarn: Yarn; existing: boolean }> {
  const text = String(input.text ?? "");
  if (!text.trim()) throw new ValidationError("Write some copy first.");
  cleanFolder(input.folder);
  const shelf = cleanShelf(input.shelf);
  const tmp = await writeTemp(store, projectId, Buffer.from(text, "utf8"));
  return importYarn(store, projectId, tmp, `${input.name || "Copy"}.txt`, { name: input.name || (shelf === "reference" ? "Note" : "Copy"), tags: input.tags, folder: input.folder, actor, shelf });
}

/**
 * New text for a piece of copy, which keeps its id, name, tags and folder: a model's note
 * brought up to date, instead of a second one saved beside it. The project's Activity says
 * who changed it.
 */
export async function setCopyText(store: Store, id: string, text: string, actor: ImportOptions["actor"] = "human"): Promise<{ yarn: Yarn; changed: boolean }> {
  const y = getYarn(store, id);
  if (y.deletedAt) throw new NotFoundError("That copy is not in Yarn any more.");
  if (y.kind !== "copy") throw new ValidationError(`${y.name} is a file, not copy, so it has no text to change.`);
  text = String(text ?? "");
  if (!text.trim()) throw new ValidationError("Write some copy first.");
  if (text === y.meta.text) return { yarn: y, changed: false };
  const tmp = await writeTemp(store, y.projectId, Buffer.from(text, "utf8"));
  const r = await importYarn(store, y.projectId, tmp, y.originalName || `${y.name}.txt`, { replaceId: y.id, actor });
  store.write(() => store.logRow(y.projectId, actor, "yarn.changed", y.name, { kind: "copy" }));
  return { yarn: r.yarn, changed: true };
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
export async function dominantColors(img: Sharp): Promise<{ colors: string[]; hasAlpha: boolean }> {
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

/**
 * `folder`: the folder a new file goes in, made when it is not there. A file already there stays
 * where it is. `shelf`: Yarn, or the Brief's reference, each with folders of its own. The same
 * file may be on both: the reference is what a model looks at, Yarn what a pattern uses.
 */
export interface ImportOptions { name?: string; tags?: string[]; folder?: string; replaceId?: string; maxBytes?: number; actor?: "human" | "model" | "import"; shelf?: Shelf; /** Set by cropToYarn: what it was cut from. */ from?: YarnMeta["from"]; /** Set by the engine's site pictures: the page it shows. */ site?: YarnMeta["site"]; /** Not said in the project's Activity: a batch of many says what it did once. */ quiet?: boolean; }
export interface ImportResult { yarn: Yarn; existing: boolean; }

// A PDF's text is kept beside it, page by page, not in its row: a long one is megabytes, and
// every list of Yarn would carry it.
const pdfTextPath = (store: Store, y: Pick<Yarn, "id" | "projectId" | "hash">) => join(store.paths.yarnDir(y.projectId), ".text", `${y.id}-${y.hash.slice(0, 10)}.json`);

/**
 * Take a finished file at `tmpPath` and make it Yarn. The file is MOVED into the
 * library (or deleted if it turns out to be a duplicate or invalid), so the
 * caller never has to clean up after a failure.
 */
export async function importYarn(store: Store, projectId: string, tmpPath: string, originalName: string, opts: ImportOptions = {}): Promise<ImportResult> {
  let pdfTexts: string[] | undefined;
  try {
    store.getProject(projectId);
    cleanFolder(opts.folder);
    const replacing = opts.replaceId ? getYarn(store, opts.replaceId) : undefined;
    const shelf = replacing?.shelf ?? cleanShelf(opts.shelf);
    const ext = extname(originalName).toLowerCase();
    const spec = EXT[ext];
    if (!spec) throw new ValidationError(`knitted cannot use ${ext || "that kind of file"} yet. Try ${SUPPORTED}.`);
    // What uses a file uses it as what it is: a picture's slot cannot show a PDF.
    if (replacing && replacing.kind !== spec.kind) throw new ValidationError(`${replacing.name} is ${KIND_WORD[replacing.kind]}, and that is ${KIND_WORD[spec.kind]}. Replace it with ${KIND_WORD[replacing.kind]}, or add the new file on its own.`);
    const bytes = (await stat(tmpPath)).size;
    const max = opts.maxBytes ?? store.getSetting("yarn.maxBytes", DEFAULT_MAX_BYTES);
    if (bytes === 0) throw new ValidationError("That file is empty.");
    if (bytes > max) throw new ValidationError(`That file is ${(bytes / 1024 ** 3).toFixed(1)}GB. The limit is ${(max / 1024 ** 3).toFixed(0)}GB; raise it in Settings or trim it first.`);

    const hash = await sha256(tmpPath);
    if (!opts.replaceId) {
      const dup = store.db.prepare("select * from yarn where project_id = ? and shelf = ? and hash = ? and deleted_at is null limit 1").get(projectId, shelf, hash) as Row | undefined;
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
      // A file with no readable name goes by the name it was given, then its filename (often a hash).
      meta.family = f.family || opts.name?.trim() || displayName(originalName);
      meta.weight = f.weight;
    } else if (spec.kind === "copy") {
      const text = await readFile(tmpPath, "utf8");
      if (text.includes("\u0000")) throw new ValidationError("That does not look like a text file.");
      if (bytes > 1024 * 1024) throw new ValidationError("Copy over 1MB is probably not copy. Split it up.");
      meta.text = text;
    } else if (spec.kind === "pdf") {
      const buf = await readFile(tmpPath);
      if (!buf.subarray(0, 1024).toString("latin1").includes("%PDF-")) throw new ValidationError("That file says it is a PDF but is not one.");
      const pdf = await readPdf(buf);
      width = Math.round(pdf.width); height = Math.round(pdf.height);
      meta.pages = pdf.pages;
      pdfTexts = pdf.texts;
      meta.textChars = pdf.texts.reduce((n, t) => n + t.length, 0);
      if (!meta.textChars) warn("This PDF has no text in it, only pictures of pages, like a scan. Your model can look at its pages, but cannot read it as text.");
      try {
        const page = await drawPdfPage(buf, 0, 640);
        const img = sharp(page.data, { raw: { width: page.width, height: page.height, channels: 4 } });
        await img.clone().resize(320, 320, { fit: "inside" }).webp({ quality: 78 }).toFile(`${thumbBase}.webp`);
        meta.thumb = `${id}.webp`;
        meta.colors = (await dominantColors(img)).colors;
      } catch { warn("Its first page could not be drawn, so it has no picture here."); }
    }
    if (!meta.warnings!.length) delete meta.warnings;

    if (opts.from) meta.from = opts.from;
    if (opts.site) meta.site = opts.site;

    await mkdir(dir, { recursive: true });
    const prior = replacing;
    if (pdfTexts) {
      await mkdir(join(dir, ".text"), { recursive: true });
      await writeFile(pdfTextPath(store, { id, projectId, hash }), JSON.stringify({ pages: pdfTexts }));
    }
    try { await rename(tmpPath, final); } catch { await copyFile(tmpPath, final); await rm(tmpPath, { force: true }); }

    const now = new Date().toISOString();
    const name = opts.name ? displayName(opts.name + ".x") : displayName(originalName);
    const tags = cleanTags(opts.tags ?? []);
    store.write(() => {
      if (opts.replaceId) {
        store.db.prepare("update yarn set file = ?, original_name = ?, mime = ?, bytes = ?, hash = ?, width = ?, height = ?, duration_ms = ?, meta = ?, updated_at = ? where id = ?")
          .run(file, basename(originalName), spec.mime, bytes, hash, width ?? null, height ?? null, durationMs ?? null, JSON.stringify(meta), now, id);
      } else {
        store.db.prepare("insert into yarn (id, project_id, kind, shelf, name, file, original_name, mime, bytes, hash, width, height, duration_ms, tags, folder, meta, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(id, projectId, spec.kind, shelf, name, file, basename(originalName), spec.mime, bytes, hash, width ?? null, height ?? null, durationMs ?? null, JSON.stringify(tags), fileInto(store, projectId, shelf, opts.folder), JSON.stringify(meta), now, now);
        if (!opts.quiet) store.logRow(projectId, opts.actor ?? "human", "yarn.imported", name, { kind: spec.kind, shelf, ...(opts.from ? { from: opts.from.name } : {}) });
      }
      store.db.prepare("update projects set updated_at = ? where id = ?").run(now, projectId);
    });
    if (prior && prior.file !== file) await rm(yarnPath(store, prior), { force: true });
    if (prior && prior.hash !== hash) { await rm(largePath(store, prior), { force: true }); await dropDrawn(store, prior, hash); }
    return { yarn: getYarn(store, id), existing: false };
  } catch (e) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw e;
  }
}

// ── a PDF's pages and text ───────────────────────────────────────────────────
// The sizes a page is drawn at, each kept once it is made: a list's picture, a page to read,
// one to look closely at, and the most a model is sent.
const PAGE_SIZES = [320, 800, 1600, 2400];

function pagesOf(y: Yarn, page: number): void {
  if (y.kind !== "pdf") throw new ValidationError(`${y.name} is ${KIND_WORD[y.kind]}, with no pages.`);
  const n = y.meta.pages ?? 1;
  if (!Number.isInteger(page) || page < 1 || page > n) throw new ValidationError(`${y.name} has ${n} page${n === 1 ? "" : "s"}. Ask for one from 1 to ${n}.`);
}

/** A PDF's text, page by page, the first page first. A page with none was a picture, like a scan. */
export async function pdfText(store: Store, y: Yarn): Promise<string[]> {
  if (y.kind !== "pdf") throw new ValidationError(`${y.name} is ${KIND_WORD[y.kind]}, not a PDF.`);
  const at = pdfTextPath(store, y);
  try { return (JSON.parse(await readFile(at, "utf8")) as { pages: string[] }).pages; }
  catch { /* not kept beside it: read from the PDF, and kept now */ }
  const { texts } = await readPdf(await readFile(yarnPath(store, y)));
  await mkdir(join(at, ".."), { recursive: true });
  await writeFile(at, JSON.stringify({ pages: texts }));
  return texts;
}

/**
 * One page of a PDF as a picture, about `px` on its longest side (the next size up it is kept
 * at), drawn the first time it is asked for. Pages count from 1, as a person counts them.
 */
export async function pdfPagePath(store: Store, y: Yarn, page: number, px = 1600): Promise<string> {
  pagesOf(y, page);
  const size = PAGE_SIZES.find((s) => s >= px) ?? PAGE_SIZES.at(-1)!;
  const out = join(store.paths.yarnDir(y.projectId), ".thumbs", `${y.id}-${y.hash.slice(0, 10)}-p${page}-${size}.webp`);
  try { await stat(out); return out; } catch { /* not drawn yet */ }
  const drawn = await drawPdfPage(await readFile(yarnPath(store, y)), page - 1, size);
  await mkdir(join(out, ".."), { recursive: true });
  const part = `${out}.${Math.random().toString(36).slice(2)}.part`;   // two requests at once each write their own
  try {
    await sharp(drawn.data, { raw: { width: drawn.width, height: drawn.height, channels: 4 } }).webp({ quality: 82 }).toFile(part);
    await rename(part, out);
  } catch (e) { await rm(part, { force: true }); throw e; }
  return out;
}

// ── a part of a picture, cut out ─────────────────────────────────────────────
function cleanBox(b: unknown): CropBox {
  const o = (b ?? {}) as Record<string, unknown>;
  const n = (k: string) => { const v = Number(o[k]); if (!Number.isFinite(v)) throw new ValidationError("Say which part to keep as x, y, w and h, each a fraction from 0 to 1 of the width or height, from the top left."); return v; };
  let x = n("x"), y = n("y"), w = n("w"), h = n("h");
  x = Math.min(1, Math.max(0, x)); y = Math.min(1, Math.max(0, y));
  w = Math.min(1 - x, Math.max(0, w)); h = Math.min(1 - y, Math.max(0, h));
  if (w <= 0 || h <= 0) throw new ValidationError("That part has no size. Frame some of the picture.");
  return { x, y, w, h };
}

/** A picture's pixels the right way up, or a PDF page's drawn PDF_MAX_SIDE on its longest side: what a crop or a look cuts from. */
async function pixelsOf(store: Store, src: Yarn, asked: number | undefined): Promise<{ img: Sharp; W: number; H: number; page?: number }> {
  if (src.kind === "pdf") {
    const page = asked ?? 1;
    pagesOf(src, page);
    const drawn = await drawPdfPage(await readFile(yarnPath(store, src)), page - 1, PDF_MAX_SIDE);
    return { img: sharp(drawn.data, { raw: { width: drawn.width, height: drawn.height, channels: 4 } }), W: drawn.width, H: drawn.height, page };
  }
  if (asked !== undefined && asked !== 1) throw new ValidationError(`${src.name} is a picture, with no pages.`);
  const file = yarnPath(store, src);
  let density: number | undefined;
  if (src.mime === "image/svg+xml") {
    // A drawing has no pixels of its own: drawn big enough that the part kept is sharp.
    const m = await sharp(file).metadata();
    density = Math.min(2400, Math.max(72, Math.round((72 * PDF_MAX_SIDE) / Math.max(m.width ?? 1, m.height ?? 1, 1))));
  }
  const m = await sharp(file, { animated: false, ...(density ? { density } : {}) }).metadata();
  // The picture the right way up, as it is shown: a phone's photo can be stored on its side.
  const turned = (m.orientation ?? 1) >= 5;
  return { img: sharp(file, { animated: false, ...(density ? { density } : {}) }).autoOrient(), W: (turned ? m.height : m.width) ?? 0, H: (turned ? m.width : m.height) ?? 0 };
}

export interface CropOptions {
  box: CropBox;
  /** A PDF's page, from 1. */
  page?: number;
  name?: string; tags?: string[];
  /** Where the new picture goes: Yarn unless it says the reference, and the folder it was in when that is the same shelf. */
  shelf?: Shelf; folder?: string;
  actor?: ImportOptions["actor"];
}

/**
 * A new picture cut from a picture, or from a page of a PDF: the part `box` frames, with every
 * pixel the original has there (a PDF's page is drawn PDF_MAX_SIDE pixels on its longest side
 * to cut from). The original is not changed, and the new one says where it came from.
 */
export async function cropToYarn(store: Store, sourceId: string, o: CropOptions): Promise<ImportResult> {
  const src = getYarn(store, sourceId);
  if (src.deletedAt) throw new NotFoundError(`${src.name} is not in ${SHELF_NAME[src.shelf]} any more.`);
  if (src.kind !== "image" && src.kind !== "pdf") throw new ValidationError(`Only a picture or a PDF can be cropped, and ${src.name} is ${KIND_WORD[src.kind]}.`);
  const box = cleanBox(o.box);
  const shelf = cleanShelf(o.shelf);
  cleanFolder(o.folder);
  const { img, W, H, page } = await pixelsOf(store, src, o.page);
  const left = Math.min(W - 1, Math.round(box.x * W)), top = Math.min(H - 1, Math.round(box.y * H));
  const width = Math.max(1, Math.min(W - left, Math.round(box.w * W))), height = Math.max(1, Math.min(H - top, Math.round(box.h * H)));
  if (width < 8 || height < 8) throw new ValidationError(`That part would be ${width} by ${height} pixels, too small to use. Frame more of it.`);
  const jpeg = src.mime === "image/jpeg";
  const cut = img.extract({ left, top, width, height });
  const tmp = await writeTemp(store, src.projectId, await (jpeg ? cut.jpeg({ quality: 92 }) : cut.png()).toBuffer());
  const name = o.name?.trim() || (page ? `${src.name}, page ${page}` : `${src.name}, cropped`);
  const folder = o.folder ?? (shelf === src.shelf ? src.folder || undefined : undefined);
  return importYarn(store, src.projectId, tmp, `${name}${jpeg ? ".jpg" : ".png"}`, { name, tags: o.tags ?? src.tags, folder, shelf, actor: o.actor, from: { id: src.id, name: src.name, ...(page ? { page } : {}), box } });
}

// The most a model is sent of a picture on its longest side, and how tall a part of a long one
// is, for its width: a page pictured the whole way down is shown a screen or two at a time.
const VIEW_SIDE = 1568;
const VIEW_TALL = 2;

export interface YarnView { data: Buffer; mime: "image/jpeg"; width: number; height: number; box: CropBox; page?: number; pages?: number; more: boolean }

/**
 * A picture, or a page of a PDF, for a model to look at: the part `box` frames, or the whole of
 * it, or the top of one much taller than it is wide (`more` says there is more below, and the
 * box to ask for the next part is the one after this). Never kept: it is made each time.
 */
export async function viewYarn(store: Store, id: string, o: { page?: number; box?: CropBox } = {}): Promise<YarnView> {
  const src = getYarn(store, id);
  if (src.kind !== "image" && src.kind !== "pdf") throw new ValidationError(`${src.name} is ${KIND_WORD[src.kind]}, not a picture or a PDF.`);
  const { img, W, H, page } = await pixelsOf(store, src, o.page);
  const box = o.box ? cleanBox(o.box) : H / W > VIEW_TALL * 1.25 ? { x: 0, y: 0, w: 1, h: (W * VIEW_TALL) / H } : { x: 0, y: 0, w: 1, h: 1 };
  const left = Math.min(W - 1, Math.round(box.x * W)), top = Math.min(H - 1, Math.round(box.y * H));
  const width = Math.max(1, Math.min(W - left, Math.round(box.w * W))), height = Math.max(1, Math.min(H - top, Math.round(box.h * H)));
  const { data, info } = await img.extract({ left, top, width, height }).resize(VIEW_SIDE, VIEW_SIDE, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
  return { data, mime: "image/jpeg", width: info.width, height: info.height, box, ...(page ? { page, pages: src.meta.pages ?? 1 } : {}), more: box.y + box.h < 0.999 };
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
  cleanFolder(opts.folder);
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
  let got = 0;
  const limit = new Transform({ transform(c, _e, cb) { got += c.length; if (got > max) cb(new ValidationError("That file is too large to import from a link.")); else cb(null, c); } });
  try { await pipeline(Readable.fromWeb(res.body as never), limit, createWriteStream(tmp)); }
  catch (e) { await rm(tmp, { force: true }); throw e; }
  // The path as the link spells it: "Hero%20photo.png" is called Hero photo.
  let name = basename(url.pathname) || "download";
  try { name = decodeURIComponent(name); } catch { /* not valid percent-encoding: keep it as written */ }
  if (!extname(name)) {
    const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    const ext = Object.entries(EXT).find(([, v]) => v.mime === ct)?.[0];
    if (ext) name += ext;
  }
  return importYarn(store, projectId, tmp, name, opts);
}

// ── from a path on this computer ─────────────────────────────────────────────
// A hidden folder or file is where keys and settings live (~/.ssh, .env), never a brand's
// pictures, so nothing in one is read, whatever a link to it is called.
const hiddenIn = (p: string) => p.split(/[\\/]/).some((part) => part.startsWith(".") && part !== "." && part !== "..");

/**
 * Add a file on this computer by its whole path: for a model with a file here and no public
 * address for it. The file is copied in, and the one on the computer is never moved or changed.
 * It is checked as an upload is, and a file that is already there is the one returned.
 */
export async function importYarnFromPath(store: Store, projectId: string, raw: string, opts: ImportOptions = {}): Promise<ImportResult> {
  store.getProject(projectId);
  cleanFolder(opts.folder);
  const given = String(raw ?? "").trim();
  if (!isAbsolute(given)) throw new ValidationError("Give the file's whole path, from the top, like /Users/you/Pictures/hero.png.");
  const at = resolve(given);
  const hidden = new ValidationError("knitted does not read hidden folders or files, like ~/.ssh or .env. Move the file somewhere plain, or ask the person to upload it.");
  if (hiddenIn(at)) throw hidden;
  // A link is followed to the file it stands for, and that is what is read and checked.
  const opened = await realpath(at).then(async (real) => ({ real, info: await stat(real) })).catch(() => null);
  if (!opened) throw new ValidationError(`knitted cannot open ${given} on the computer it runs on: it is not there, or knitted may not read it. When the studio is on another computer than you, publish the file at a public address and use import_yarn with its url.`);
  const { real, info } = opened;
  if (hiddenIn(real)) throw hidden;
  if (!info.isFile()) throw new ValidationError(`${given} is a folder, not a file. Give the path of one file.`);
  const ext = extname(at).toLowerCase();
  if (!EXT[ext]) throw new ValidationError(`knitted cannot use ${ext || "a file with no extension"} yet. Try ${SUPPORTED}.`);
  const max = opts.maxBytes ?? store.getSetting("yarn.maxBytes", DEFAULT_MAX_BYTES);
  if (info.size > max) throw new ValidationError(`That file is ${(info.size / 1024 ** 3).toFixed(1)}GB. The limit is ${(max / 1024 ** 3).toFixed(0)}GB; the person can raise it in Settings.`);
  const tmp = uploadTempPath(store, projectId);
  await mkdir(join(tmp, ".."), { recursive: true });
  try { await copyFile(real, tmp); }
  catch { await rm(tmp, { force: true }); throw new ValidationError(`knitted could not read ${given}. It may not be allowed to open it.`); }
  return importYarn(store, projectId, tmp, basename(at), opts);
}
