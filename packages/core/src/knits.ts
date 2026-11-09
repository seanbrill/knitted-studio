// Knits: what a Knit produced. Output files live under the project's knits
// directory; this table is how the gallery, the job runner and MCP find them.

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { newId } from "./ids.ts";
import { NotFoundError, type Store } from "./store.ts";
import { folderNamed } from "./folders.ts";
import { SIZES, sizeNamed } from "./types.ts";
import { readUnit, settleHead, versionsOf, type KnitVersion } from "./knit-versions.ts";

export interface KnitIssue { level: "error" | "warning"; code: string; message: string; stitchId?: string; slot?: string; }
/** What goes with a knit when it is posted. `audioId` is a track in the project's Yarn. */
export interface KnitPost {
  caption?: string; hashtags?: string[]; audioId?: string | null; audioWhy?: string;
  /** Who wrote it last, and what the person asked for when the model wrote it. */
  by?: "model" | "human"; ask?: string; at?: string;
  /** The captions it had before, newest first, to go back to. */
  earlier?: { caption: string; hashtags?: string[]; by?: "model" | "human"; ask?: string; at?: string }[];
}
/** One file of a version: the same picture as another type or at another scale. */
export interface KnitFormat { id: string; kind: "image" | "video"; format: string; scale: number; width: number; height: number; bytes: number; fps?: number }
export interface KnitRecord {
  id: string; projectId: string; patternId: string | null; patternName: string; jobId: string | null; batchId: string | null;
  label: string; file: string; kind: "image" | "video"; format: string; width: number; height: number; bytes: number;
  durationMs: number | null; hash: string; report: { issues?: KnitIssue[]; lufs?: number; truePeak?: number; frames?: number; fps?: number; checks?: string[] };
  /** The folder in Knits it is filed in. "" is the top, where each knit lands. Filing it never moves the file on disk. */
  folder: string;
  /** Words to find it by, as Yarn has them. */
  tags: string[];
  post: KnitPost;
  /** When the person first opened or downloaded it. Null: nobody has looked at it yet. */
  seenAt: string | null;
  /** Marked as one the person likes, to find again with the Favourites filter. */
  favorite: boolean;
  createdAt: string;
  /** Which knit it is a file of, and which version: see knit-versions.ts. Null on a file not yet sorted. */
  unit: string | null; look: string | null;
  /** 1, or 2 for a file knitted at twice the size. */
  scale: number;
  /** When the person picked this file, or knitted it again. */
  chosenAt: string | null;
  /** The file Knits shows for its knit. */
  head: boolean;
  /** Set by a listing: its pattern was saved after it was made, so it may be out of date. */
  patternChangedSince?: boolean;
  /** Set by a listing of knits: how many versions it has, which one this is, and this version's files, this one first. */
  versions?: number; versionNo?: number; formats?: KnitFormat[];
}
type Row = Record<string, unknown>;

const toKnit = (r: Row): KnitRecord => ({
  id: r.id as string, projectId: r.project_id as string, patternId: (r.pattern_id as string) ?? null, patternName: r.pattern_name as string,
  jobId: (r.job_id as string) ?? null, batchId: (r.batch_id as string) ?? null, label: r.label as string, file: r.file as string,
  kind: r.kind as "image" | "video", format: r.format as string, width: Number(r.width), height: Number(r.height), bytes: Number(r.bytes),
  durationMs: r.duration_ms == null ? null : Number(r.duration_ms), hash: r.hash as string, report: JSON.parse(r.report as string), folder: (r.folder as string) ?? "", tags: JSON.parse((r.tags as string) ?? "[]"), post: JSON.parse((r.post as string) ?? "{}"), seenAt: (r.seen_at as string) ?? null, favorite: r.favorite_at != null, createdAt: r.created_at as string,
  unit: (r.unit as string) ?? null, look: (r.look as string) ?? null, scale: Number(r.scale ?? 1) || 1, chosenAt: (r.chosen_at as string) ?? null, head: r.head == null ? true : Number(r.head) === 1,
});
/** A video's frame rate is part of which file it is: 60 fps is another format of the same version. */
const formatOf = (k: KnitRecord): KnitFormat => ({ id: k.id, kind: k.kind, format: k.format, scale: k.scale, width: k.width, height: k.height, bytes: k.bytes, ...(k.kind === "video" && k.report?.fps && k.report.fps !== 30 ? { fps: k.report.fps } : {}) });

export const knitPath = (store: Store, k: Pick<KnitRecord, "projectId" | "file">) => join(store.paths.outDir(k.projectId), k.file);

// Now, but after every knit this process made or picked: files of one knit made in the same
// millisecond would otherwise sort either way, and the current version with them.
let lastAt = 0;
const madeAt = () => { lastAt = Math.max(Date.now(), lastAt + 1); return new Date(lastAt).toISOString(); };

