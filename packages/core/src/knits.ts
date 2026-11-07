// Knits: what a Knit produced. Output files live under the project's knits
// directory; this table is how the gallery, the job runner and MCP find them.

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { newId } from "./ids.ts";
import { NotFoundError, type Store } from "./store.ts";
import { folderNamed } from "./folders.ts";

export interface KnitIssue { level: "error" | "warning"; code: string; message: string; stitchId?: string; slot?: string; }
/** What goes with a knit when it is posted. `audioId` is a track in the project's Yarn. */
export interface KnitPost {
  caption?: string; hashtags?: string[]; audioId?: string | null; audioWhy?: string;
  /** Who wrote it last, and what the person asked for when the model wrote it. */
  by?: "model" | "human"; ask?: string; at?: string;
}
export interface KnitRecord {
  id: string; projectId: string; patternId: string | null; patternName: string; jobId: string | null; batchId: string | null;
  label: string; file: string; kind: "image" | "video"; format: string; width: number; height: number; bytes: number;
  durationMs: number | null; hash: string; report: { issues?: KnitIssue[]; lufs?: number; truePeak?: number; frames?: number; checks?: string[] };
  /** The folder in Knits it is filed in. "" is the top, where each knit lands. Filing it never moves the file on disk. */
  folder: string;
  /** Words to find it by, as Yarn has them. */
  tags: string[];
  post: KnitPost;
  /** When the person first opened or downloaded it. Null: nobody has looked at it yet. */
  seenAt: string | null;
  createdAt: string;
  /** Set by a listing: its pattern was saved after it was made, so it may be out of date. */
  patternChangedSince?: boolean;
}
type Row = Record<string, unknown>;

const toKnit = (r: Row): KnitRecord => ({
  id: r.id as string, projectId: r.project_id as string, patternId: (r.pattern_id as string) ?? null, patternName: r.pattern_name as string,
  jobId: (r.job_id as string) ?? null, batchId: (r.batch_id as string) ?? null, label: r.label as string, file: r.file as string,
  kind: r.kind as "image" | "video", format: r.format as string, width: Number(r.width), height: Number(r.height), bytes: Number(r.bytes),
  durationMs: r.duration_ms == null ? null : Number(r.duration_ms), hash: r.hash as string, report: JSON.parse(r.report as string), folder: (r.folder as string) ?? "", tags: JSON.parse((r.tags as string) ?? "[]"), post: JSON.parse((r.post as string) ?? "{}"), seenAt: (r.seen_at as string) ?? null, createdAt: r.created_at as string,
});

export const knitPath = (store: Store, k: Pick<KnitRecord, "projectId" | "file">) => join(store.paths.outDir(k.projectId), k.file);

export function insertKnit(store: Store, k: Omit<KnitRecord, "id" | "createdAt" | "folder" | "tags" | "post" | "seenAt">): KnitRecord {
  const id = newId("kn"), t = new Date().toISOString();
  store.write(() => {
    store.db.prepare("insert into knits (id, project_id, pattern_id, pattern_name, job_id, batch_id, label, file, kind, format, width, height, bytes, duration_ms, hash, report, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, k.projectId, k.patternId, k.patternName, k.jobId, k.batchId, k.label, k.file, k.kind, k.format, k.width, k.height, k.bytes, k.durationMs, k.hash, JSON.stringify(k.report), t);
    store.db.prepare("update projects set updated_at = ? where id = ?").run(t, k.projectId);
  });
  return getKnit(store, id);
}
export function getKnit(store: Store, id: string): KnitRecord {
  const r = store.db.prepare("select * from knits where id = ?").get(id) as Row | undefined;
  if (!r) throw new NotFoundError("That knit is not here any more.");
  return toKnit(r);
}
/** `folder`: only what is in that folder, or in the folders inside it. */
type KnitFilter = { patternId?: string; batchId?: string; folder?: string };
function knitWhere(store: Store, projectId: string, f: KnitFilter) {
  const where = ["project_id = ?"]; const args: (string | number)[] = [projectId];
  if (f.patternId) { where.push("pattern_id = ?"); args.push(f.patternId); }
  if (f.batchId) { where.push("batch_id = ?"); args.push(f.batchId); }
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
/** A previous knit with exactly these inputs, if its file is still there. */
export function findKnitByHash(store: Store, projectId: string, hash: string): KnitRecord | null {
  const r = store.db.prepare("select * from knits where project_id = ? and hash = ? order by created_at desc limit 1").get(projectId, hash) as Row | undefined;
  return r ? toKnit(r) : null;
}
/** A knit's tags, each once, in the order given, without blanks. */
export function setKnitTags(store: Store, id: string, tags: string[]): KnitRecord {
  getKnit(store, id);
  const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  store.write(() => store.db.prepare("update knits set tags = ? where id = ?").run(JSON.stringify(clean), id));
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
/** Change what goes with a knit when it is posted. What is not given stays as it was. */
export function setKnitPost(store: Store, id: string, change: KnitPost): KnitRecord {
  const k = getKnit(store, id);
  const post: KnitPost = { ...k.post, ...change, at: new Date().toISOString() };
  if (change.hashtags) post.hashtags = cleanHashtags(change.hashtags);
  if (post.caption !== undefined) post.caption = post.caption.slice(0, 5000);
  store.write(() => store.db.prepare("update knits set post = ? where id = ?").run(JSON.stringify(post), id));
  return getKnit(store, id);
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
/** How many knits in a project nobody has opened yet. */
export const unseenKnits = (store: Store, projectId: string): number =>
  Number((store.db.prepare("select count(*) as n from knits where project_id = ? and seen_at is null").get(projectId) as { n: number }).n);
export async function deleteKnit(store: Store, id: string): Promise<void> {
  const k = getKnit(store, id);
  await rm(knitPath(store, k), { force: true });
  store.write(() => store.db.prepare("delete from knits where id = ?").run(id));
}
