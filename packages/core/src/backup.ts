// Backups of the library database.
//
// `VACUUM INTO` writes a complete, consistent copy while the app is running (a plain
// file copy of a WAL database can miss recent writes). Backups live beside the
// library, not in it, so a "delete the library" never takes its own safety net along.
//
//   before a migration that will change the file      kept, labelled with the version
//   once a day, on first start                        the newest 7 kept
//   on demand, from Settings                          kept like the daily ones

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Db } from "./db.ts";

export interface BackupInfo { file: string; name: string; bytes: number; createdAt: string; kind: "daily" | "manual" | "pre-migration" }

export const backupsDir = (root: string) => join(root, "..", `${basename(root)}-backups`);
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

export function backupNow(db: Db, root: string, kind: BackupInfo["kind"], label = ""): BackupInfo {
  const dir = backupsDir(root);
  mkdirSync(dir, { recursive: true });
  const name = `${kind}${label ? `-${label}` : ""}-${stamp()}.db`;
  const file = join(dir, name);
  db.exec(`vacuum into '${file.replace(/'/g, "''")}'`);
  return info(file);
}

function info(file: string): BackupInfo {
  const st = statSync(file);
  const name = basename(file);
  return { file, name, bytes: st.size, createdAt: st.mtime.toISOString(), kind: name.startsWith("pre-migration") ? "pre-migration" : name.startsWith("manual") ? "manual" : "daily" };
}

export function listBackups(root: string): BackupInfo[] {
  const dir = backupsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".db")).map((f) => info(join(dir, f))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** One backup per calendar day, and only the newest `keep` automatic ones are kept. */
export function dailyBackup(db: Db, root: string, keep = 7): BackupInfo | null {
  const today = new Date().toISOString().slice(0, 10);
  const have = listBackups(root);
  let made: BackupInfo | null = null;
  if (!have.some((b) => b.kind === "daily" && b.createdAt.startsWith(today))) made = backupNow(db, root, "daily");
  const auto = listBackups(root).filter((b) => b.kind === "daily");
  for (const old of auto.slice(keep)) rmSync(old.file, { force: true });
  return made;
}

/** `pragma quick_check`: cheap, and catches a damaged file before it damages anything else. */
export function isHealthy(db: Db): boolean {
  try { return (db.prepare("pragma quick_check").get() as { quick_check: string }).quick_check === "ok"; } catch { return false; }
}

/** Replace the library file with a backup. The current file is set aside, never deleted. Run with the app closed. */
export function restoreBackup(dbFile: string, backupFile: string): string {
  const aside = `${dbFile}.before-restore-${stamp()}`;
  if (existsSync(dbFile)) copyFileSync(dbFile, aside);
  for (const ext of ["-wal", "-shm"]) rmSync(dbFile + ext, { force: true });
  mkdirSync(dirname(dbFile), { recursive: true });
  copyFileSync(backupFile, dbFile);
  return aside;
}
