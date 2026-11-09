// Folders: how a person sorts a section of a project, in folders and folders inside them.
//
// Each thing keeps the path of the folder it is in, in its own row ("" is the top), and
// the folders table keeps the folders themselves, so one that is emptied stays until it
// is deleted. A library part shows in every project, and is in the same folder in each,
// so a section's folders are the ones kept for it and the ones its things are in.
//
// Where a thing is filed never changes what it is: a pattern in a folder knits the same,
// a file in one fills the same slots. Deleting a folder deletes nothing in it: what it
// held moves up into the folder that held it.

import { NotFoundError, ValidationError, type Store } from "./store.ts";
import type { Actor } from "./types.ts";
import { FOLDER_DEPTH, FOLDER_SECTIONS, compareFolders, depthOf, folderNames, folderProblem, isInside, joinFolder, nameOf, parentOf, refiled, type FolderSection } from "./folders-pure.ts";

/**
 * The rows a section's folders sort, in one project, and what to call them. `shelf`: Yarn
 * and the reference are files in one table, each on its own shelf, so filing a file in the
 * other's folder moves it to that shelf.
 */
const SECTION: Record<FolderSection, { table: string; scope: string; name: string; one: string; many: string; shelf?: "yarn" | "reference" }> = {
  patterns: { table: "patterns", scope: "project_id = ?", name: "Patterns", one: "pattern", many: "patterns" },
  // Deleted Yarn too: a file brought back with Undo comes back to its folder.
  yarn: { table: "yarn", scope: "project_id = ? and shelf = 'yarn'", name: "Yarn", one: "file", many: "files", shelf: "yarn" },
  // A library part is the project's to sort as much as its own. The starter parts stay where they are.
  parts: { table: "parts", scope: "(project_id = ? or project_id is null) and builtin = 0", name: "Parts", one: "part", many: "parts" },
  swatches: { table: "swatches", scope: "project_id = ?", name: "Swatches", one: "swatch", many: "swatches" },
  knits: { table: "knits", scope: "project_id = ?", name: "Knits", one: "knit", many: "knits" },
  reference: { table: "yarn", scope: "project_id = ? and shelf = 'reference'", name: "the reference", one: "reference file", many: "reference files", shelf: "reference" },
};

function sectionOf(section: string): (typeof SECTION)[FolderSection] {
  if (!Object.hasOwn(SECTION, section)) throw new ValidationError(`"${section}" has no folders. These do: ${FOLDER_SECTIONS.join(", ")}.`);
  return SECTION[section as FolderSection];
}
const count = (n: number, s: { one: string; many: string }) => `${n} ${n === 1 ? s.one : s.many}`;

/** A folder's path as it is kept: names tidied and joined with "/", "" for the top. Says what to fix when it cannot be one. */
export function cleanFolder(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") throw new ValidationError("A folder is a path of names, like Royalty free music/Lo-fi.");
  const problem = folderProblem(raw);
  if (problem) throw new ValidationError(problem);
  return folderNames(raw).join("/");
}

/** Every folder in a section, as paths in order, with the folders that hold them. */
export function listFolders(store: Store, projectId: string, section: FolderSection): string[] {
  const s = sectionOf(section);
  const kept = store.db.prepare("select path from folders where project_id = ? and section = ?").all(projectId, section) as { path: string }[];
  const used = store.db.prepare(`select distinct folder from ${s.table} where ${s.scope} and folder != ''`).all(projectId) as { folder: string }[];
  const all = new Set<string>();
  for (const p of [...kept.map((r) => r.path), ...used.map((r) => r.folder)]) for (let q = p; q; q = parentOf(q)) all.add(q);
  return [...all].sort(compareFolders);
}

/** How many things each folder holds itself, not counting the folders inside it. Deleted Yarn does not count. */
export function folderCounts(store: Store, projectId: string, section: FolderSection): Map<string, number> {
  const s = sectionOf(section);
  // A knit counts once, as the file shown for it.
  const live = s.table === "yarn" ? " and deleted_at is null" : s.table === "knits" ? " and head = 1" : "";
  const rows = store.db.prepare(`select folder, count(*) as n from ${s.table} where ${s.scope}${live} group by folder`).all(projectId) as { folder: string; n: number }[];
  return new Map(rows.map((r) => [r.folder, Number(r.n)]));
}

/** `path` spelled as the folders already there are: "royalty free music/lofi" is the Lofi folder in Royalty free music. */
function spelled(all: string[], path: string): string {
  let at = "";
  for (const name of path ? path.split("/") : []) {
    const want = name.toLowerCase();
    at = all.find((f) => parentOf(f) === at && nameOf(f).toLowerCase() === want) ?? joinFolder(at, name);
  }
  return at;
}

