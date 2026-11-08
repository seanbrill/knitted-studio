import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConflictError, NotFoundError, ValidationError, openStore, openDb, currentVersion, migrate } from "../src/node.ts";
import { MIGRATIONS } from "../src/migrations.ts";
import { DatabaseSync } from "node:sqlite";

const tmp = () => mkdtempSync(join(tmpdir(), "knitted-core-"));
const fresh = () => { const d = tmp(); return { dir: d, store: openStore(join(d, "k.db")) }; };

test("a new library opens at the latest schema", () => {
  const { dir } = fresh();
  const db = openDb(join(dir, "again.db"));
  assert.equal(currentVersion(db), MIGRATIONS.at(-1).version);
});

test("reopening is idempotent", () => {
  const dir = tmp();
  const f = join(dir, "k.db");
  openDb(f); const db2 = openDb(f);
  assert.equal(currentVersion(db2), MIGRATIONS.at(-1).version);
});

test("a library from a NEWER app is refused, not silently downgraded", () => {
  const dir = tmp(); const f = join(dir, "k.db");
  const raw = new DatabaseSync(f); raw.exec("pragma user_version = 999"); raw.close();
  assert.throws(() => openDb(f), /newer knitted/);
});

test("a failing migration rolls back and leaves the version alone", () => {
  const db = new DatabaseSync(":memory:");
  const bad = [{ version: 1, name: "ok", sql: "create table a (x)" }, { version: 2, name: "bad", sql: "create table b (x); this is not sql" }];
  assert.throws(() => migrate(db, bad), /migration 2/);
  assert.equal(currentVersion(db), 1);
  assert.equal(db.prepare("select 1 from sqlite_master where name = 'b'").get(), undefined, "partial migration must not persist");
});

test("projects: create, rename, describe", () => {
  const { store } = fresh();
  const p = store.createProject({ name: "  Launch   week ", starter: "social" });
  assert.equal(p.name, "Launch week");
  assert.equal(store.listPatterns(p.id).length, 5, "the social pack has five sizes");
  assert.equal(store.updateProject(p.id, { name: "Renamed" }).name, "Renamed");
  assert.throws(() => store.createProject({ name: "   " }), ValidationError);
  assert.throws(() => store.createProject({ name: "x".repeat(121) }), /too long/);
});

test("the social starter's headline is free and its brand parts are locked", () => {
  const { store } = fresh();
  const p = store.createProject({ name: "P", starter: "social" });
  const story = store.listPatterns(p.id)[0];
  assert.equal(story.stitches.find((s) => s.slot === "headline").locked, false);
  assert.equal(story.stitches.find((s) => s.slot === "logo").locked, true);
});

test("duplicating a project makes independent copies", () => {
  const { store } = fresh();
  const p = store.createProject({ name: "Orig", starter: "social" });
  const copy = store.duplicateProject(p.id);
  const [orig] = store.listPatterns(p.id);
  store.apply(orig.id, { type: "fillSlot", slot: "headline", content: "Changed" }, "human");
  const [dup] = store.listPatterns(copy.id);
  assert.notEqual(dup.stitches.find((s) => s.slot === "headline").content, "Changed");
  assert.notEqual(dup.id, orig.id);
});

test("archive hides a project from the main list and restore brings it back", () => {
  const { store } = fresh();
  const p = store.createProject({ name: "A" });
  store.archiveProject(p.id);
  assert.equal(store.listProjects().length, 0);
  assert.equal(store.listProjects({ archived: true }).length, 1);
  store.restoreProject(p.id);
  assert.equal(store.listProjects().length, 1);
});

test("delete is undoable until purged, and purge removes the files too", () => {
  const { store } = fresh();
  const p = store.createProject({ name: "Doomed" });
  mkdirSync(store.paths.yarnDir(p.id), { recursive: true });
  writeFileSync(join(store.paths.yarnDir(p.id), "a.txt"), "x");
  store.deleteProject(p.id);
  assert.equal(store.listProjects().length, 0);
  store.undeleteProject(p.id);
  assert.equal(store.listProjects().length, 1, "undo restores it");
  store.deleteProject(p.id);
  assert.equal(store.purgeDeleted(60_000), 0, "recent deletes are not purged");
  assert.equal(store.purgeDeleted(-1), 1);
  assert.throws(() => store.getProject(p.id), NotFoundError);
  assert.equal(existsSync(store.paths.projectDir(p.id)), false, "the files are gone");
});

