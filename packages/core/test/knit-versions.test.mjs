// A knit is one pattern at one size. Knitted again after a change, it has a new version, and
// the same version as another file type or at 2x is a format of it. Knits shows each knit once:
// the grid had filled with every slide five times over, and a video at 1x and again at 2x.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  aspectOf, backfillKnitVersions, chooseKnit, countKnits, deleteKnitFiles, folderCounts, getKnit, insertKnit, knitPath, knitVersions,
  legacyUnit, listKnits, migrate, moveToFolder, openStore, setKnitFavorite, setKnitPost, setKnitTags, unitKey, unseenKnits, versionsOf, withVersions,
} from "../src/node.ts";
import { MIGRATIONS } from "../src/migrations.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "knitted-versions-"));

/** A file of the Hook slide in Post: `look` is its version, `format` and `scale` which file of it. */
function file(store, projectId, { look, format = "png", scale = 1, unit = unitKey("pt_hook", "Hook", "Post", 1080, 1350, null), label = "Hook · Post" }) {
  const k = insertKnit(store, { projectId, patternId: "pt_hook", patternName: "Hook", jobId: null, batchId: null, label, file: `day/${look}-${format}-${scale}.${format}`, kind: "image", format, width: 1080 * scale, height: 1350 * scale, bytes: 1000 * scale, durationMs: null, hash: `${look}-${format}-${scale}`, report: {}, unit, look, scale });
  mkdirSync(join(store.paths.outDir(projectId), "day"), { recursive: true });
  writeFileSync(knitPath(store, k), "x");
  return k;
}

test("a shape in its lowest terms, and which knit a file is", () => {
  assert.equal(aspectOf(1080, 1350), "4:5");
  assert.equal(aspectOf(2160, 2700), "4:5");
  assert.equal(unitKey("pt_1", "Hook", "Post", 1080, 1350, null), "pt_1|Post|4:5|");
  assert.equal(legacyUnit({ patternId: "pt_1", patternName: "Zero to deployed 1/5 · Hook", label: "Zero to deployed 1/5 · Hook · Post", width: 2160, height: 2700 }), "pt_1|Post|4:5|", "a pattern's name with a dot in it");
  assert.equal(legacyUnit({ patternId: "pt_1", patternName: "Menu", label: "Menu · Square · #3 Pancakes · with jam", width: 1080, height: 1080 }), "pt_1|Square|1:1|3", "a row of a batch");
});

test("the current version is the one made or picked last, and it shows the file picked in it, or else its first", () => {
  const at = (m) => `2026-11-09T10:0${m}:00.000Z`;
  const rows = [
    { id: "a", look: "v1", createdAt: at(1), chosenAt: null },
    { id: "b", look: "v2", createdAt: at(2), chosenAt: null },
    { id: "c", look: "v2", createdAt: at(3), chosenAt: null },
  ];
  let r = versionsOf(rows);
  assert.deepEqual([r.versions.length, r.current.no, r.head.id], [2, 2, "b"], "a second format of version 2 does not take the first's place");
  r = versionsOf([...rows.slice(0, 2), { ...rows[2], chosenAt: at(4) }]);
  assert.equal(r.head.id, "c", "the format picked is shown");
  r = versionsOf([{ ...rows[0], chosenAt: at(5) }, ...rows.slice(1)]);
  assert.deepEqual([r.current.no, r.head.id], [1, "a"], "version 1 picked again is current");
});

test("Knits shows each knit once; a new version takes its place, filed where it was, with its tags, caption and star", () => {
  const store = openStore(join(tmp(), "k.db"));
  const p = store.createProject({ name: "Versions", starter: "blank" });
  const v1 = file(store, p.id, { look: "one" });
  moveToFolder(store, p.id, "knits", [v1.id], "Carousels");
  setKnitTags(store, v1.id, ["launch"]);
  setKnitPost(store, v1.id, { caption: "Ship it.", hashtags: ["#ship"], by: "model" });
  setKnitFavorite(store, [v1.id], true);

  const v2 = file(store, p.id, { look: "two" });
  assert.deepEqual([v2.folder, v2.tags, v2.post.caption, v2.favorite, v2.seenAt], ["Carousels", ["launch"], "Ship it.", true, null]);
  assert.deepEqual(listKnits(store, p.id).map((k) => k.id), [v2.id], "one knit, at its newest version");
  assert.equal(listKnits(store, p.id, { every: true }).length, 2);
  assert.equal(countKnits(store, p.id), 1);
  assert.equal(countKnits(store, p.id, { every: true }), 2);
  assert.equal(store.listProjects().find((x) => x.id === p.id).counts.knits, 1, "the project's card counts it once");
  assert.equal(folderCounts(store, p.id, "knits").get("Carousels"), 1);
  assert.equal(unseenKnits(store, p.id), 1, "a new version is new");

  const twoX = file(store, p.id, { look: "two", scale: 2 });
  assert.deepEqual(listKnits(store, p.id).map((k) => k.id), [v2.id], "the 2x is a format of it, not another knit");
  const [shown] = withVersions(store, listKnits(store, p.id));
  assert.deepEqual([shown.versions, shown.versionNo, shown.formats.map((f) => f.id)], [2, 2, [v2.id, twoX.id]]);
});