/** A folder as someone named it, spelled as it is in the section: "royalty free MUSIC" is Royalty free music. One that is not there is as given. */
export function folderNamed(store: Store, projectId: string, section: FolderSection, raw: unknown): string {
  const path = cleanFolder(raw);
  return path ? spelled(listFolders(store, projectId, section), path) : "";
}

/** Keep a folder, and the folders that hold it. Inside the caller's write. */
function keep(store: Store, projectId: string, section: FolderSection, path: string, at = new Date().toISOString()) {
  const add = store.db.prepare("insert or ignore into folders (project_id, section, path, created_at) values (?, ?, ?, ?)");
  for (let p = path; p; p = parentOf(p)) add.run(projectId, section, p, at);
}

/**
 * The folder a thing being made goes in: `raw` cleaned, spelled as the folders there
 * are, and kept. Inside the caller's write. A library part, in no project, keeps only
 * its path, and shows in that folder wherever it is listed.
 */
export function fileInto(store: Store, projectId: string | null, section: FolderSection, raw: unknown): string {
  const path = cleanFolder(raw);
  if (!path || !projectId) return path;
  const folder = spelled(listFolders(store, projectId, section), path);
  keep(store, projectId, section, folder);
  return folder;
}

/** Make a folder, and the folders it is inside. One that is there already is the one returned. */
export function createFolder(store: Store, projectId: string, section: FolderSection, raw: unknown, actor: Actor = "human"): string {
  store.getProject(projectId);
  sectionOf(section);
  if (!cleanFolder(raw)) throw new ValidationError("Give the folder a name.");
  return store.write(() => {
    const had = new Set(listFolders(store, projectId, section));
    const path = fileInto(store, projectId, section, raw);
    if (actor !== "human" && !had.has(path)) store.logRow(projectId, actor, "folder.created", path, { section });
    return path;
  });
}

/** File things into a folder, making it when it is not there. "" is the top of the section. */
export function moveToFolder(store: Store, projectId: string, section: FolderSection, ids: string[], raw: unknown, actor: Actor = "human"): { folder: string; moved: number } {
  if (!ids.length) throw new ValidationError(`Say which ${sectionOf(section).many} to move.`);
  const r = moveAllToFolder(store, projectId, { [section]: ids }, raw, actor)[section];
  return { folder: r?.folder ?? cleanFolder(raw), moved: r?.moved ?? 0 };
}

/**
 * File things from several sections into the folder of that path in each, all or none:
 * an id that is not the project's moves nothing. Says, for each section, where they went.
 * A file filed in Yarn or the reference moves to that shelf, from either.
 */
export function moveAllToFolder(store: Store, projectId: string, groups: Partial<Record<FolderSection, string[]>>, raw: unknown, actor: Actor = "human"): Partial<Record<FolderSection, { folder: string; moved: number }>> {
  store.getProject(projectId);
  cleanFolder(raw);
  const asked = Object.entries(groups).map(([section, ids]) => [section, sectionOf(section), [...new Set((ids ?? []).map(String))]] as const).filter(([, , ids]) => ids.length);
  if (!asked.length) throw new ValidationError("Say what to move.");
  const twice = asked.filter(([, s]) => s.shelf).flatMap(([, , ids]) => ids).find((id, i, all) => all.indexOf(id) !== i);
  if (twice) throw new ValidationError(`${twice} cannot go in Yarn and the reference at once. Give it once.`);
  for (const [section, s, ids] of asked) {
    // A file is the project's on either shelf: filing it in the other one moves it there.
    const mine = store.db.prepare(`select 1 from ${s.table} where id = ? and ${s.shelf ? "project_id = ?" : s.scope}`);
    for (const id of ids) {
      if (mine.get(id, projectId)) continue;
      if (section === "parts" && store.db.prepare("select 1 from parts where id = ? and builtin = 1").get(id)) throw new ValidationError("The starter parts stay where they are. Duplicate one to file the copy.");
      throw new NotFoundError(`${id} is not one of this project's ${s.many}. It may have been deleted.`);
    }
  }
  return store.write(() => {
    const out: Partial<Record<FolderSection, { folder: string; moved: number }>> = {};
    for (const [section, s, ids] of asked) {
      const folder = fileInto(store, projectId, section as FolderSection, raw);
      const set = s.shelf
        ? store.db.prepare(`update yarn set folder = ?, shelf = '${s.shelf}' where id = ? and (folder != ? or shelf != '${s.shelf}')`)
        : store.db.prepare(`update ${s.table} set folder = ? where id = ? and folder != ?`);
      let moved = 0;
      // A knit is filed whole: every version and format of it goes with the one moved.
      const whole = section === "knits" ? store.db.prepare("update knits set folder = ? where project_id = ? and unit = (select unit from knits where id = ?) and id != ? and folder != ?") : null;
      for (const id of ids) {
        const n = Number(set.run(folder, id, folder).changes);
        moved += whole ? Math.min(1, n + Number(whole.run(folder, projectId, id, id, folder).changes)) : n;
      }
      if (actor !== "human" && moved) store.logRow(projectId, actor, "folder.filed", `${count(moved, s)} ${folder ? `into ${folder}` : `to the top of ${s.name}`}`, { section, folder, ids });
      out[section as FolderSection] = { folder, moved };
    }
    return out;
  });
}

