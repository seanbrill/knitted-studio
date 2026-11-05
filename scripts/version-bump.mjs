#!/usr/bin/env node
// The next version, once the app has changed since the last one. Run on every push to main
// by .github/workflows/version.yml, which pushes the commit this makes. The pipeline in
// EZPIPELINE then publishes that version, as its release folder does not have it yet, and
// installed apps are offered it (docs/RELEASING.md).
//
//   node scripts/version-bump.mjs            says what it would do
//   node scripts/version-bump.mjs --commit   does it: the version, its changelog entry, a commit
//
// The app is everything the desktop app is built from. A change only to the docs, the site,
// tests, CI or the release scripts needs no version (NOT_THE_APP). Anything else counts, a
// path nobody listed too: an update with nothing new in it costs a restart, a fix left out
// costs the fix.
//
// The version goes up a patch, 0.1.4 to 0.1.5, and its changelog entry lists the commits
// that changed the app. To write the entry yourself, or to pick a bigger number, put it
// under "next" in apps/site/content/changelog.json, as { "version"?, "title", "items" }:
// the next version takes it. A push that sets the version itself is left as it is.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { newer } from "../apps/studio/electron/update.mjs";

/** What the app is not made from: a change to these alone needs no new version. Git globs, from the top. */
export const NOT_THE_APP = [
  "docs/**", "apps/site/**", "test/**", "packages/*/test/**", "ci/**", ".github/**", "*.md", "eslint.config.mjs",
  "scripts/release*.mjs", "scripts/publish-release.mjs", "scripts/pipeline-release.mjs", "scripts/version-bump.mjs",
  "scripts/verify-builds.mjs", "scripts/collect-site.mjs", "scripts/check-contrast.mjs",
];
const APP = ["--", ".", ...NOT_THE_APP.map((g) => `:(exclude,glob)${g}`)];
const FILES = ["package.json", "apps/studio/package.json", "package-lock.json", "apps/site/content/changelog.json"];

function git(root, ...args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args[0]} did not succeed: ${(r.stderr || "").trim()}`);
  return r.stdout.trim();
}
const readJson = (root, file) => JSON.parse(readFileSync(join(root, file), "utf8"));
const writeJson = (root, file, value) => writeFileSync(join(root, file), `${JSON.stringify(value, null, 2)}\n`);

/** The commit that set the app's version: the newest to change its "version" line. Null without the history. */
export function versionCommit(root) {
  return git(root, "log", "-1", "--format=%H", "-G", '"version":', "--", "apps/studio/package.json") || null;
}

/** The commits after `since` that change the app, oldest first, merges left out. */
export function appChanges(root, since) {
  const out = git(root, "log", "--reverse", "--no-merges", "--format=%H %s", `${since}..HEAD`, ...APP);
  return out ? out.split("\n").map((l) => ({ sha: l.slice(0, 40), subject: l.slice(41) })) : [];
}

/** One step up: 0.1.4 to 0.1.5, and a test version 0.2.0-beta.1 to 0.2.0-beta.2. */
export function nextVersion(v) {
  const pre = /^(\d+\.\d+\.\d+-[0-9A-Za-z-]+\.)(\d+)$/.exec(v);
  if (pre) return `${pre[1]}${Number(pre[2]) + 1}`;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`${v} is not a version this can count on from, like 0.1.4 or 0.2.0-beta.1. Set the next one under "next" in the changelog.`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/** What comes next, from what changed and the changelog's "next": null when nothing in the app has. */
export function plan(root, { today = new Date().toLocaleDateString("en-CA") } = {}) {
  const { version } = readJson(root, "apps/studio/package.json");
  const since = versionCommit(root);
  if (!since) throw new Error("no commit sets the version here. This needs the whole history: a clone with fetch-depth 0.");
  const changes = appChanges(root, since);
  if (!changes.length) return { version, since, changes, next: null };
  const notes = readJson(root, "apps/site/content/changelog.json").next ?? {};
  const next = notes.version ?? nextVersion(version);
  if (!newer(version, next)) throw new Error(`"next" in the changelog asks for ${next}, which is not newer than ${version}.`);
  // The house style has no em dashes, and a commit subject might.
  const items = notes.items?.length ? notes.items : changes.map((c) => c.subject.replace(/\s*\u2014\s*/g, ", "));
  return { version, since, changes, next, entry: { version: next, date: today, title: notes.title ?? "Fixes and improvements", items } };
}

/** Puts `entry.version` in both package.json files and the lockfile, and the entry first in the changelog, in place of "next". */
export function write(root, entry) {
  for (const file of ["package.json", "apps/studio/package.json"]) writeJson(root, file, { ...readJson(root, file), version: entry.version });
  const lock = readJson(root, "package-lock.json");
  lock.version = entry.version;
  for (const key of ["", "apps/studio"]) if (lock.packages?.[key]) lock.packages[key].version = entry.version;
  writeJson(root, "package-lock.json", lock);
  const log = readJson(root, "apps/site/content/changelog.json");
  delete log.next;
  writeJson(root, "apps/site/content/changelog.json", { ...log, entries: [entry, ...log.entries] });
}

/** The version commit, made: what changed in the app, by commit, is in its message. */
export function commit(root, p) {
  write(root, p.entry);
  git(root, "add", ...FILES);
  const why = `The app changed since ${p.version}, in ${p.changes.length} commit${p.changes.length === 1 ? "" : "s"}:\n\n${p.changes.map((c) => `${c.sha.slice(0, 7)} ${c.subject}`).join("\n")}`;
  git(root, "commit", "--quiet", "-m", p.next, "-m", why);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const say = (m) => console.log(`version-bump: ${m}`);
  try {
    const p = plan(root);
    if (!p.next) say(`nothing the app is made from has changed since ${p.version} was set (${p.since.slice(0, 7)}), so it stays ${p.version}.`);
    else {
      say(`the app changed in ${p.changes.length} commit${p.changes.length === 1 ? "" : "s"} since ${p.version}, so it goes to ${p.next}:`);
      for (const c of p.changes) say(`  ${c.sha.slice(0, 7)} ${c.subject}`);
      if (process.argv.includes("--commit")) { commit(root, p); say(`committed ${p.next}.`); }
    }
  } catch (e) {
    console.error(`version-bump: ${e.message}`);
    process.exit(1);
  }
}
