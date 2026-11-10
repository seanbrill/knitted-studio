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
import { applyDesignOps, designStarter, DESIGN_LIMITS, DesignProblem, findSection, frameRev, PIECE_KINDS, type Design, type DesignFrame, type DesignLint, type DesignMade, type DesignMeta, type DesignOp, type DesignPiece, type DesignSection, type FrameCode, type FrameMeta, type PieceNow } from "./design-pure.ts";
import { getPart } from "./parts.ts";
import { getYarn } from "./yarn.ts";
import { LIBRARY_ID, SIZES, type Actor } from "./types.ts";

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

// ── pieces: the project's own things on a sheet ──
/** A piece's thing as it is now: its name, its own size, and what names how it looks. */
interface Thing { name: string; w: number; h: number; rev: string }
/** The part drawn on a sheet is this wide: its shape is all it has of a size. */
const PART_W = 1000;

/** The thing a piece is, as it is now; null when it is not in the project any more. */
export function pieceThing(store: Store, projectId: string, p: DesignPiece): Thing | null {
  try {
    if (p.kind === "pattern") {
      const x = store.getPattern(p.id);
      // Shown at another of its sizes, it is that shape on the sheet; the pattern keeps its own.
      const sz = p.size ? SIZES.find((s) => s.name === p.size) : undefined;
      // A part open in the editor is a pattern too, but not one of the project's patterns.
      return x.projectId === projectId && !x.partId ? { name: x.name, w: sz?.w ?? x.size.w, h: sz?.h ?? x.size.h, rev: `${x.version}${sz ? `:${sz.name}` : ""}` } : null;
    }
    if (p.kind === "part") {
      const x = getPart(store, p.id);
      return !x.projectId || x.projectId === projectId ? { name: x.name, w: PART_W, h: Math.max(1, Math.round(PART_W / (x.aspect || 1))), rev: `${x.version}.${x.updatedAt}` } : null;
    }
    const y = getYarn(store, p.id);
    const mine = y.projectId === projectId || y.projectId === LIBRARY_ID;
    return mine && !y.deletedAt && y.shelf !== "reference" && (y.kind === "image" || y.kind === "video")
      ? { name: y.name, w: y.width || 1000, h: y.height || 1000, rev: y.updatedAt } : null;
  } catch (e) {
    // By its kind, not its class: the studio's routes can each have their own copy of the class.
    if ((e as { kind?: string } | null)?.kind === "not_found") return null;
    throw e;
  }
}

/** The pieces of a sheet as they are now, by frame id. */
function thingsOf(store: Store, d: Pick<Design, "projectId" | "sections">): Map<string, Thing | null> {
  const out = new Map<string, Thing | null>();
  for (const s of d.sections) for (const f of s.frames) if (f.piece) out.set(f.id, pieceThing(store, d.projectId, f.piece));
  return out;
}
/** A piece as it is now: the thing's name, its height for its shape at the piece's width, and its own size. Gone, it keeps what it last had. */
function pieceFrame<F extends DesignFrame>(f: F, t: Thing | null | undefined): F & { piece: PieceNow } {
  if (!t) return { ...f, piece: { ...f.piece!, w: f.width, h: f.height ?? f.width, gone: true } };
  return { ...f, name: t.name, height: Math.max(1, Math.round((f.width * t.h) / t.w)), piece: { ...f.piece!, w: t.w, h: t.h } };
}
/**
 * A sheet with its pieces as they are now: each piece's name and height from its thing, and the
 * thing's own size beside it (`piece.w`, `piece.h`), or `piece.gone` when it is not there any
 * more. What the engine draws and what a model reads.
 */
export function withPieces<D extends Pick<Design, "projectId" | "sections">>(store: Store, d: D): D {
  if (!d.sections.some((s) => s.frames.some((f) => f.piece))) return d;
  const things = thingsOf(store, d);
  return { ...d, sections: d.sections.map((s) => ({ ...s, frames: s.frames.map((f) => (f.piece ? pieceFrame(f, things.get(f.id)) : f)) })) };
}

