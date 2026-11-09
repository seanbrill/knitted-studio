// Design sheets: kept, changed, undone, copied and deleted. What a sheet is, and the changes
// it takes, are design-pure.ts; this is where they are stored.
//
// The sheet is one document. Each change keeps the one before it for Undo, with each frame's
// code kept once in design_code, named by its hash, so fifty changes to one frame of a hundred
// keep that frame fifty times and the rest once, not the whole sheet fifty times. How tall each
// frame is drawn is kept beside it (design_sizes), so the board lays a sheet out before it has
// drawn a single frame, and loads only the frames that are seen.

import { createHash } from "node:crypto";
import { tx } from "./db.ts";
import { newId } from "./ids.ts";
import { NotFoundError, ValidationError, type Store } from "./store.ts";
import { activeSwatch } from "./swatch.ts";
import { applyDesignOps, designStarter, DesignProblem, frameRev, type Design, type DesignFrame, type DesignLint, type DesignMeta, type DesignOp, type DesignSection, type FrameCode, type FrameMeta } from "./design-pure.ts";
import { LIBRARY_ID, type Actor } from "./types.ts";

type Row = Record<string, unknown>;
/** How many earlier versions of a sheet are kept for Undo. */
const KEEP = 50;
const now = () => new Date().toISOString();
const byOf = (actor: Actor): "human" | "model" => (actor === "model" ? "model" : "human");

function toDesign(store: Store, r: Row): Design {
  const data = JSON.parse(r.data as string) as { sections: DesignSection[] };
  const older = store.db.prepare("select 1 from design_versions where design_id = ? limit 1").get(r.id as string);
  return {
    id: r.id as string, projectId: r.project_id as string, name: r.name as string, sections: data.sections ?? [],
    version: Number(r.version), canUndo: !!older, createdAt: r.created_at as string, updatedAt: r.updated_at as string, deletedAt: (r.deleted_at as string) ?? null,
  };
}

/** A sheet, deleted or not: a deleted one can still be brought back. */
export function getDesign(store: Store, id: string): Design {
  const r = store.db.prepare("select * from designs where id = ?").get(id) as Row | undefined;
  if (!r) throw new NotFoundError("That design is not here any more.");
  return toDesign(store, r);
}

/** A project's sheets, the newest change first. */
export function listDesigns(store: Store, projectId: string): Design[] {
  return (store.db.prepare("select * from designs where project_id = ? and deleted_at is null order by updated_at desc").all(projectId) as Row[]).map((r) => toDesign(store, r));
}

/** What names a frame's code: the same code is the same name, in any sheet and any version. */
export const codeHash = (html: string, css: string) => createHash("sha1").update(html).update("\0").update(css).digest("hex").slice(0, 16);

function metaOf(f: DesignFrame, measured?: { rev: string; height: number }): FrameMeta {
  const { html, css, ...rest } = f;
  const meta: FrameMeta = { ...rest, code: codeHash(html, css), chars: html.length + css.length };
  if (!f.height && measured && measured.rev === frameRev(meta)) meta.measured = measured.height;
  return meta;
}

/** A sheet without its code, with how tall each frame was drawn: what the board lays out. */
export function designMeta(store: Store, d: Design): DesignMeta {
  const sizes = new Map((store.db.prepare("select frame_id, rev, height from design_sizes where design_id = ?").all(d.id) as { frame_id: string; rev: string; height: number }[]).map((r) => [r.frame_id, r]));
  return { ...d, sections: d.sections.map((s) => ({ ...s, frames: s.frames.map((f) => metaOf(f, sizes.get(f.id))) })) };
}
export const getDesignMeta = (store: Store, id: string): DesignMeta => designMeta(store, getDesign(store, id));

/** Which version a sheet is at: a board that has it already needs nothing more. */
export function designVersion(store: Store, id: string): number {
  const r = store.db.prepare("select version from designs where id = ?").get(id) as { version: number } | undefined;
  if (!r) throw new NotFoundError("That design is not here any more.");
  return Number(r.version);
}

/** Some frames' code, by id. A frame that is not on the sheet is left out. */
export function getFrameCode(store: Store, id: string, frameIds: string[]): Record<string, FrameCode> {
  const want = new Set(frameIds);
  const out: Record<string, FrameCode> = {};
  for (const s of getDesign(store, id).sections) for (const f of s.frames) if (want.has(f.id)) out[f.id] = { code: codeHash(f.html, f.css), html: f.html, css: f.css };
  return out;
}

/**
 * How tall frames were drawn, by the board or the engine, kept for the next time the sheet is
 * laid out. Each is kept under the frame as it was drawn (frameRev), so a change to its code or
 * width makes it a guess again until it is drawn.
 */
