import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../src/db.ts";
import { MIGRATIONS } from "../src/migrations.ts";
import { backupNow, dailyBackup, isHealthy, listBackups, restoreBackup } from "../src/backup.ts";

const fresh = () => { const root = join(mkdtempSync(join(tmpdir(), "kb-")), "lib"); return { root, file: join(root, "knitted.db") }; };

test("a backup is a complete, openable copy, kept beside the library", () => {
  const { root, file } = fresh();
  const db = openDb(file);
  db.exec("create table marker(x); insert into marker values (7)");
  const b = backupNow(db, root, "manual");
  assert.ok(!b.file.startsWith(root + "/"), "not inside the library it protects");
  const copy = new DatabaseSync(b.file);
  assert.equal(copy.prepare("select x from marker").get().x, 7);
});

test("one automatic backup per day, and only the newest seven are kept", () => {
  const { root, file } = fresh();
  const db = openDb(file);
  assert.ok(dailyBackup(db, root));
  assert.equal(dailyBackup(db, root), null, "second start the same day makes none");
  assert.equal(listBackups(root).length, 1);
});

test("a damaged library is refused with a plain message, and not written to", () => {
  const { file } = fresh();
  const db = openDb(file); db.exec("create table t(x blob)"); const ins = db.prepare("insert into t values (?)"); for (let i = 0; i < 400; i++) ins.run(Buffer.alloc(800, i % 250)); db.exec("pragma wal_checkpoint(truncate)"); db.close();
  const bytes = readFileSync(file);
  const bad = Buffer.from(bytes); for (let i = 4096; i < Math.min(bad.length, 4096 * 3); i++) bad[i] = 0xff;
  writeFileSync(file, bad);
  assert.throws(() => openDb(file), /damaged and was not opened/);
});

test("the health check itself can fail: it reports a broken file as unhealthy", () => {
  const { file } = fresh();
  const db = openDb(file); db.exec("create table t(x blob)"); const ins = db.prepare("insert into t values (?)"); for (let i = 0; i < 400; i++) ins.run(Buffer.alloc(800, 7));
  assert.equal(isHealthy(db), true); db.exec("pragma wal_checkpoint(truncate)"); db.close();
  const bad = readFileSync(file); for (let i = 4096; i < 4096 * 4; i++) bad[i] = 0xff; writeFileSync(file, bad);
  assert.equal(isHealthy(new DatabaseSync(file)), false);
});

test("restoring sets the current file aside instead of deleting it", () => {
  const { root, file } = fresh();
  const db = openDb(file);
  db.exec("create table t(x); insert into t values (1)");
  const b = backupNow(db, root, "manual");
  db.exec("insert into t values (2)"); db.close();
  const aside = restoreBackup(file, b.file);
  assert.ok(existsSync(aside), "the newer file is still there");
  assert.equal(new DatabaseSync(file).prepare("select count(*) c from t").get().c, 1);
});

test("a migration that will change the file leaves a labelled backup first", () => {
  const { root, file } = fresh();
  mkdirSync(root, { recursive: true }); const old = new DatabaseSync(file); old.exec(MIGRATIONS[0].sql); old.exec(`pragma user_version = ${MIGRATIONS[0].version}`); old.close();
  openDb(file);
  assert.ok(listBackups(root).some((b) => b.kind === "pre-migration" && b.name.includes(`v${MIGRATIONS[0].version}`)));
});