/**
 * The sheet's pieces with their things' names and heights as they are now, to be kept with the
 * next change: a piece whose thing goes later keeps the name and shape it last had.
 */
function freshPieces(store: Store, d: Design): Design {
  if (!d.sections.some((s) => s.frames.some((f) => f.piece))) return d;
  const things = thingsOf(store, d);
  return { ...d, sections: d.sections.map((s) => ({ ...s, frames: s.frames.map((f) => { const t = f.piece && things.get(f.id); return t ? { ...f, name: t.name, height: Math.max(1, Math.round((f.width * t.h) / t.w)) } : f; }) })) };
}

/** Pieces to add, with what the store knows of their things: their names and sizes. */
function fillPieces(store: Store, projectId: string, ops: DesignOp[]): DesignOp[] {
  return ops.map((o) => {
    if (o.op !== "addPiece") return o;
    if (!PIECE_KINDS.includes(o.kind)) throw new ValidationError(`A piece is a pattern, yarn or a part, not "${String(o.kind)}".`);
    const t = pieceThing(store, projectId, { kind: o.kind, id: String(o.id ?? ""), ...(o.size && o.kind === "pattern" ? { size: SIZES.find((s) => s.name.toLowerCase() === String(o.size).trim().toLowerCase())?.name } : {}) });
    if (!t) throw new ValidationError(o.kind === "yarn"
      ? `There is no picture or video "${o.id}" in this project's Yarn. list_yarn shows what is.`
      : `There is no ${o.kind} "${o.id}" in this project. ${o.kind === "pattern" ? "list_patterns" : "list_parts"} shows what is.`);
    // As big as it is, up to a desktop screen across; a part at the width it is drawn in the editor.
    const width = o.width != null ? Math.round(Number(o.width)) : Math.max(240, Math.min(o.kind === "yarn" ? 1440 : DESIGN_LIMITS.maxWidth, t.w));
    return { ...o, name: o.name ?? t.name, width, height: Math.round((width * t.h) / t.w) };
  });
}

/**
 * Sections to copy from another of the project's sheets, read from it. A `source` given by the
 * caller is never taken: what is copied is what that sheet holds, which was checked when it was saved.
 */
function fillCopies(store: Store, d: Design, ops: DesignOp[]): DesignOp[] {
  return ops.map((o) => {
    if (o.op !== "copySection") return o;
    const { source: _, ...rest } = o;
    if (!o.from || o.from === d.id) return rest;
    let from: Design;
    try { from = getDesign(store, o.from); } catch { throw new ValidationError(`There is no design "${o.from}" to copy from. list_designs shows the project's.`); }
    if (from.projectId !== d.projectId) throw new ValidationError(`"${from.name}" is in another project: copy only between the sheets of one project.`);
    if (from.deletedAt) throw new ValidationError(`"${from.name}" is deleted. The person can bring it back first.`);
    try { return { ...rest, source: findSection(from.sections, o.section) }; } catch (e) {
      throw new ValidationError(`In "${from.name}": ${(e as Error).message}`);
    }
  });
}

function metaOf(f: DesignFrame, measured?: { rev: string; height: number }): FrameMeta {
  const { html, css, piece: _, ...rest } = f;
  const meta: FrameMeta = { ...rest, code: codeHash(html, css), chars: html.length + css.length };
  if (!f.height && measured && measured.rev === frameRev(meta)) meta.measured = measured.height;
  return meta;
}
/** A piece without code: named for its thing as it is now, so a change to the thing is a new picture of it. */
function pieceMeta(f: DesignFrame, t: Thing | null | undefined): FrameMeta {
  const { html: _h, css: _c, ...rest } = pieceFrame(f, t);
  return { ...rest, code: codeHash(`piece:${f.piece!.kind}:${f.piece!.id}:${t ? `${t.rev}:${t.w}x${t.h}` : "gone"}`, ""), chars: 0 };
}