test("apply records history, bumps the version, and a stale write is a conflict", () => {
  const { store } = fresh();
  const p = store.createProject({ name: "P", starter: "social" });
  const pat = store.listPatterns(p.id)[0];
  const r = store.apply(pat.id, { type: "fillSlot", slot: "headline", content: "One" }, "human", { expectVersion: pat.version });
  assert.equal(r.pattern.version, pat.version + 1);
  assert.throws(() => store.apply(pat.id, { type: "fillSlot", slot: "headline", content: "Two" }, "human", { expectVersion: pat.version }), ConflictError);
  assert.equal(store.getPattern(pat.id).stitches.find((s) => s.slot === "headline").content, "One", "the stale write changed nothing");
});

test("a model's refusal changes nothing, is returned, and is logged", () => {
  const { store } = fresh();
  const p = store.createProject({ name: "P", starter: "social" });
  const pat = store.listPatterns(p.id)[0];
  const before = pat.version;
  const r = store.apply(pat.id, { type: "fillSlot", slot: "eyebrow", content: "hijack" }, "model");
  assert.equal(r.changed, false);
  assert.equal(r.refusals.length, 1);
  assert.equal(store.getPattern(pat.id).version, before, "version untouched");
  const log = store.activity(p.id);
  assert.ok(log.some((a) => a.action === "edit.refused" && a.actor === "model"), "refusal is in the audit trail");
});

test("rapid human edits coalesce into one revision; a model edit never merges into them", () => {
  const { store } = fresh();
  const p = store.createProject({ name: "P", starter: "social" });
  const pat = store.listPatterns(p.id)[0];
  const stitch = pat.stitches.find((s) => s.slot === "headline");
  const start = store.revisions(pat.id).length;
  for (let i = 1; i <= 10; i++) store.apply(pat.id, { type: "updateStitch", id: stitch.id, patch: { x: i / 100 } }, "human", { coalesce: true, label: "move" });
  assert.equal(store.revisions(pat.id).length, start + 1, "a drag is one revision");
  store.apply(pat.id, { type: "fillSlot", slot: "headline", content: "from model" }, "model");
  assert.equal(store.revisions(pat.id).length, start + 2);
  assert.equal(store.revisions(pat.id)[0].author, "model");
});

test("restoring a revision brings the old content back and is itself recorded", () => {
  const { store } = fresh();
  const p = store.createProject({ name: "P", starter: "social" });
  const pat = store.listPatterns(p.id)[0];
  store.apply(pat.id, { type: "fillSlot", slot: "headline", content: "Changed" }, "human");
  const created = store.revisions(pat.id).find((r) => r.label === "Created");
  const restored = store.restoreRevision(pat.id, created.id);
  assert.equal(restored.stitches.find((s) => s.slot === "headline").content, "Make it knitted.");
  assert.equal(store.revisions(pat.id)[0].label, "Restored");
});

test("the change counter moves on every write, so other processes can notice", () => {
  const { store } = fresh();
  const r0 = store.rev();
  store.createProject({ name: "P" });
  assert.ok(store.rev() > r0);
});

test("the example project seeds exactly once", () => {
  const { store } = fresh();
  assert.ok(store.ensureExample());
  assert.equal(store.ensureExample(), null);
  assert.equal(store.listProjects().filter((p) => p.example).length, 1);
});

test("jobs: a job left running by a dead process becomes interrupted", () => {
  const { store } = fresh();
  const j = store.createJob("knit", null, { a: 1 });
  store.updateJob(j.id, { status: "running" });
  assert.equal(store.interruptStaleJobs(), 1);
  assert.equal(store.getJob(j.id).status, "interrupted");
  assert.ok(store.getJob(j.id).finishedAt);
});

test("two PROCESSES writing the same pattern lose no writes", async () => {
  const { dir, store } = fresh();
  const p = store.createProject({ name: "Race", starter: "social" });
  const pat = store.listPatterns(p.id)[0];
  const a = pat.stitches.find((s) => s.slot === "headline");
  const b = pat.stitches.find((s) => s.slot === "backdrop");
  const file = join(dir, "k.db");
  const run = (stitch) => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [fileURLToPath(new URL("./fixtures/writer.mjs", import.meta.url)), file, pat.id, stitch.id, "100"], { stdio: ["ignore", "pipe", "pipe"] });
    let err = ""; c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err))));
  });
  await Promise.all([run(a), run(b)]);
  const final = store.getPattern(pat.id);
  assert.equal(final.version, pat.version + 200, "every one of the 200 writes landed");
  assert.equal(final.stitches.find((s) => s.id === a.id).x, 0.1);
  assert.equal(final.stitches.find((s) => s.id === b.id).x, 0.1);
});
