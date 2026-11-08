// Parts: the repository, library scope, versions, usage and portable files.

import { newId } from "./ids.ts";
import { BUILTIN_PARTS, BUILTIN_VERSION } from "./builtin-parts.ts";
import { NotFoundError, ValidationError, type Store } from "./store.ts";
import type { Actor, Part, PartCategory, PartKind, PartSlot, Pattern, Stitch } from "./types.ts";
import { editorFromPart, hasLintErrors, lintCodePart, partFromEditor } from "./parts-pure.ts";
import { cleanFolder, fileInto } from "./folders.ts";

type Row = Record<string, unknown>;
const CATEGORIES: PartCategory[] = ["text", "media", "motion", "frame", "cta", "other"];

function toPart(r: Row): Part {
  const data = JSON.parse(r.data as string) as { stitches: Stitch[]; html?: string; css?: string };
  return {
    id: r.id as string, projectId: (r.project_id as string) ?? null, builtin: !!r.builtin, name: r.name as string, description: r.description as string,
    category: r.category as PartCategory, tags: JSON.parse(r.tags as string), kind: r.kind as PartKind, stitches: data.stitches ?? [], html: data.html, css: data.css,
    slots: JSON.parse(r.slots as string) as PartSlot[], aspect: Number(r.aspect), durationMs: Number(r.duration_ms), version: Number(r.version),
    folder: (r.folder as string) ?? "", createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  };
}

export function getPart(store: Store, id: string): Part {
  const r = store.db.prepare("select * from parts where id = ?").get(id) as Row | undefined;
  if (!r) throw new NotFoundError("That part is not here any more.");
  return toPart(r);
}

/** This project's Parts and the library's. Built-ins sort last, so your own come first. */
export function listParts(store: Store, projectId: string): Part[] {
  ensureBuiltinParts(store);
  return (store.db.prepare("select * from parts where project_id = ? or project_id is null order by builtin, name collate nocase").all(projectId) as Row[]).map(toPart);
}

/** Seed the starter Parts once per version. Safe to call every time. */
export function ensureBuiltinParts(store: Store): void {
  if (store.getSetting("seeded.parts", 0) >= BUILTIN_VERSION) return;
  store.write(() => {
    const t = new Date().toISOString();
    store.db.prepare("delete from parts where builtin = 1").run();
    for (const b of BUILTIN_PARTS) {
      store.db.prepare("insert into parts (id, project_id, builtin, name, description, category, tags, kind, data, slots, aspect, duration_ms, version, created_at, updated_at) values (?, null, 1, ?, ?, ?, ?, 'stitches', ?, ?, ?, ?, ?, ?, ?)")
        .run(newId("pa"), b.name, b.description, b.category, JSON.stringify(b.tags ?? []), JSON.stringify({ stitches: b.stitches }), JSON.stringify(b.slots), b.aspect, b.durationMs ?? 0, BUILTIN_VERSION, t, t);
    }
  });
  store.setSetting("seeded.parts", BUILTIN_VERSION);
}

/** `folder`, when it is made: the folder in Parts it goes in. Moving it later is moveToFolder's. */
export interface PartInput {
  name: string; description?: string; category?: PartCategory; tags?: string[]; kind?: PartKind;
  stitches?: Stitch[]; html?: string; css?: string; slots?: PartSlot[]; aspect?: number; durationMs?: number; folder?: string;
}

function clean(i: PartInput): Required<Omit<PartInput, "html" | "css" | "folder">> & { html?: string; css?: string } {
  const name = String(i.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new ValidationError("Give the part a name.");
  if (name.length > 80) throw new ValidationError("That part name is too long. Keep it under 80 characters.");
  const kind: PartKind = i.kind === "code" ? "code" : "stitches";
  if (kind === "code") {
    const lint = lintCodePart(i.html ?? "", i.css ?? "");
    if (hasLintErrors(lint)) throw new ValidationError(lint.find((l) => l.level === "error")!.message);
    if (!(i.html ?? "").trim()) throw new ValidationError("A code part needs some markup.");
  } else if (!(i.stitches?.length)) throw new ValidationError("A part needs at least one stitch in it.");
  const slots = (i.slots ?? []).slice(0, 24).map((s) => {
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(s.name)) throw new ValidationError(`"${s.name}" is not a slot name. Use lowercase letters, numbers and underscores, like headline.`);
    return { name: s.name, kind: s.kind === "image" ? "image" as const : "text" as const, default: s.default, locked: !!s.locked };
  });
  if (new Set(slots.map((s) => s.name)).size !== slots.length) throw new ValidationError("Two slots have the same name. Each slot needs its own.");
  const aspect = Number(i.aspect ?? 1);
  if (!(aspect > 0.05 && aspect < 50)) throw new ValidationError("That shape is too extreme. The part's width over height has to be between 0.05 and 50.");
  return { name, description: String(i.description ?? "").slice(0, 400), category: CATEGORIES.includes(i.category as PartCategory) ? i.category as PartCategory : "other", tags: (i.tags ?? []).slice(0, 12), kind, stitches: i.stitches ?? [], html: i.html, css: i.css, slots, aspect, durationMs: Math.max(0, Math.round(i.durationMs ?? 0)) };
}

export function createPart(store: Store, projectId: string | null, input: PartInput, actor: Actor = "human"): Part {
  if (projectId) store.getProject(projectId);
  const c = clean(input);
  cleanFolder(input.folder);
  const id = newId("pa"), t = new Date().toISOString();
  store.write(() => {
    store.db.prepare("insert into parts (id, project_id, builtin, name, description, category, tags, kind, data, slots, aspect, duration_ms, version, folder, created_at, updated_at) values (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)")
      .run(id, projectId, c.name, c.description, c.category, JSON.stringify(c.tags), c.kind, JSON.stringify({ stitches: c.stitches, html: c.html, css: c.css }), JSON.stringify(c.slots), c.aspect, c.durationMs, fileInto(store, projectId, "parts", input.folder), t, t);
    if (projectId) store.logRow(projectId, actor, "part.created", c.name, null);
  });
  return getPart(store, id);
}