/** What names how a sheet's pieces look now, from their things: "" without pieces. */
const keyOf = (things: Map<string, Thing | null>) => (things.size ? codeHash([...things].map(([id, t]) => `${id}:${t ? `${t.rev}:${t.w}x${t.h}:${t.name}` : "gone"}`).join("|"), "") : "");
/** How a sheet's pieces look now: a board with this key and the sheet's version has all it needs. */
export const piecesKey = (store: Store, id: string): string => keyOf(thingsOf(store, getDesign(store, id)));

/** A sheet without its code, with how tall each frame was drawn: what the board lays out. */
export function designMeta(store: Store, d: Design): DesignMeta {
  const sizes = new Map((store.db.prepare("select frame_id, rev, height from design_sizes where design_id = ?").all(d.id) as { frame_id: string; rev: string; height: number }[]).map((r) => [r.frame_id, r]));
  const things = thingsOf(store, d);
  return { ...d, pieces: keyOf(things), sections: d.sections.map((s) => ({ ...s, frames: s.frames.map((f) => (f.piece ? pieceMeta(f, things.get(f.id)) : metaOf(f, sizes.get(f.id)))) })) };
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
export function createDesign(store: Store, projectId: string, input: { name: string; start?: "brand" | "blank"; ops?: DesignOp[] }, actor: Actor = "human"): Design & { made: DesignMade; lint: Record<string, DesignLint[]> } {
  if (projectId === LIBRARY_ID) throw new ValidationError("A design belongs to a project, not the Library.");
  const project = store.getProject(projectId);
  const t = now();
  const swatch = activeSwatch(store, projectId);
  const base = designStarter(input.start ?? "brand", { brand: project.name, hasLogo: swatch.logos.length > 0, now: t });
  const out = run(() => applyDesignOps({ name: input.name, sections: base }, [{ op: "rename", name: input.name }, ...fillPieces(store, projectId, input.ops ?? [])], byOf(actor), t));
  const id = newId("ds");
  store.write(() => {
    store.db.prepare("insert into designs (id, project_id, name, data, version, created_at, updated_at) values (?, ?, ?, ?, 1, ?, ?)")
      .run(id, projectId, out.name, JSON.stringify({ sections: out.sections }), t, t);
    store.logRow(projectId, actor, "design.created", out.name, { designId: id });
  });
  return { ...getDesign(store, id), made: out.made, lint: out.lint };
}

/** Changes, all or none, kept as one version: the one before goes to the history for Undo. */
export function changeDesign(store: Store, id: string, ops: DesignOp[], actor: Actor = "human"): Design & { made: DesignMade; lint: Record<string, DesignLint[]> } {
  if (!ops.length) throw new ValidationError("Say what to change.");
  const d = getDesign(store, id);
  if (d.deletedAt) throw new ValidationError("That design is deleted. Bring it back first.");
  const t = now();
  const applied = run(() => applyDesignOps(freshPieces(store, d), fillPieces(store, d.projectId, fillCopies(store, d, ops)), byOf(actor), t));
  // A piece shown at its own size again takes that shape now, not at the next change.
  const out = { ...applied, sections: freshPieces(store, { ...d, sections: applied.sections }).sections };
  store.write(() => {
    keepVersion(store, d, actor, t);
    const trimmed = store.db.prepare("delete from design_versions where design_id = ? and version <= ?").run(id, d.version - KEEP).changes;
    store.db.prepare("update designs set name = ?, data = ?, version = version + 1, updated_at = ? where id = ?").run(out.name, JSON.stringify({ sections: out.sections }), t, id);
    if (trimmed && d.version % 10 === 0) sweepCode(store, id);
    // A copied frame is drawn as tall as the one it came from: its code and width are the same.
    const size = store.db.prepare("insert or replace into design_sizes (design_id, frame_id, rev, height) select ?, ?, rev, height from design_sizes where design_id = ? and frame_id = ?");
    for (const c of applied.made.copies ?? []) for (const [was, copy] of Object.entries(c.frames)) size.run(id, copy, c.from ?? id, was);
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
