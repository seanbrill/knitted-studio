// Design sheets: kept, changed, undone, copied and deleted. What a sheet is, and the changes
// it takes, are design-pure.ts; this is where they are stored.

import { newId } from "./ids.ts";
import { NotFoundError, ValidationError, type Store } from "./store.ts";
import { activeSwatch } from "./swatch.ts";
import { applyDesignOps, designStarter, DesignProblem, type Design, type DesignLint, type DesignOp, type DesignSection } from "./design-pure.ts";
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
    store.db.prepare("insert or replace into design_versions (design_id, version, name, data, actor, at) values (?, ?, ?, ?, ?, ?)")
      .run(id, d.version, d.name, JSON.stringify({ sections: d.sections }), actor, t);
    store.db.prepare("delete from design_versions where design_id = ? and version <= ?").run(id, d.version - KEEP);
    store.db.prepare("update designs set name = ?, data = ?, version = version + 1, updated_at = ? where id = ?").run(out.name, JSON.stringify({ sections: out.sections }), t, id);
  });
  return { ...getDesign(store, id), made: out.made, lint: out.lint };
}

/** Back one version: the newest kept one becomes the sheet again, and leaves the history. */
export function undoDesign(store: Store, id: string): Design {
  const d = getDesign(store, id);
  const prev = store.db.prepare("select * from design_versions where design_id = ? order by version desc limit 1").get(id) as { name: string; data: string; version: number } | undefined;
  if (!prev) throw new ValidationError("There is nothing to undo in this design.");
  store.write(() => {
    store.db.prepare("update designs set name = ?, data = ?, version = ?, updated_at = ? where id = ?").run(prev.name, prev.data, d.version + 1, now(), id);
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