/** Editing a Part bumps its version; instances can see it moved and offer to review. */
export function updatePart(store: Store, id: string, patch: Partial<PartInput>): Part {
  const cur = getPart(store, id);
  if (cur.builtin) throw new ValidationError("The starter parts are read-only. Duplicate one to make it yours.");
  const c = clean({ ...cur, ...patch });
  store.write(() => store.db.prepare("update parts set name = ?, description = ?, category = ?, tags = ?, kind = ?, data = ?, slots = ?, aspect = ?, duration_ms = ?, version = version + 1, updated_at = ? where id = ?")
    .run(c.name, c.description, c.category, JSON.stringify(c.tags), c.kind, JSON.stringify({ stitches: c.stitches, html: c.html, css: c.css }), JSON.stringify(c.slots), c.aspect, c.durationMs, new Date().toISOString(), id));
  return getPart(store, id);
}

/** Where a Part is used, across the patterns of every project. */
export function partUsage(store: Store, id: string): { patternId: string; patternName: string; projectId: string }[] {
  const rows = store.db.prepare("select id, name, project_id, doc from patterns where part_id is null and doc like ?").all(`%"partId":"${id}"%`) as { id: string; name: string; project_id: string; doc: string }[];
  return rows.filter((r) => (JSON.parse(r.doc).stitches as Stitch[]).some((s) => s.partId === id)).map((r) => ({ patternId: r.id, patternName: r.name, projectId: r.project_id }));
}

export function deletePart(store: Store, id: string): { usedIn: number } {
  const p = getPart(store, id);
  if (p.builtin) throw new ValidationError("The starter parts cannot be deleted.");
  const usedIn = partUsage(store, id).length;
  store.write(() => {
    store.db.prepare("delete from patterns where part_id = ?").run(id);
    store.db.prepare("delete from parts where id = ?").run(id);
  });
  return { usedIn };
}

/**
 * Open a Part in the pattern editor. It is edited through a pattern of its own, hidden from
 * Patterns, in `projectId` (a library Part is edited in the brand of the project it was opened
 * from). Every change made there is the Part's, and one sitting is one new version. The pattern
 * is kept between sittings, with its history, unless the Part was changed some other way since.
 */
export function editPart(store: Store, id: string, projectId: string): Pattern {
  const part = getPart(store, id);
  if (part.builtin) throw new ValidationError("The starter parts are read-only. Edit a copy to make it yours.");
  if (part.kind !== "stitches") throw new ValidationError("A part written in code is edited as code, on the Parts page.");
  const home = part.projectId ?? projectId;
  store.getProject(home);
  const row = store.db.prepare("select id, project_id from patterns where part_id = ? order by updated_at desc limit 1").get(id) as Row | undefined;
  if (row && row.project_id === home) {
    const p = store.getPattern(row.id as string);
    if (JSON.stringify(partFromEditor(p.stitches, p.size).stitches) === JSON.stringify(part.stitches) && p.name === part.name) {
      store.write(() => store.db.prepare("update patterns set part_base = ? where id = ?").run(part.version, p.id));
      return p;
    }
  }
  if (row) store.write(() => store.db.prepare("delete from patterns where part_id = ?").run(id));
  const view = editorFromPart(part);
  return store.insertPartPattern(home, id, part.version, part.name, view.size, view.stitches);
}

/** The copy goes next to the original, in its folder, or into `folder` when one is given. */
export function duplicatePart(store: Store, id: string, toProjectId: string | null | undefined = undefined, folder?: string): Part {
  const p = getPart(store, id);
  return createPart(store, toProjectId === undefined ? p.projectId : toProjectId, { ...p, name: p.builtin ? p.name : `${p.name} copy`, folder: folder ?? p.folder });
}

/** Move a project's Part into the library (every project can use it), or back. It stays in its folder. */
export function setPartScope(store: Store, id: string, projectId: string | null): Part {
  const p = getPart(store, id);
  if (p.builtin) throw new ValidationError("The starter parts already live in the library.");
  if (projectId) store.getProject(projectId);
  store.write(() => {
    store.db.prepare("update parts set project_id = ?, updated_at = ? where id = ?").run(projectId, new Date().toISOString(), id);
    if (projectId) fileInto(store, projectId, "parts", p.folder);
  });
  return getPart(store, id);
}

// ── a Part as a plain file, so people can share them ─────────────────────────
export function exportPart(store: Store, id: string) {
  const p = getPart(store, id);
  return { format: "knitted-part", version: 1, part: { name: p.name, description: p.description, category: p.category, tags: p.tags, kind: p.kind, stitches: p.stitches, html: p.html, css: p.css, slots: p.slots, aspect: p.aspect, durationMs: p.durationMs } };
}
/** A part from a file, into `folder` in Parts. Where it was filed where it came from is not in the file. */
export function importPart(store: Store, projectId: string | null, file: unknown, folder?: string): Part {
  const f = file as { format?: string; version?: number; part?: PartInput };
  if (f?.format !== "knitted-part" || !f.part) throw new ValidationError("That is not a knitted part file.");
  if ((f.version ?? 1) > 1) throw new ValidationError("That part was made by a newer knitted. Update the app to import it.");
  return createPart(store, projectId, { ...f.part, folder });
}
