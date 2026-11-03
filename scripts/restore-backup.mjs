#!/usr/bin/env node
// Put a database backup back. Close knitted first.
//   node scripts/restore-backup.mjs                 list the backups
//   node scripts/restore-backup.mjs <backup name>   restore it (the current file is set aside, never deleted)
const { listBackups, paths, restoreBackup, backupsDir } = await import("@knitted/core/node");
const p = paths();
const all = listBackups(p.root);
const name = process.argv[2];
if (!name) {
  console.log(`Backups in ${backupsDir(p.root)}:`);
  for (const b of all) console.log(`  ${b.name}   ${b.createdAt}`);
  if (!all.length) console.log("  none yet");
  process.exit(0);
}
const b = all.find((x) => x.name === name);
if (!b) { console.error(`No backup called ${name}. Run without arguments to list them.`); process.exit(1); }
const aside = restoreBackup(p.db, b.file);
console.log(`Restored ${b.name}.\nYour previous library file is kept at ${aside}`);