test("picking an earlier version, or another format, shows it; a knit's caption, tags, folder and star are the whole knit's", () => {
  const store = openStore(join(tmp(), "k.db"));
  const p = store.createProject({ name: "Pick", starter: "blank" });
  const v1 = file(store, p.id, { look: "one" });
  const v2 = file(store, p.id, { look: "two" });
  const v2x = file(store, p.id, { look: "two", scale: 2 });

  chooseKnit(store, v1.id);
  assert.deepEqual(listKnits(store, p.id).map((k) => k.id), [v1.id], "version 1 is current again");
  let v = knitVersions(store, v2.id);
  assert.deepEqual([v.current, v.versions.map((x) => x.files.length), v.size], [1, [1, 2], { name: "Post", w: 1080, h: 1350 }]);

  chooseKnit(store, v2x.id);
  assert.deepEqual(listKnits(store, p.id).map((k) => k.id), [v2x.id], "the 2x of version 2 is shown, and posted");
  v = knitVersions(store, v1.id);
  assert.deepEqual([v.current, v.versions[1].files[0].id], [2, v2x.id]);

  setKnitPost(store, v1.id, { caption: "First words", by: "human" });
  setKnitPost(store, v2x.id, { caption: "Second words", by: "model", ask: "shorter" });
  for (const k of [v1, v2, v2x]) assert.equal(getKnit(store, k.id).post.caption, "Second words");
  assert.deepEqual(getKnit(store, v2.id).post.earlier.map((e) => e.caption), ["First words"], "the caption written over is kept");
  setKnitPost(store, v2.id, { caption: "First words", by: "human" });
  assert.deepEqual(getKnit(store, v2.id).post.earlier.map((e) => e.caption), ["Second words"], "going back does not keep it twice");

  moveToFolder(store, p.id, "knits", [v2x.id], "Done");
  assert.deepEqual([v1, v2, v2x].map((k) => getKnit(store, k.id).folder), ["Done", "Done", "Done"]);
  assert.equal(setKnitFavorite(store, [v2.id], true), 1, "a star counts once");
  assert.ok([v1, v2, v2x].every((k) => getKnit(store, k.id).favorite));
});

test("deleting the earlier versions keeps the current one, and deleting the shown file shows the next", async () => {
  const store = openStore(join(tmp(), "k.db"));
  const p = store.createProject({ name: "Delete", starter: "blank" });
  const v1 = file(store, p.id, { look: "one" });
  const v2 = file(store, p.id, { look: "two" });
  const v3 = file(store, p.id, { look: "three" });
  const v3x = file(store, p.id, { look: "three", scale: 2 });

  assert.deepEqual(await deleteKnitFiles(store, v3.id, "earlier"), { deleted: 2, bytes: 2000 });
  assert.ok(!existsSync(knitPath(store, v1)) && !existsSync(knitPath(store, v2)), "their files are gone");
  assert.deepEqual(listKnits(store, p.id, { every: true }).map((k) => k.id).sort(), [v3.id, v3x.id].sort());

  await deleteKnitFiles(store, v3.id, "file");
  assert.deepEqual(listKnits(store, p.id).map((k) => k.id), [v3x.id], "the 2x is shown now");
  assert.deepEqual(await deleteKnitFiles(store, v3x.id, "all"), { deleted: 1, bytes: 2000 });
  assert.equal(countKnits(store, p.id, { every: true }), 0);
});

test("knits made before versions are sorted into them once: by the pattern's saves, then by type and scale", () => {
  const dir = tmp(), dbFile = join(dir, "old.db");
  const old = new DatabaseSync(dbFile);
  migrate(old, MIGRATIONS.filter((m) => m.version <= 19));
  const row = (id, label, w, h, format, hash, at, pattern = "pt_a", name = "Shard") => old.prepare("insert into knits (id, project_id, pattern_id, pattern_name, label, file, kind, format, width, height, bytes, hash, report, created_at, folder) values (?, 'pj_old', ?, ?, ?, ?, 'image', ?, ?, ?, 1, ?, '{}', ?, ?)").run(id, pattern, name, label, `${id}.${format}`, format, w, h, hash, at, id === "kn_1x" ? "zz - old" : "Story");
  old.exec(`insert into projects (id, name, created_at, updated_at) values ('pj_old', 'Old', 't', 't');
    insert into patterns (id, project_id, name, size, doc, created_at, updated_at) values ('pt_a', 'pj_old', 'Shard', '{}', '{}', 't', 't');`);
  const rev = (at) => old.prepare("insert into pattern_revisions (id, pattern_id, snapshot, author, created_at) values (?, 'pt_a', '{}', 'human', ?)").run(`rv_${at}`, at);
  rev("2026-11-01T00:00:00.000Z");
  row("kn_old", "Shard · Story", 1080, 1920, "png", "h0", "2026-11-02T00:00:00.000Z");
  rev("2026-11-03T00:00:00.000Z");
  row("kn_1x", "Shard · Story", 1080, 1920, "png", "h1", "2026-11-04T00:00:00.000Z");
  row("kn_2x", "Shard · Story", 2160, 3840, "png", "h2", "2026-11-04T00:01:00.000Z");
  // The swatch changed, and the pattern did not: the same type and scale, but not the same picture.
  row("kn_new", "Shard · Story", 1080, 1920, "png", "h3", "2026-11-05T00:00:00.000Z");
  row("kn_sq", "Shard · Square", 1080, 1080, "png", "h4", "2026-11-05T00:00:00.000Z");
  old.close();

  const store = openStore(dbFile);
  assert.equal(backfillKnitVersions(store), 0, "once");
  const v = knitVersions(store, "kn_1x");
  assert.deepEqual(v.versions.map((x) => x.files.map((f) => f.id)), [["kn_old"], ["kn_2x", "kn_1x"], ["kn_new"]], "the 1x and 2x made together are one version, the last made shown");
  assert.deepEqual([getKnit(store, "kn_2x").scale, getKnit(store, "kn_1x").scale], [2, 1]);
  assert.deepEqual(listKnits(store, "pj_old").map((k) => k.id).sort(), ["kn_new", "kn_sq"], "two knits: the Story and the Square");
});