type NewKnit = Omit<KnitRecord, "id" | "createdAt" | "folder" | "tags" | "post" | "seenAt" | "favorite" | "unit" | "look" | "scale" | "chosenAt" | "head"> & { unit?: string | null; look?: string | null; scale?: number };
/**
 * A file a knit made. A new version, or a new format, of a knit there is already is filed with
 * it: in its folder, with its tags, its caption and its star, and shown in its place when it is
 * the newest version.
 */
export function insertKnit(store: Store, k: NewKnit): KnitRecord {
  const id = newId("kn"), t = madeAt();
  const unit = k.unit ?? null;
  store.write(() => {
    const was = unit ? store.db.prepare("select folder, tags, post, favorite_at from knits where project_id = ? and unit = ? order by head desc, created_at desc limit 1").get(k.projectId, unit) as Row | undefined : undefined;
    store.db.prepare("insert into knits (id, project_id, pattern_id, pattern_name, job_id, batch_id, label, file, kind, format, width, height, bytes, duration_ms, hash, report, created_at, unit, look, scale, folder, tags, post, favorite_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, k.projectId, k.patternId, k.patternName, k.jobId, k.batchId, k.label, k.file, k.kind, k.format, k.width, k.height, k.bytes, k.durationMs, k.hash, JSON.stringify(k.report), t,
        unit, k.look ?? null, k.scale ?? 1, (was?.folder as string) ?? "", (was?.tags as string) ?? "[]", (was?.post as string) ?? "{}", (was?.favorite_at as string) ?? null);
    settleHead(store, k.projectId, unit);
    store.db.prepare("update projects set updated_at = ? where id = ?").run(t, k.projectId);
  });
  return getKnit(store, id);
}
/** The ids of every file of the knit `id` is one of: its versions and formats. */
function sameKnit(store: Store, id: string): string[] {
  const k = getKnit(store, id);
  if (!k.unit) return [id];
  return (store.db.prepare("select id from knits where project_id = ? and unit = ?").all(k.projectId, k.unit) as Row[]).map((r) => r.id as string);
}
export function getKnit(store: Store, id: string): KnitRecord {
  const r = store.db.prepare("select * from knits where id = ?").get(id) as Row | undefined;
  if (!r) throw new NotFoundError("That knit is not here any more.");
  return toKnit(r);
}
/** `folder`: only what is in that folder, or in the folders inside it. `favorite`: only the person's favourites. */
type KnitFilter = {
  patternId?: string; batchId?: string; folder?: string; favorite?: boolean;
  /** Pictures or videos. */
  kind?: "image" | "video";
  /** A named size, as SIZES has them, at any scale; or "Other" for every other shape. */
  size?: string;
  /** Every file, each version and format of each knit; not only the one shown for each. */
  every?: boolean;
};
// The same test as sizeNamed: within a hundredth of the shape.
const shapeSql = "abs(width * ? - height * ?) <= 0.01 * height * ?";
function knitWhere(store: Store, projectId: string, f: KnitFilter) {
  const where = ["project_id = ?"]; const args: (string | number)[] = [projectId];
  // A batch's own files are what it made, whichever versions they are now.
  if (!f.every && !f.batchId) where.push("head = 1");
  if (f.patternId) { where.push("pattern_id = ?"); args.push(f.patternId); }
  if (f.batchId) { where.push("batch_id = ?"); args.push(f.batchId); }
  if (f.favorite) where.push("favorite_at is not null");
  if (f.kind) { where.push("kind = ?"); args.push(f.kind); }
  if (f.size === "Other") { where.push(`not (${SIZES.map(() => shapeSql).join(" or ")})`); for (const s of SIZES) args.push(s.h, s.w, s.w); }
  else if (f.size) {
    const s = SIZES.find((x) => x.name.toLowerCase() === f.size!.toLowerCase());
    if (!s) throw new Error(`No size is called ${f.size}. Use one of: ${[...SIZES.map((x) => x.name), "Other"].join(", ")}.`);
    where.push(shapeSql); args.push(s.h, s.w, s.w);
  }
  const folder = folderNamed(store, projectId, "knits", f.folder);
  // substr and length both count characters, as the folder's own names do.
  if (folder) { where.push("(folder = ? or substr(folder, 1, length(?)) = ?)"); args.push(folder, `${folder}/`, `${folder}/`); }
  return { sql: where.join(" and "), args };
}
export function listKnits(store: Store, projectId: string, f: KnitFilter & { limit?: number; offset?: number } = {}): KnitRecord[] {
  const w = knitWhere(store, projectId, f);
  return (store.db.prepare(`select * from knits where ${w.sql} order by created_at desc, rowid desc limit ? offset ?`).all(...w.args, f.limit ?? 500, f.offset ?? 0) as Row[]).map(toKnit);
}
export function countKnits(store: Store, projectId: string, f: KnitFilter = {}): number {
  const w = knitWhere(store, projectId, f);
  return Number((store.db.prepare(`select count(*) as n from knits where ${w.sql}`).get(...w.args) as Row).n);
}
/**
 * The knits whose pattern has been saved since they were made: what they show may be out of
 * date. A fixed pattern whose old knit stayed in the folder, unmarked, went out wrong.
 */
