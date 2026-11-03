#!/usr/bin/env node
// Move notch.fm's media library into knitted as Yarn in a project.
//
//   node scripts/migrate-notch.mjs [--from <tools/media>] [--home <library>]            dry run: prints the plan, changes nothing
//   node scripts/migrate-notch.mjs --apply [--skip-loose] [--from ..] [--home ..]       copies the files in
//
// This is a COPY. The source is opened read-only and never written, moved or deleted;
// every file is copied to a temporary name inside the knitted library first, and only that
// copy is handed to importYarn (which moves it). Identical files are stored once.
//
// The 67 or so loose files at the top of assets/ are the likeliest to not need carrying
// over. They are listed as their own group so a person can decide; `--skip-loose` leaves them.

import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, relative, resolve } from "node:path";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const apply = flag("--apply");
const skipLoose = flag("--skip-loose");
const from = resolve(opt("--from", join(homedir(), "source/notch.fm/tools/media")));
const assets = join(from, "assets");
const PROJECT = opt("--project", "notch.fm");
if (opt("--home")) process.env.KNITTED_HOME = resolve(opt("--home"));

const GROUPS = { videos: "videos", audio: "audio", memes: "memes", TTS: "tts", screens: "screens" };
const mb = (n) => `${(n / 1024 ** 2).toFixed(1)} MB`;

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink() || e.name.startsWith(".")) continue;       // never follow links out of the folder
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const plan = [];
for (const file of await walk(assets)) {
  const rel = relative(assets, file);
  const top = rel.split(/[\\/]/)[0];
  const group = rel.includes("/") || rel.includes("\\") ? (GROUPS[top] ?? top.toLowerCase()) : "loose";
  plan.push({ file, rel, group, bytes: (await stat(file)).size, ext: extname(file).toLowerCase() });
}

// Types knitted can hold. Anything else is reported, not guessed at.
const { importYarn, getStore, uploadTempPath } = await import("@knitted/core/node");
const SUPPORTED = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg", ".mp4", ".mov", ".webm", ".mp3", ".wav", ".m4a", ".ogg", ".ttf", ".otf", ".woff", ".woff2", ".txt", ".md"]);
const unsupported = plan.filter((p) => !SUPPORTED.has(p.ext));
const todo = plan.filter((p) => SUPPORTED.has(p.ext) && !(skipLoose && p.group === "loose"));

console.log(`${apply ? "APPLYING" : "DRY RUN (nothing will change)"}\nsource  ${assets}`);
const byGroup = {};
for (const p of plan) {
  const g = (byGroup[p.group] ??= { n: 0, bytes: 0 });
  g.n++; g.bytes += p.bytes;
}
for (const [g, v] of Object.entries(byGroup).sort()) console.log(`  ${g.padEnd(10)} ${String(v.n).padStart(4)} files  ${mb(v.bytes)}${g === "loose" ? (skipLoose ? "   (skipped)" : "   <- decide on these first") : ""}`);
if (unsupported.length) console.log(`\nNot importable (${unsupported.length}): ${unsupported.map((p) => p.rel).join(", ")}`);
console.log(`\nWould import ${todo.length} files into a project named "${PROJECT}", tagged by group.`);
if (!apply) { console.log("Run again with --apply to do it. The source is never modified."); process.exit(0); }

const store = getStore();
const project = store.listProjects().find((p) => p.name === PROJECT) ?? store.createProject({ name: PROJECT, description: "Imported from notch.fm tools/media." });
const idMap = {}; let added = 0, same = 0; const failed = [];
for (const p of todo) {
  try {
    const tmp = uploadTempPath(store, project.id);
    await mkdir(join(tmp, ".."), { recursive: true });
    await copyFile(p.file, tmp);
    const r = await importYarn(store, project.id, tmp, basename(p.file), { tags: [p.group, "notch.fm"], actor: "import" });
    idMap[p.rel] = r.yarn.id; if (r.existing) same++; else added++;
  } catch (e) { failed.push({ file: p.rel, why: e.message }); }
}
const mapFile = join(store.paths.root, `notch-id-map.json`);
await writeFile(mapFile, JSON.stringify({ from: assets, project: project.id, map: idMap, failed }, null, 2));
console.log(`\nImported ${added}, already present ${same}, failed ${failed.length}.\nOld path to Yarn id map: ${mapFile}`);
for (const f of failed) console.log(`  failed ${f.file}: ${f.why}`);
process.exit(failed.length ? 1 : 0);
