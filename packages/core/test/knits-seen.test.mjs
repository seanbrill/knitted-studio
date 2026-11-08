// A knit nobody has looked at yet says so, until it is opened, downloaded or marked seen. And
// the knits the person likes best are marked as favourites, to find again.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { countKnits, getKnit, insertKnit, listKnits, markAllKnitsSeen, markKnitsSeen, migrate, openStore, setKnitFavorite, unseenKnits } from "../src/node.ts";
import { MIGRATIONS } from "../src/migrations.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "knitted-seen-"));
const knit = (store, projectId, label) => insertKnit(store, { projectId, patternId: null, patternName: "P", jobId: null, batchId: null, label, file: `day/${label}.png`, kind: "image", format: "png", width: 10, height: 10, bytes: 1, durationMs: null, hash: label, report: {} });

test("what was knitted before the update counts as seen, so an update does not light up the library", () => {
  const file = join(tmp(), "old.db");
  const old = new DatabaseSync(file);
  migrate(old, MIGRATIONS.filter((m) => m.version <= 10));
  old.exec(`insert into projects (id, name, created_at, updated_at) values ('pj_old', 'Old', 't', 't');
    insert into knits (id, project_id, pattern_name, label, file, kind, format, width, height, bytes, hash, report, created_at) values ('kn_old', 'pj_old', 'P', 'Old', 'a.png', 'image', 'png', 1, 1, 1, 'h', '{}', '2026-01-01T00:00:00.000Z');`);
  old.close();
  const store = openStore(file);
  assert.equal(getKnit(store, "kn_old").seenAt, "2026-01-01T00:00:00.000Z");
  assert.equal(unseenKnits(store, "pj_old"), 0);
});

test("a new knit is unseen until it is looked at, and stays seen from the first time", () => {
  const store = openStore(join(tmp(), "k.db"));
  const p = store.createProject({ name: "Seen", starter: "blank" });
  const a = knit(store, p.id, "a"), b = knit(store, p.id, "b"), c = knit(store, p.id, "c");
  assert.equal(a.seenAt, null);
  assert.equal(unseenKnits(store, p.id), 3);
  assert.equal(store.listProjects().find((x) => x.id === p.id).counts.newKnits, 3, "the project's card counts them");

  assert.equal(markKnitsSeen(store, [a.id]), 1);
  const first = getKnit(store, a.id).seenAt;
  assert.ok(first);
  assert.equal(markKnitsSeen(store, [a.id]), 0, "seeing it again changes nothing");
  assert.equal(getKnit(store, a.id).seenAt, first);
  assert.equal(unseenKnits(store, p.id), 2);

  assert.equal(markAllKnitsSeen(store, p.id), 2);
  assert.ok(getKnit(store, b.id).seenAt && getKnit(store, c.id).seenAt);
  assert.equal(unseenKnits(store, p.id), 0);
  assert.equal(markKnitsSeen(store, []), 0);
});

test("a favourite is found with the filter, keeps when it was marked, and comes off again", () => {
  const store = openStore(join(tmp(), "k.db"));
  const p = store.createProject({ name: "Favourites", starter: "blank" });
  const a = knit(store, p.id, "a"), b = knit(store, p.id, "b"), c = knit(store, p.id, "c");
  assert.equal(a.favorite, false);
  assert.equal(setKnitFavorite(store, [a.id, c.id], true), 2);
  assert.equal(setKnitFavorite(store, [a.id], true), 0, "already a favourite");
  assert.deepEqual(listKnits(store, p.id, { favorite: true }).map((k) => k.label).sort(), ["a", "c"]);
  assert.equal(countKnits(store, p.id, { favorite: true }), 2);
  assert.equal(listKnits(store, p.id).length, 3, "without the filter, every knit");
  assert.equal(setKnitFavorite(store, [c.id, b.id], false), 1, "only c was one");
  assert.deepEqual(listKnits(store, p.id, { favorite: true }).map((k) => k.id), [a.id]);
  assert.throws(() => setKnitFavorite(store, ["kn_gone"], true), /not here any more/);
});

test("knits are found by type: pictures or videos, and by shape at any scale", () => {
  const store = openStore(join(tmp(), "k.db"));
  const p = store.createProject({ name: "Types", starter: "blank" });
  const make = (label, kind, width, height) => insertKnit(store, { projectId: p.id, patternId: null, patternName: "P", jobId: null, batchId: null, label, file: `day/${label}`, kind, format: kind === "video" ? "mp4" : "png", width, height, bytes: 1, durationMs: kind === "video" ? 1000 : null, hash: label, report: {} });
  make("reel", "video", 1080, 1920);
  make("story", "image", 540, 960);
  make("post", "image", 1080, 1350);
  make("youtube", "video", 3840, 2160);
  make("odd", "image", 1000, 300);
  const labels = (f) => listKnits(store, p.id, f).map((k) => k.label).sort();
  assert.deepEqual(labels({ kind: "video" }), ["reel", "youtube"]);
  assert.deepEqual(labels({ size: "Story" }), ["reel", "story"], "a Story at half size is still a Story");
  assert.deepEqual(labels({ size: "story", kind: "video" }), ["reel"], "a reel: a Story-shaped video");
  assert.deepEqual(labels({ size: "Landscape" }), ["youtube"]);
  assert.deepEqual(labels({ size: "Other" }), ["odd"]);
  assert.equal(countKnits(store, p.id, { kind: "image", size: "Post" }), 1);
  assert.throws(() => listKnits(store, p.id, { size: "Reel" }), /Use one of: Story, Post/);
});
