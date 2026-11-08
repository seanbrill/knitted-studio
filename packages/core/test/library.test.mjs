import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { LIBRARY_ID } from "../src/index.ts";
import { deleteYarn, importYarn, listYarn, openStore, setYarnScope, uploadTempPath, yarnPath, yarnThumbPath, yarnUsage } from "../src/node.ts";

const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-library-")), "k.db"));
const a = store.createProject({ name: "Bakery" });
const b = store.createProject({ name: "Florist" });

async function imp(projectId, name, color, opts) {
  const tmp = uploadTempPath(store, projectId);
  mkdirSync(join(tmp, ".."), { recursive: true });
  writeFileSync(tmp, await sharp({ create: { width: 40, height: 30, channels: 3, background: color } }).png().toBuffer());
  return (await importYarn(store, projectId, tmp, name, opts)).yarn;
}
const ids = (list) => list.map((y) => y.id);

test("the Library is never listed as a project", () => {
  assert.equal(store.getProject(LIBRARY_ID).name, "Library");
  assert.equal(store.listProjects().some((p) => p.id === LIBRARY_ID), false);
});

test("a Library file is in every project's Yarn, after the project's own, and not on its own page", async () => {
  const own = await imp(a.id, "Our loaf.png", { r: 200, g: 120, b: 40 });
  const shared = await imp(LIBRARY_ID, "Logo everywhere.png", { r: 10, g: 20, b: 200 });
  assert.deepEqual(ids(listYarn(store, a.id)), [own.id, shared.id], "own first, then the Library's");
  assert.deepEqual(ids(listYarn(store, b.id)), [shared.id]);
  assert.deepEqual(ids(listYarn(store, a.id, { library: false })), [own.id], "the project's own page shows its own");
  assert.deepEqual(ids(listYarn(store, a.id, { shelf: "reference" })), [], "the reference is a project's alone");
  assert.deepEqual(ids(listYarn(store, LIBRARY_ID)), [shared.id]);
});

test("moving a file to the Library keeps its id, its file and its thumbnail, so patterns keep it", async () => {
  const y = await imp(a.id, "Shop front.png", { r: 90, g: 200, b: 90 }, { folder: "Photos" });
  const p = store.createPattern(a.id, { name: "Uses the front" });
  store.apply(p.id, { type: "addStitch", stitch: { id: "img", kind: "image", x: 0, y: 0, w: 1, h: 1, locked: false, yarnId: y.id } }, "human");
  const before = [yarnPath(store, y), yarnThumbPath(store, y)];
  const moved = await setYarnScope(store, y.id, LIBRARY_ID);
  assert.equal(moved.id, y.id);
  assert.equal(moved.projectId, LIBRARY_ID);
  assert.equal(moved.folder, "Photos", "its folder comes too, by name");
  assert.ok(existsSync(yarnPath(store, moved)) && existsSync(yarnThumbPath(store, moved)), "the file and its thumbnail are in the Library");
  assert.ok(before.every((f) => !existsSync(f)), "and not left behind");
  assert.deepEqual(yarnUsage(store, y.id).map((u) => u.patternId), [p.id], "a Library file's use is looked for in every project");
  assert.ok(listYarn(store, b.id).some((x) => x.id === y.id), "the other project has it now");
});

test("out of the Library only into a project that is the only one using it; the same file twice is refused", async () => {
  const y = await imp(LIBRARY_ID, "Badge.png", { r: 250, g: 250, b: 10 });
  const p = store.createPattern(b.id, { name: "Florist badge" });
  store.apply(p.id, { type: "addStitch", stitch: { id: "img", kind: "image", x: 0, y: 0, w: 1, h: 1, locked: false, yarnId: y.id } }, "human");
  await assert.rejects(setYarnScope(store, y.id, a.id), /used in 1 pattern in Florist/);
  const back = await setYarnScope(store, y.id, b.id);
  assert.equal(back.projectId, b.id);
  assert.ok(existsSync(yarnPath(store, back)));
  const twin = await imp(LIBRARY_ID, "Badge again.png", { r: 250, g: 250, b: 10 });
  await assert.rejects(setYarnScope(store, back.id, LIBRARY_ID), /already has this file, as Badge again/);
  await assert.rejects(setYarnScope(store, twin.id, "nope"), /not here/);
  deleteYarn(store, twin.id);
  await assert.rejects(setYarnScope(store, twin.id, a.id), /deleted/);
});
