// Folders: a section sorted into folders, and folders inside them. What is promised: a
// thing is filed, never changed, by it; deleting a folder deletes nothing in it; renaming
// one takes what it holds along; and each section's folders are its own.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NotFoundError, ValidationError, cleanFolder, createCopy, createFolder, createPart, createSwatch, deleteFolder, deleteYarn, duplicatePart, duplicateSwatch, folderCounts,
  getYarn, importPart, insertKnit, listFolders, listKnits, listParts, listSwatches, listYarn, migrate, moveToFolder, openStore, renameFolder, setPartScope, undeleteYarn,
} from "../src/node.ts";
import { MIGRATIONS } from "../src/migrations.ts";
import { compareFolders, folderProblem, isInside, parentOf, refiled } from "../src/index.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "knitted-folders-"));
const fresh = () => {
  const store = openStore(join(tmp(), "k.db"));
  return { store, project: store.createProject({ name: "Folders", starter: "social" }) };
};
const stitch = { id: "s", kind: "text", x: 0, y: 0, w: 1, h: 1, locked: false, content: "Hi" };
const knit = (store, projectId, label) => insertKnit(store, { projectId, patternId: null, patternName: "P", jobId: null, batchId: null, label, file: `day/${label}.png`, kind: "image", format: "png", width: 10, height: 10, bytes: 1, durationMs: null, hash: label, report: {} });

test("a library made before folders opens with everything at the top, and nothing else changed", () => {
  const file = join(tmp(), "old.db");
  const old = new DatabaseSync(file);
  migrate(old, MIGRATIONS.filter((m) => m.version <= 5));
  old.exec(`insert into projects (id, name, created_at, updated_at) values ('pj_old', 'Old', 't', 't');
    insert into patterns (id, project_id, name, size, doc, created_at, updated_at) values ('pt_old', 'pj_old', 'Kept', '{"name":"Story","w":1080,"h":1920}', '{"stitches":[]}', 't', 't');`);
  old.close();
  const store = openStore(file);
  const p = store.getPattern("pt_old");
  assert.equal(p.name, "Kept");
  assert.equal(p.folder, "");
  assert.deepEqual(listFolders(store, "pj_old", "patterns"), []);
});