export function setFrameHeights(store: Store, id: string, sizes: Record<string, { rev: string; height: number }>): number {
  const ids = new Set(getDesign(store, id).sections.flatMap((s) => s.frames.map((f) => f.id)));
  const rows = Object.entries(sizes).filter(([fid, v]) => ids.has(fid) && typeof v?.rev === "string" && v.rev.length <= 64 && Number.isFinite(v.height) && v.height >= 1 && v.height <= 100_000);
  if (!rows.length) return 0;
  // Not a change to the sheet: nothing to undo, and no one needs telling.
  const put = store.db.prepare("insert into design_sizes (design_id, frame_id, rev, height) values (?, ?, ?, ?) on conflict (design_id, frame_id) do update set rev = excluded.rev, height = excluded.height");
  tx(store.db, () => { for (const [fid, v] of rows) put.run(id, fid, v.rev, Math.round(v.height)); });
  return rows.length;
}

// ── versions, for Undo ──
/** The sheet as kept for Undo: its frames' code in design_code, each named by its hash. */
function keepVersion(store: Store, d: Design, actor: Actor, at: string) {
  const put = store.db.prepare("insert or ignore into design_code (design_id, hash, html, css) values (?, ?, ?, ?)");
  const sections = d.sections.map((s) => ({ ...s, frames: s.frames.map(({ html, css, ...f }) => { const code = codeHash(html, css); put.run(d.id, code, html, css); return { ...f, code }; }) }));
  store.db.prepare("insert or replace into design_versions (design_id, version, name, data, actor, at) values (?, ?, ?, ?, ?, ?)")
    .run(d.id, d.version, d.name, JSON.stringify({ refs: 1, sections }), actor, at);
}
type KeptFrame = Omit<DesignFrame, "html" | "css"> & { code: string };
/** A kept version's sections, with their code: from design_code, or in it, as versions were kept before. */
function readVersion(store: Store, id: string, data: string): DesignSection[] {
  const v = JSON.parse(data) as { refs?: 1; sections: (Omit<DesignSection, "frames"> & { frames: (KeptFrame | DesignFrame)[] })[] };
  if (!v.refs) return (v.sections ?? []) as DesignSection[];
  const get = store.db.prepare("select html, css from design_code where design_id = ? and hash = ?");
  return v.sections.map((s) => ({ ...s, frames: (s.frames as KeptFrame[]).map(({ code, ...f }) => ({ ...f, ...((get.get(id, code) as { html: string; css: string } | undefined) ?? { html: "", css: "" }) })) }));
}
/** Code no kept version names any more, let go. */
function sweepCode(store: Store, id: string) {
  const used = new Set<string>();
  for (const r of store.db.prepare("select data from design_versions where design_id = ?").all(id) as { data: string }[]) {
    const v = JSON.parse(r.data) as { refs?: 1; sections: { frames: { code?: string }[] }[] };
    if (v.refs) for (const s of v.sections) for (const f of s.frames) if (f.code) used.add(f.code);
  }
  const del = store.db.prepare("delete from design_code where design_id = ? and hash = ?");
  for (const { hash } of store.db.prepare("select hash from design_code where design_id = ?").all(id) as { hash: string }[]) if (!used.has(hash)) del.run(id, hash);
}

/**
 * Versions kept before code was kept once: each a whole copy of the sheet. Kept again the new
 * way, once, when the library is opened. A sheet of a hundred frames kept fifty times was 59 MB.
 */
export function compactDesignVersions(store: Store): number {
  const old = store.db.prepare(`select design_id, version, data from design_versions where data not like '{"refs":1,%'`).all() as { design_id: string; version: number; data: string }[];
  if (!old.length) return 0;
  const put = store.db.prepare("insert or ignore into design_code (design_id, hash, html, css) values (?, ?, ?, ?)");
  const set = store.db.prepare("update design_versions set data = ? where design_id = ? and version = ?");
  tx(store.db, () => {
    for (const r of old) {
      const sections = (JSON.parse(r.data) as { sections?: DesignSection[] }).sections ?? [];
      const kept = sections.map((s) => ({ ...s, frames: s.frames.map(({ html, css, ...f }) => { const code = codeHash(html ?? "", css ?? ""); put.run(r.design_id, code, html ?? "", css ?? ""); return { ...f, code }; }) }));
      set.run(JSON.stringify({ refs: 1, sections: kept }), r.design_id, r.version);
    }
  });
  return old.length;
}

