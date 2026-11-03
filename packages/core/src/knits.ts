// Knits: what a Knit produced. Output files live under the project's knits
// directory; this table is how the gallery, the job runner and MCP find them.

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { newId } from "./ids.ts";
import { NotFoundError, type Store } from "./store.ts";

export interface KnitIssue { level: "error" | "warning"; code: string; message: string; stitchId?: string; slot?: string; }
export interface KnitRecord {
  id: string; projectId: string; patternId: string | null; patternName: string; jobId: string | null; batchId: string | null;
  label: string; file: string; kind: "image" | "video"; format: string; width: number; height: number; bytes: number;
  durationMs: number | null; hash: string; report: { issues?: KnitIssue[]; lufs?: number; truePeak?: number; frames?: number; checks?: string[] }; createdAt: string;
}
type Row = Record<string, unknown>;

const toKnit = (r: Row): KnitRecord => ({
  id: r.id as string, projectId: r.project_id as string, patternId: (r.pattern_id as string) ?? null, patternName: r.pattern_name as string,
  jobId: (r.job_id as string) ?? null, batchId: (r.batch_id as string) ?? null, label: r.label as string, file: r.file as string,
  kind: r.kind as "image" | "video", format: r.format as string, width: Number(r.width), height: Number(r.height), bytes: Number(r.bytes),
  durationMs: r.duration_ms == null ? null : Number(r.duration_ms), hash: r.hash as string, report: JSON.parse(r.report as string), createdAt: r.created_at as string,
});

export const knitPath = (store: Store, k: Pick<KnitRecord, "projectId" | "file">) => join(store.paths.outDir(k.projectId), k.file);

export function insertKnit(store: Store, k: Omit<KnitRecord, "id" | "createdAt">): KnitRecord {
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
export function listKnits(store: Store, projectId: string, f: { patternId?: string; batchId?: string; limit?: number } = {}): KnitRecord[] {
  const where = ["project_id = ?"]; const args: (string | number)[] = [projectId];
  if (f.patternId) { where.push("pattern_id = ?"); args.push(f.patternId); }
  if (f.batchId) { where.push("batch_id = ?"); args.push(f.batchId); }
  return (store.db.prepare(`select * from knits where ${where.join(" and ")} order by created_at desc, rowid desc limit ?`).all(...args, f.limit ?? 500) as Row[]).map(toKnit);
}
/** A previous knit with exactly these inputs, if its file is still there. */
export function findKnitByHash(store: Store, projectId: string, hash: string): KnitRecord | null {
  const r = store.db.prepare("select * from knits where project_id = ? and hash = ? order by created_at desc limit 1").get(projectId, hash) as Row | undefined;
  return r ? toKnit(r) : null;
}
export async function deleteKnit(store: Store, id: string): Promise<void> {
  const k = getKnit(store, id);
  await rm(knitPath(store, k), { force: true });
  store.write(() => store.db.prepare("delete from knits where id = ?").run(id));
}
