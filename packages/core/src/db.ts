// Opening the database. `node:sqlite` is built into Node 22.13+ and Electron,
// so there is no native module to rebuild per platform (decided in Phase 0).
//
// Several processes share one file: the studio server, the MCP server and the
// render worker. WAL lets them read while one writes, and busy_timeout makes a
// competing writer wait its turn instead of failing.

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { MIGRATIONS } from "./migrations.ts";
import { backupNow, isHealthy } from "./backup.ts";

export type Db = DatabaseSync;

export function openDb(file: string): Db {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const existed = file !== ":memory:" && existsSync(file) && statSync(file).size > 0;
  const db = new DatabaseSync(file);
  db.exec("pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 8000; pragma synchronous = normal;");
  if (existed && !isHealthy(db)) {
    db.close();
    throw new Error("The library file is damaged and was not opened, so nothing more is written to it. Restore the latest backup from Settings, Storage, or see docs/INSTALL.md.");
  }
  // A migration changes the file for good, and an older app cannot read it afterwards: keep the way back.
  const latest = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
  const have = currentVersion(db);
  if (existed && have > 0 && have < latest) backupNow(db, dirname(file), "pre-migration", `v${have}`);
  migrate(db);
  return db;
}

export function currentVersion(db: Db): number {
  return (db.prepare("pragma user_version").get() as { user_version: number }).user_version;
}

/** Apply anything newer than the file's version. Refuses a database from the future. */
export function migrate(db: Db, migrations = MIGRATIONS): number {
  const latest = migrations[migrations.length - 1]?.version ?? 0;
  const have = currentVersion(db);
  if (have > latest) {
    throw new Error(`This library was made by a newer knitted (schema ${have}, this app knows ${latest}). Update the app to open it.`);
  }
  for (const m of migrations) {
    if (m.version <= have) continue;
    db.exec("begin immediate");
    try {
      db.exec(m.sql);
      db.exec(`pragma user_version = ${m.version}`);
      db.exec("commit");
    } catch (e) {
      db.exec("rollback");
      throw new Error(`migration ${m.version} (${m.name}) failed: ${(e as Error).message}`);
    }
  }
  return latest;
}

/** Run `fn` in one transaction that takes the write lock up front, so read-modify-write cannot interleave across processes. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec("begin immediate");
  try {
    const out = fn();
    db.exec("commit");
    return out;
  } catch (e) {
    db.exec("rollback");
    throw e;
  }
}