export function changedSince(store: Store, knits: Pick<KnitRecord, "id" | "patternId" | "createdAt">[]): Set<string> {
  const ids = [...new Set(knits.map((k) => k.patternId).filter(Boolean))] as string[];
  if (!ids.length) return new Set();
  const saved = new Map((store.db.prepare(`select id, updated_at from patterns where id in (${ids.map(() => "?").join(",")})`).all(...ids) as Row[]).map((r) => [r.id as string, r.updated_at as string]));
  return new Set(knits.filter((k) => k.patternId && (saved.get(k.patternId) ?? "") > k.createdAt).map((k) => k.id));
}
/** A previous knit with exactly these inputs, if its file is still there. With `unit`, only a file of that knit. */
export function findKnitByHash(store: Store, projectId: string, hash: string, unit?: string): KnitRecord | null {
  const r = (unit
    ? store.db.prepare("select * from knits where project_id = ? and hash = ? and (unit = ? or unit is null) order by created_at desc limit 1").get(projectId, hash, unit)
    : store.db.prepare("select * from knits where project_id = ? and hash = ? order by created_at desc limit 1").get(projectId, hash)) as Row | undefined;
  return r ? toKnit(r) : null;
}
/** Each knit's versions and its shown version's files, for a listing of shown files. */
export function withVersions(store: Store, knits: KnitRecord[]): KnitRecord[] {
  const units = [...new Set(knits.map((k) => k.unit).filter(Boolean))] as string[];
  if (!units.length) return knits.map((k) => ({ ...k, versions: 1, versionNo: 1, formats: [formatOf(k)] }));
  const rows = (store.db.prepare(`select * from knits where project_id = ? and unit in (${units.map(() => "?").join(",")})`).all(knits[0]!.projectId, ...units) as Row[]).map(toKnit);
  const byUnit = new Map<string, KnitRecord[]>();
  for (const r of rows) { const l = byUnit.get(r.unit!); if (l) l.push(r); else byUnit.set(r.unit!, [r]); }
  return knits.map((k) => {
    const all = k.unit ? byUnit.get(k.unit) : undefined;
    if (!all?.length) return { ...k, versions: 1, versionNo: 1, formats: [formatOf(k)] };
    const { versions } = versionsOf(all);
    const mine = versions.find((v) => v.files.some((f) => f.id === k.id))!;
    return { ...k, versions: versions.length, versionNo: mine.no, formats: [k, ...mine.files.filter((f) => f.id !== k.id)].map(formatOf) };
  });
}
/** A knit's versions, oldest first, which one is current, and what size and row it is. */
export function knitVersions(store: Store, id: string): { size: { name: string; w: number; h: number }; row: number | null; current: number; versions: (Omit<KnitVersion<KnitRecord>, "rank">)[] } {
  const k = getKnit(store, id);
  const rows = k.unit ? (store.db.prepare("select * from knits where project_id = ? and unit = ?").all(k.projectId, k.unit) as Row[]).map(toKnit) : [k];
  const { versions, current } = versionsOf(rows);
  const u = readUnit(k.unit);
  return {
    size: { name: u?.sizeName && !u.sizeName.startsWith("?") ? u.sizeName : (sizeNamed(k.width, k.height) ?? "Custom"), w: Math.round(k.width / k.scale), h: Math.round(k.height / k.scale) },
    row: u?.row ?? null, current: current.no,
    versions: versions.map(({ rank: _, ...v }) => v),
  };
}
/**
 * Show this file for its knit: its version becomes the current one, and it the file shown and
 * posted. Also what knitting it again does.
 */
export function chooseKnit(store: Store, id: string): KnitRecord {
  const k = getKnit(store, id);
  store.write(() => {
    store.db.prepare("update knits set chosen_at = ? where id = ?").run(madeAt(), id);
    settleHead(store, k.projectId, k.unit);
  });
  return getKnit(store, id);
}
/** A knit's tags, each once, in the order given, without blanks. They are the knit's, so every version and format has them. */
export function setKnitTags(store: Store, id: string, tags: string[]): KnitRecord {
  const ids = sameKnit(store, id);
  const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  store.write(() => { const set = store.db.prepare("update knits set tags = ? where id = ?"); for (const x of ids) set.run(JSON.stringify(clean), x); });
  return getKnit(store, id);
}
/** Hashtags as a post wants them: each once, with its #, no spaces or punctuation inside. */
export function cleanHashtags(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const w = t.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (w && !out.some((x) => x.toLowerCase() === `#${w}`.toLowerCase())) out.push(`#${w}`);
  }
  return out.slice(0, 30);
}
/**
 * Change what goes with a knit when it is posted. What is not given stays as it was. A caption
 * written over is kept in `earlier`, the last ten, to go back to. It is the knit's, so every
 * version and format has it.
 */