test("a folder's path is its names, tidied, and one that cannot be a folder says why", () => {
  assert.equal(cleanFolder("  Royalty   free music / Lo-fi /"), "Royalty free music/Lo-fi");
  assert.equal(cleanFolder("//"), "");
  assert.equal(cleanFolder(undefined), "");
  assert.throws(() => cleanFolder("a/b/c/d/e/f/g"), /6 deep at most/);
  assert.throws(() => cleanFolder("x".repeat(61)), /too long for a folder's name/);
  assert.throws(() => cleanFolder("Music/.."), /cannot be called/);
  assert.throws(() => cleanFolder(42), ValidationError);
  assert.equal(folderProblem("Fine/Also fine"), null);
  assert.deepEqual(["Week 10", "week 2", "Week 1/Day 3", "Week 1"].sort(compareFolders), ["Week 1", "Week 1/Day 3", "week 2", "Week 10"]);
  assert.equal(refiled("A/B/C", "A/B", "X"), "X/C");
  assert.equal(refiled("A/B", "A/B", ""), "");
  assert.equal(refiled("A/Bee", "A/B", "X"), null, "a folder whose name only starts the same is not inside it");
  assert.ok(isInside("A/B", "A") && isInside("A", "") && !isInside("AB", "A"));
  assert.equal(parentOf("A/B/C"), "A/B");
});

test("making a folder makes the folders it is inside; making one that is there finds it, whatever its case", () => {
  const { store, project } = fresh();
  assert.equal(createFolder(store, project.id, "yarn", "Royalty free music/Lo-fi"), "Royalty free music/Lo-fi");
  assert.equal(createFolder(store, project.id, "yarn", "royalty FREE music/Cinematic"), "Royalty free music/Cinematic");
  assert.equal(createFolder(store, project.id, "yarn", "ROYALTY FREE MUSIC"), "Royalty free music");
  assert.deepEqual(listFolders(store, project.id, "yarn"), ["Royalty free music", "Royalty free music/Cinematic", "Royalty free music/Lo-fi"]);
  assert.throws(() => createFolder(store, project.id, "yarn", " / "), /Give the folder a name/);
  assert.throws(() => createFolder(store, project.id, "toString", "A"), /has no folders/);
});

test("each section has folders of its own", () => {
  const { store, project } = fresh();
  createFolder(store, project.id, "yarn", "Client A");
  assert.deepEqual(listFolders(store, project.id, "yarn"), ["Client A"]);
  assert.deepEqual(listFolders(store, project.id, "patterns"), []);
  assert.deepEqual(listFolders(store, store.createProject({ name: "Other" }).id, "yarn"), [], "and each project");
});

test("filing a pattern changes where it is listed and nothing else: not its version, not its history", () => {
  const { store, project } = fresh();
  const p = store.listPatterns(project.id)[0];
  const history = store.revisions(p.id).length;
  assert.deepEqual(moveToFolder(store, project.id, "patterns", [p.id], "Spring/Launch"), { folder: "Spring/Launch", moved: 1 });
  const after = store.getPattern(p.id);
  assert.equal(after.folder, "Spring/Launch");
  assert.equal(after.version, p.version);
  assert.deepEqual(after.stitches, p.stitches);
  assert.equal(store.revisions(p.id).length, history);
  assert.deepEqual(listFolders(store, project.id, "patterns"), ["Spring", "Spring/Launch"]);
  assert.deepEqual(moveToFolder(store, project.id, "patterns", [p.id], "spring/launch"), { folder: "Spring/Launch", moved: 0 }, "already there");
  assert.deepEqual(moveToFolder(store, project.id, "patterns", [p.id], ""), { folder: "", moved: 1 });
  assert.deepEqual(listFolders(store, project.id, "patterns"), ["Spring", "Spring/Launch"], "an emptied folder stays");
});

test("only this project's own things are filed, and the starter parts stay where they are", () => {
  const { store, project } = fresh();
  const other = store.createProject({ name: "Other", starter: "social" });
  const theirs = store.listPatterns(other.id)[0];
  assert.throws(() => moveToFolder(store, project.id, "patterns", [theirs.id], "A"), (e) => e instanceof NotFoundError && e.message.includes(theirs.id));
  assert.equal(store.getPattern(theirs.id).folder, "");
  const starter = listParts(store, project.id).find((p) => p.builtin);
  assert.throws(() => moveToFolder(store, project.id, "parts", [starter.id], "A"), /starter parts stay where they are/);
  assert.throws(() => moveToFolder(store, project.id, "patterns", [], "A"), /Say which patterns to move/);
  assert.deepEqual(listFolders(store, project.id, "patterns"), [], "a refused move makes no folder");
});

test("renaming a folder takes everything in it along, folders inside it too", () => {
  const { store, project } = fresh();
  const [a, b, c] = store.listPatterns(project.id);
  moveToFolder(store, project.id, "patterns", [a.id], "Music");
  moveToFolder(store, project.id, "patterns", [b.id], "Music/Lofi");
  moveToFolder(store, project.id, "patterns", [c.id], "Musical");
  createFolder(store, project.id, "patterns", "Music/Lofi/Empty");
  assert.equal(renameFolder(store, project.id, "patterns", "Music", "Royalty free music"), "Royalty free music");
  assert.equal(store.getPattern(a.id).folder, "Royalty free music");
  assert.equal(store.getPattern(b.id).folder, "Royalty free music/Lofi");
  assert.equal(store.getPattern(c.id).folder, "Musical", "a folder whose name only starts the same stays");
  assert.deepEqual(listFolders(store, project.id, "patterns"), ["Musical", "Royalty free music", "Royalty free music/Lofi", "Royalty free music/Lofi/Empty"]);
  // A rename can change only the case.
  assert.equal(renameFolder(store, project.id, "patterns", "Royalty free music/Lofi", "Royalty free music/LOFI"), "Royalty free music/LOFI");
  assert.equal(store.getPattern(b.id).folder, "Royalty free music/LOFI");
  assert.throws(() => renameFolder(store, project.id, "patterns", "Royalty free music", "Royalty free music/LOFI/Inside"), /cannot go inside itself/);
  assert.throws(() => renameFolder(store, project.id, "patterns", "Nope", "X"), NotFoundError);
  assert.throws(() => renameFolder(store, project.id, "patterns", "Musical", "a/b/c/d/e/f/Musical"), /6 deep/);
  assert.throws(() => renameFolder(store, project.id, "patterns", "Royalty free music", "a/b/c/d/Royalty free music"), /deeper/);
});

test("moving a folder into one of the same name makes the two one", () => {
  const { store, project } = fresh();
  const [a, b] = store.listPatterns(project.id);
  moveToFolder(store, project.id, "patterns", [a.id], "Old/Logos");
  moveToFolder(store, project.id, "patterns", [b.id], "New/logos");
  assert.equal(renameFolder(store, project.id, "patterns", "Old/Logos", "new/Logos"), "New/logos");
  assert.equal(store.getPattern(a.id).folder, "New/logos");
  assert.equal(store.getPattern(b.id).folder, "New/logos");
  assert.deepEqual(listFolders(store, project.id, "patterns"), ["New", "New/logos", "Old"]);
});

test("deleting a folder deletes nothing in it: things and folders move up into the one that held it", () => {
  const { store, project } = fresh();
  const [a, b, c] = store.listPatterns(project.id);
  moveToFolder(store, project.id, "patterns", [a.id], "Music/Lofi");
  moveToFolder(store, project.id, "patterns", [b.id], "Music/Lofi/Rain");
  moveToFolder(store, project.id, "patterns", [c.id], "Music");
  createFolder(store, project.id, "patterns", "Music/Lofi/Empty");
  assert.deepEqual(deleteFolder(store, project.id, "patterns", "Music/Lofi"), { folder: "Music/Lofi", movedTo: "Music", moved: 2 });
  assert.equal(store.getPattern(a.id).folder, "Music");
  assert.equal(store.getPattern(b.id).folder, "Music/Rain");
  assert.equal(store.listPatterns(project.id).length, 5, "every pattern is still there");
  assert.deepEqual(listFolders(store, project.id, "patterns"), ["Music", "Music/Empty", "Music/Rain"]);
  assert.deepEqual(deleteFolder(store, project.id, "patterns", "Music"), { folder: "Music", movedTo: "", moved: 3 });
  assert.equal(store.getPattern(c.id).folder, "");
  assert.equal(store.getPattern(b.id).folder, "Rain");
  assert.deepEqual(listFolders(store, project.id, "patterns"), ["Empty", "Rain"]);
});

test("a folder emptied into the one that held it can take the place of a folder it held", () => {
  const { store, project } = fresh();
  const [a, b] = store.listPatterns(project.id);
  moveToFolder(store, project.id, "patterns", [a.id], "A/B");
  moveToFolder(store, project.id, "patterns", [b.id], "A/B/B");
  deleteFolder(store, project.id, "patterns", "A/B");
  assert.equal(store.getPattern(a.id).folder, "A");
  assert.equal(store.getPattern(b.id).folder, "A/B");
  assert.deepEqual(listFolders(store, project.id, "patterns"), ["A", "A/B"]);
});

test("new things go into the folder they are made in, and a copy goes next to the original", async () => {
  const { store, project } = fresh();
  const p = store.createPattern(project.id, { name: "Filed", folder: "spring/Posts" });
  assert.equal(p.folder, "spring/Posts");
  assert.equal(store.duplicatePattern(p.id).folder, "spring/Posts");
  assert.equal(store.createPattern(project.id, { name: "Spelled", folder: "SPRING/posts" }).folder, "spring/Posts", "spelled as the folder there is");
  assert.throws(() => store.createPattern(project.id, { name: "Bad", folder: "a/b/c/d/e/f/g" }), /6 deep/);

  const { yarn } = await createCopy(store, project.id, { name: "Hooks", text: "Spring is here", folder: "Copy/Spring" });
  assert.equal(yarn.folder, "Copy/Spring");
  const again = await createCopy(store, project.id, { name: "Hooks again", text: "Spring is here", folder: "Elsewhere" });
  assert.equal(again.existing, true);
  assert.equal(again.yarn.folder, "Copy/Spring", "a file already in Yarn stays where it is");
  assert.deepEqual(listFolders(store, project.id, "yarn"), ["Copy", "Copy/Spring"], "and no folder is made for it");
  assert.deepEqual(listYarn(store, project.id, { folder: "copy/SPRING" }).map((y) => y.id), [yarn.id], "a folder is found whatever its case, as filing finds it");
  assert.deepEqual(listYarn(store, project.id, { folder: "Cop" }).map((y) => y.id), [], "and only by its whole name");
  assert.deepEqual(listYarn(store, project.id, { folder: "Copy" }).map((y) => y.id), [yarn.id], "what is in a folder, and in the folders inside it");

  const part = createPart(store, project.id, { name: "Footer", stitches: [stitch], folder: "Footers" });
  assert.equal(part.folder, "Footers");
  assert.equal(duplicatePart(store, part.id).folder, "Footers");
  const starter = listParts(store, project.id).find((x) => x.builtin);
  assert.equal(duplicatePart(store, starter.id, project.id, "Mine").folder, "Mine", "a starter part's copy goes where it is asked to");
  const file = { format: "knitted-part", version: 1, part: { name: "Imported", stitches: [stitch] } };
  assert.equal(importPart(store, project.id, file, "Footers").folder, "Footers");

  const sw = createSwatch(store, project.id, { data: { name: "Summer" }, folder: "Seasonal" });
  assert.equal(sw.folder, "Seasonal");
  assert.equal(duplicateSwatch(store, sw.id).folder, "Seasonal");
  assert.equal(JSON.parse(store.db.prepare("select data from swatches where id = ?").get(sw.id).data).folder, undefined, "the folder is not part of the brand");
  assert.deepEqual(listSwatches(store, project.id).filter((s) => s.folder === "Seasonal").map((s) => s.name), ["Summer", "Summer copy"]);
});

test("a duplicated project keeps its patterns' and swatches' folders, empty ones too", () => {
  const { store, project } = fresh();
  const p = store.listPatterns(project.id)[0];
  moveToFolder(store, project.id, "patterns", [p.id], "Launch");
  createFolder(store, project.id, "patterns", "Later");
  createFolder(store, project.id, "swatches", "Seasonal");
  createFolder(store, project.id, "yarn", "Logos");
  const copy = store.duplicateProject(project.id);
  assert.deepEqual(store.listPatterns(copy.id).map((x) => x.folder).filter(Boolean), ["Launch"]);
  assert.deepEqual(listFolders(store, copy.id, "patterns"), ["Later", "Launch"]);
  assert.deepEqual(listFolders(store, copy.id, "swatches"), ["Seasonal"]);
  assert.deepEqual(listFolders(store, copy.id, "yarn"), [], "Yarn stays with the first project");
});

test("a library part is in the same folder in every project that shows it", () => {
  const { store, project } = fresh();
  const other = store.createProject({ name: "Other" });
  const part = createPart(store, null, { name: "Shared", stitches: [stitch] });
  moveToFolder(store, project.id, "parts", [part.id], "Lower thirds");
  assert.deepEqual(listFolders(store, other.id, "parts"), ["Lower thirds"]);
  renameFolder(store, other.id, "parts", "Lower thirds", "Thirds");
  assert.equal(listParts(store, project.id).find((x) => x.id === part.id).folder, "Thirds");
  const mine = createPart(store, project.id, { name: "Mine", stitches: [stitch], folder: "Kept" });
  setPartScope(store, mine.id, null);
  assert.equal(listParts(store, other.id).find((x) => x.id === mine.id).folder, "Kept", "moved to the library, it stays in its folder");
});

test("a deleted file comes back with Undo to its folder, renamed or not", async () => {
  const { store, project } = fresh();
  const { yarn } = await createCopy(store, project.id, { name: "Note", text: "Keep me", folder: "Notes" });
  deleteYarn(store, yarn.id);
  assert.deepEqual(folderCounts(store, project.id, "yarn").get("Notes") ?? 0, 0, "deleted Yarn is not counted");
  renameFolder(store, project.id, "yarn", "Notes", "Kept notes");
  undeleteYarn(store, yarn.id);
  assert.equal(getYarn(store, yarn.id).folder, "Kept notes");
});

test("knits are filed like anything else, and a folder's knits are found by its path, whatever is in its name", () => {
  const { store, project } = fresh();
  const [a, b, c] = ["one", "two", "three"].map((l) => knit(store, project.id, l));
  assert.equal(a.folder, "", "a knit lands at the top");
  moveToFolder(store, project.id, "knits", [a.id, b.id], "Spring 🌸");
  moveToFolder(store, project.id, "knits", [b.id], "Spring 🌸/Week 1");
  moveToFolder(store, project.id, "knits", [c.id], "Spring 🌸s");
  assert.deepEqual(listKnits(store, project.id, { folder: "Spring 🌸" }).map((k) => k.label).sort(), ["one", "two"]);
  assert.deepEqual(listKnits(store, project.id, { folder: "Spring 🌸/Week 1" }).map((k) => k.label), ["two"]);
  renameFolder(store, project.id, "knits", "Spring 🌸", "Spring");
  assert.deepEqual(listKnits(store, project.id, { folder: "Spring" }).map((k) => k.label).sort(), ["one", "two"]);
  assert.equal(listKnits(store, project.id).find((k) => k.id === b.id).folder, "Spring/Week 1");
});

test("what a model files is in the activity, so a person can see it; their own sorting is not", () => {
  const { store, project } = fresh();
  const p = store.listPatterns(project.id)[0];
  moveToFolder(store, project.id, "patterns", [p.id], "By hand");
  createFolder(store, project.id, "patterns", "Also by hand");
  assert.equal(store.activity(project.id).filter((a) => a.action.startsWith("folder.")).length, 0);
  moveToFolder(store, project.id, "patterns", [p.id], "By the model", "model");
  renameFolder(store, project.id, "patterns", "By the model", "Model drafts", "model");
  const said = store.activity(project.id).filter((a) => a.action.startsWith("folder.")).map((a) => `${a.action}: ${a.subject}`);
  assert.deepEqual(said, ["folder.renamed: By the model to Model drafts", "folder.filed: 1 pattern into By the model"]);
});