const run = <T,>(fn: () => T): T => {
  try { return fn(); } catch (e) { if (e instanceof DesignProblem) throw new ValidationError(e.message); throw e; }
};

/**
 * A new sheet: from the brand (Foundations, Components and Pages, drawn with the Swatch), blank,
 * or with sections given by a model. `sections` are added after what `start` gives.
 */
export function createDesign(store: Store, projectId: string, input: { name: string; start?: "brand" | "blank"; ops?: DesignOp[] }, actor: Actor = "human"): Design & { made: { sections: string[]; frames: string[] }; lint: Record<string, DesignLint[]> } {
  if (projectId === LIBRARY_ID) throw new ValidationError("A design belongs to a project, not the Library.");
  const project = store.getProject(projectId);
  const t = now();
  const swatch = activeSwatch(store, projectId);
  const base = designStarter(input.start ?? "brand", { brand: project.name, hasLogo: swatch.logos.length > 0, now: t });
  const out = run(() => applyDesignOps({ name: input.name, sections: base }, [{ op: "rename", name: input.name }, ...(input.ops ?? [])], byOf(actor), t));
  const id = newId("ds");
  store.write(() => {
    store.db.prepare("insert into designs (id, project_id, name, data, version, created_at, updated_at) values (?, ?, ?, ?, 1, ?, ?)")
      .run(id, projectId, out.name, JSON.stringify({ sections: out.sections }), t, t);
    store.logRow(projectId, actor, "design.created", out.name, { designId: id });
  });
  return { ...getDesign(store, id), made: out.made, lint: out.lint };
}

/** Changes, all or none, kept as one version: the one before goes to the history for Undo. */
export function changeDesign(store: Store, id: string, ops: DesignOp[], actor: Actor = "human"): Design & { made: { sections: string[]; frames: string[] }; lint: Record<string, DesignLint[]> } {
  if (!ops.length) throw new ValidationError("Say what to change.");
  const d = getDesign(store, id);
  if (d.deletedAt) throw new ValidationError("That design is deleted. Bring it back first.");
  const t = now();
  const out = run(() => applyDesignOps(d, ops, byOf(actor), t));
  store.write(() => {
    keepVersion(store, d, actor, t);
    const trimmed = store.db.prepare("delete from design_versions where design_id = ? and version <= ?").run(id, d.version - KEEP).changes;
    store.db.prepare("update designs set name = ?, data = ?, version = version + 1, updated_at = ? where id = ?").run(out.name, JSON.stringify({ sections: out.sections }), t, id);
    if (trimmed && d.version % 10 === 0) sweepCode(store, id);
  });
  return { ...getDesign(store, id), made: out.made, lint: out.lint };
}

/** Back one version: the newest kept one becomes the sheet again, and leaves the history. */
export function undoDesign(store: Store, id: string): Design {
  const d = getDesign(store, id);
  const prev = store.db.prepare("select * from design_versions where design_id = ? order by version desc limit 1").get(id) as { name: string; data: string; version: number } | undefined;
  if (!prev) throw new ValidationError("There is nothing to undo in this design.");
  const sections = readVersion(store, id, prev.data);
  store.write(() => {
    store.db.prepare("update designs set name = ?, data = ?, version = ?, updated_at = ? where id = ?").run(prev.name, JSON.stringify({ sections }), d.version + 1, now(), id);
    store.db.prepare("delete from design_versions where design_id = ? and version = ?").run(id, prev.version);
  });
  return getDesign(store, id);
}

export function duplicateDesign(store: Store, id: string, actor: Actor = "human"): Design {
  const d = getDesign(store, id);
  const copy = newId("ds");
  const t = now();
  store.write(() => {
    store.db.prepare("insert into designs (id, project_id, name, data, version, created_at, updated_at) values (?, ?, ?, ?, 1, ?, ?)")
      .run(copy, d.projectId, `${d.name} copy`.slice(0, 80), JSON.stringify({ sections: d.sections }), t, t);
    store.logRow(d.projectId, actor, "design.duplicated", d.name, { designId: copy });
  });
  return getDesign(store, copy);
}

/** Deleted, and kept: `restoreDesign` brings it back as it was. */
export function deleteDesign(store: Store, id: string, actor: Actor = "human"): void {
  const d = getDesign(store, id);
  store.write(() => {
    store.db.prepare("update designs set deleted_at = ? where id = ?").run(now(), id);
    store.logRow(d.projectId, actor, "design.deleted", d.name, { designId: id });
  });
}
export function restoreDesign(store: Store, id: string): Design {
  store.write(() => store.db.prepare("update designs set deleted_at = null where id = ?").run(id));
  return getDesign(store, id);
}
