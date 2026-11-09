#!/usr/bin/env node
// Build the desktop app for macOS, Windows and Linux, and publish it as this version's
// download in the FileFreak release folder.
//
//   npm run release
//
//   In .env (see .env.example):
//   FILEFREAK_KEY   the release folder's write key (files:write)
//
// Run it on a Mac. Only a Mac makes the macOS disk images (.dmg), and a Mac builds the
// Windows and Linux apps as well, each carrying its own system's ffmpeg, ffprobe and sharp
// (scripts/desktop-binaries.mjs). The version is apps/studio/package.json's. The files go
// up as scripts/publish-release.mjs says, replacing that version's files if it ran before.
// The pipeline publishes a version pushed without this, all but the .dmg
// (scripts/pipeline-release.mjs); this run on that version replaces its files and adds the .dmg.
//
// Installed apps read the release folder themselves (apps/studio/electron/update.mjs), so
// they are offered the version once it is up, and so does the Download page in a visitor's
// browser. The site's own list is the folder as it was when it was built, and a push to main
// builds it: so last, this pushes the checkout it built from and waits for that list to have
// these files (scripts/release-site.mjs).

import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE } from "../apps/studio/electron/update.mjs";
import { problem } from "./release-check.mjs";
import { showOnSite } from "./release-site.mjs";
import { appChanges, versionCommit } from "./version-bump.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (m) => { console.error(`release: ${m}`); process.exit(1); };
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} did not succeed.`);
};
const output = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: "utf8" });

if (process.platform !== "darwin") fail("run this on a Mac. Only macOS can make the disk images, and a Mac builds all three systems' apps. A push of a new version publishes the rest from the pipeline.");
if (!process.env.FILEFREAK_KEY) fail("FILEFREAK_KEY is not set. Put the release folder's write key in .env.");
const { version } = JSON.parse(await readFile(join(root, "apps/studio/package.json"), "utf8"));

// Everything that can be asked is asked now, not after a long build.
run("node", ["scripts/publish-release.mjs", "--check"]);                  // the upload key can write
// The installers are built from this checkout: one without main's latest would publish
// this version without some of it.
if (output("git", ["fetch", "--quiet", "origin", "main"]).status !== 0) fail("could not fetch main from origin, to check this checkout has everything on it.");
if (output("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"]).status !== 0) fail("this checkout is missing commits on origin/main. Pull, then run this again: the installers are built from here.");
// Apps on this version are never offered it again, so it must not go up with changes newer
// than it: those get a version of their own when they are pushed (scripts/version-bump.mjs).
const unversioned = appChanges(root, versionCommit(root) ?? "HEAD");
if (unversioned.length) fail(`this checkout changes the app since ${version} was set (${unversioned.at(-1).sha.slice(0, 7)} ${unversioned.at(-1).subject}). Push it first: main gives it the next version and the pipeline publishes that. Then pull, and run this again to add the .dmg.`);

await rm(join(root, "dist/desktop"), { recursive: true, force: true });  // so only this build's installers go up
run("npm", ["run", "build:app"]);
run("npm", ["run", "desktop:dist", "-w", "@knitted/studio", "--", "--mac", "--win", "--linux"]);
run("node", ["scripts/publish-release.mjs", "dist/desktop"]);

// What the apps' update check reads, not what was sent: the folder as anyone sees it,
// with no key, holding each system's file and the SHA-256 it was built with.
const built = await readFile(join(root, "dist/desktop/SHA256SUMS.txt"), "utf8");
const wrong = await problem(version, built);
if (wrong) fail(wrong);
console.log(`release: ${version} is published. Installed apps (0.1.2 and later) are offered it the next time they check, and the Download page shows it now: it reads the release folder.`);

console.log(`release: ${await showOnSite({ root, site: SITE, version, sums: built })}`);