/** Every folder at or inside `from`, and everything in them, moved to `to` ("" is the top). Inside the caller's write. */
function refile(store: Store, projectId: string, section: FolderSection, from: string, to: string) {
  const s = SECTION[section];
  const rows = store.db.prepare("select path, created_at from folders where project_id = ? and section = ?").all(projectId, section) as { path: string; created_at: string }[];
  // All out, then all in: a folder emptied into the one that held it can take the place of a folder it held.
  const moves = rows.map((r) => ({ r, next: refiled(r.path, from, to) })).filter((m) => m.next !== null);
  const drop = store.db.prepare("delete from folders where project_id = ? and section = ? and path = ?");
  const add = store.db.prepare("insert or ignore into folders (project_id, section, path, created_at) values (?, ?, ?, ?)");
  for (const m of moves) drop.run(projectId, section, m.r.path);
  for (const m of moves) if (m.next) add.run(projectId, section, m.next, m.r.created_at);
  if (to) keep(store, projectId, section, to);
  const things = store.db.prepare(`select id, folder from ${s.table} where ${s.scope} and folder != ''`).all(projectId) as { id: string; folder: string }[];
  const set = store.db.prepare(`update ${s.table} set folder = ? where id = ?`);
  for (const t of things) {
    const next = refiled(t.folder, from, to);
    if (next !== null) set.run(next, t.id);
  }
}

/**
 * Rename a folder, or move it into another by giving its whole new path: what is in it,
 * and the folders inside it, go with it. Into a folder that is there already, the two
 * become one. Returns where the folder is now.
 */
export function renameFolder(store: Store, projectId: string, section: FolderSection, rawFrom: unknown, rawTo: unknown, actor: Actor = "human"): string {
  store.getProject(projectId);
  const s = sectionOf(section);
  const all = listFolders(store, projectId, section);
  const from = cleanFolder(rawFrom);
  if (!from || !all.includes(from)) throw new NotFoundError(`There is no folder ${from ? `"${from}"` : "by that name"} in ${s.name}.`);
  const wanted = cleanFolder(rawTo);
  if (!wanted) throw new ValidationError("Give the folder a name.");
  // The folders it goes into, spelled as they are; its own name as given, so a rename can change only its case.
  const parent = spelled(all, parentOf(wanted));
  const twin = all.find((f) => f !== from && parentOf(f) === parent && nameOf(f).toLowerCase() === nameOf(wanted).toLowerCase());
  const to = twin ?? joinFolder(parent, nameOf(wanted));
  if (to === from) return from;
  if (to.startsWith(`${from}/`)) throw new ValidationError("A folder cannot go inside itself.");
  const below = Math.max(0, ...all.filter((f) => f.startsWith(`${from}/`)).map((f) => depthOf(f) - depthOf(from)));
  if (depthOf(to) + below > FOLDER_DEPTH) throw new ValidationError(`Folders go ${FOLDER_DEPTH} deep at most, and that would put the folders inside ${nameOf(from)} deeper. Put it higher up.`);
  store.write(() => {
    refile(store, projectId, section, from, to);
    if (actor !== "human") store.logRow(projectId, actor, "folder.renamed", `${from} to ${to}`, { section, from, to });
  });
  return to;
}

/** Delete a folder and nothing in it: what it held, things and folders, moves up into the folder that held it. */
export function deleteFolder(store: Store, projectId: string, section: FolderSection, raw: unknown, actor: Actor = "human"): { folder: string; movedTo: string; moved: number } {
  store.getProject(projectId);
  const s = sectionOf(section);
  const path = cleanFolder(raw);
  if (!path || !listFolders(store, projectId, section).includes(path)) throw new NotFoundError(`There is no folder ${path ? `"${path}"` : "by that name"} in ${s.name}.`);
  let moved = 0;
  for (const [folder, n] of folderCounts(store, projectId, section)) if (folder && isInside(folder, path)) moved += n;
  const movedTo = parentOf(path);
  store.write(() => {
    refile(store, projectId, section, path, movedTo);
    if (actor !== "human") store.logRow(projectId, actor, "folder.deleted", path, { section, movedTo });
  });
  return { folder: path, movedTo, moved };
}
