// A knit nobody has looked at yet says so, until it is opened, downloaded or marked seen.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getKnit, insertKnit, markAllKnitsSeen, markKnitsSeen, migrate, openStore, unseenKnits } from "../src/node.ts";
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