export function setKnitPost(store: Store, id: string, change: KnitPost): KnitRecord {
  const k = getKnit(store, id);
  const { earlier: _, ...asked } = change;
  const post: KnitPost = { ...k.post, ...asked, at: new Date().toISOString() };
  if (change.hashtags) post.hashtags = cleanHashtags(change.hashtags);
  if (post.caption !== undefined) post.caption = post.caption.slice(0, 5000);
  const was = k.post.caption?.trim();
  if (was && post.caption !== undefined && post.caption.trim() !== was) {
    const before = { caption: k.post.caption!, hashtags: k.post.hashtags, by: k.post.by, ask: k.post.ask, at: k.post.at };
    post.earlier = [before, ...(k.post.earlier ?? []).filter((e) => e.caption.trim() !== was && e.caption.trim() !== post.caption!.trim())].slice(0, 10);
  }
  const ids = sameKnit(store, id);
  store.write(() => { const set = store.db.prepare("update knits set post = ? where id = ?"); for (const x of ids) set.run(JSON.stringify(post), x); });
  return getKnit(store, id);
}
/** Mark knits as favourites, or not. A favourite marked again keeps when it was first marked. Returns how many changed. */
export function setKnitFavorite(store: Store, ids: string[], favorite: boolean): number {
  // A star is the knit's: every version and format has it, and it counts once.
  const knits = ids.map((id) => sameKnit(store, id));
  const t = new Date().toISOString();
  return store.write(() => knits.reduce((n, all) => n + Math.min(1, all.reduce((m, id) => m + Number((favorite
    ? store.db.prepare("update knits set favorite_at = ? where id = ? and favorite_at is null").run(t, id)
    : store.db.prepare("update knits set favorite_at = null where id = ? and favorite_at is not null").run(id)).changes), 0)), 0));
}

/** The person has looked at these knits. One seen before keeps the time it was first seen. */
export function markKnitsSeen(store: Store, ids: string[]): number {
  if (!ids.length) return 0;
  const t = new Date().toISOString();
  return store.write(() => ids.reduce((n, id) => n + Number(store.db.prepare("update knits set seen_at = ? where id = ? and seen_at is null").run(t, id).changes), 0));
}
/** Every knit in a project, seen. */
export function markAllKnitsSeen(store: Store, projectId: string): number {
  const t = new Date().toISOString();
  return store.write(() => Number(store.db.prepare("update knits set seen_at = ? where project_id = ? and seen_at is null").run(t, projectId).changes));
}
/** How many knits in a project nobody has opened yet: a knit with a new version is one of them. */
export const unseenKnits = (store: Store, projectId: string): number =>
  Number((store.db.prepare("select count(*) as n from knits where project_id = ? and head = 1 and seen_at is null").get(projectId) as { n: number }).n);
/** Delete one file. When it was the one shown for its knit, the next one along is. */
export async function deleteKnit(store: Store, id: string): Promise<void> {
  await deleteKnitFiles(store, id, "file");
}
/**
 * Delete files of a knit: `file`, this one; `version`, every format of its version; `earlier`,
 * every version but the current one; `all`, the whole knit. Says how many went and how much room that made.
 */
export async function deleteKnitFiles(store: Store, id: string, what: "file" | "version" | "earlier" | "all"): Promise<{ deleted: number; bytes: number }> {
  const k = getKnit(store, id);
  let gone: KnitRecord[] = [k];
  if (what !== "file" && k.unit) {
    const rows = (store.db.prepare("select * from knits where project_id = ? and unit = ?").all(k.projectId, k.unit) as Row[]).map(toKnit);
    const { versions, current } = versionsOf(rows);
    gone = what === "all" ? rows : what === "version" ? rows.filter((r) => (r.look ?? r.id) === (k.look ?? k.id)) : versions.filter((v) => v !== current).flatMap((v) => v.files);
  }
  for (const g of gone) await rm(knitPath(store, g), { force: true });
  store.write(() => {
    const del = store.db.prepare("delete from knits where id = ?");
    for (const g of gone) del.run(g.id);
    settleHead(store, k.projectId, k.unit);
  });
  return { deleted: gone.length, bytes: gone.reduce((n, g) => n + g.bytes, 0) };
}
