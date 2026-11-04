#!/usr/bin/env node
// Build the desktop app for macOS, Windows and Linux, and publish it as this version's
// download in the FileFreak release folder.
//
//   npm run release
//
//   In .env (see .env.example):
//   FILEFREAK_KEY   the release folder's write key (files:write)
//
// Run it on a Mac. electron-builder builds macOS apps only on macOS, and a Mac builds the
// Windows and Linux apps as well, each carrying its own system's ffmpeg, ffprobe and sharp
// (scripts/desktop-binaries.mjs). The version is apps/studio/package.json's. The files go
// up as scripts/publish-release.mjs says, replacing that version's files if it ran before.
//
// That is all it publishes. Installed apps read the release folder themselves
// (apps/studio/electron/update.mjs), so they are offered the version once it is up. The
// site is static and lists the folder as it was when it was built: the pipeline builds
// and deploys it on every push to main, so its Download page lists this version from the
// first run after this one.

import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, fileFor, releaseIn, versionsIn } from "../apps/studio/electron/update.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (m) => { console.error(`release: ${m}`); process.exit(1); };
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} did not succeed.`);
};
const output = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: "utf8" });

if (process.platform !== "darwin") fail("run this on a Mac. Only macOS can build the macOS app, and a Mac builds all three.");
if (!process.env.FILEFREAK_KEY) fail("FILEFREAK_KEY is not set. Put the release folder's write key in .env.");
const { version } = JSON.parse(await readFile(join(root, "apps/studio/package.json"), "utf8"));

// Everything that can be asked is asked now, not after a long build.
run("node", ["scripts/publish-release.mjs", "--check"]);                  // the upload key can write
// The installers are built from this checkout: one without main's latest would publish
// this version without some of it.
if (output("git", ["fetch", "--quiet", "origin", "main"]).status !== 0) fail("could not fetch main from origin, to check this checkout has everything on it.");
if (output("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"]).status !== 0) fail("this checkout is missing commits on origin/main. Pull, then run this again: the installers are built from here.");

await rm(join(root, "dist/desktop"), { recursive: true, force: true });  // so only this build's installers go up
run("npm", ["run", "build:app"]);
run("npm", ["run", "desktop:dist", "-w", "@knitted/studio", "--", "--mac", "--win", "--linux"]);
run("node", ["scripts/publish-release.mjs", "dist/desktop"]);

// What the apps' update check reads, not what was sent: the folder as anyone sees it,
// with no key, holding each system's file and the SHA-256 it was built with.
const built = await readFile(join(root, "dist/desktop/SHA256SUMS.txt"), "utf8");
let release;
try {
  const folder = (await versionsIn(fetch)).find((v) => v.version === version);
  if (folder) release = await releaseIn(fetch, folder);
} catch (e) {
  fail(`the release folder could not be read the way the apps read it: ${e.message}`);
}
if (!release) fail(`the release folder shows no v${version}. Make it public in FileFreak, so the apps and the site can see it.`);
if (!release.finished) fail(`v${version} has no SHA256SUMS.txt in the release folder, so the apps take it for a release still going up.`);
for (const [platform, arch] of [["darwin", "arm64"], ["darwin", "x64"], ["win32", "x64"], ["linux", "x64"], ["linux", "arm64"]]) {
  const file = fileFor(release, platform, arch);
  if (!file) fail(`v${version} has no file the ${platform} ${arch} app can update itself with.`);
  if (!built.includes(`${file.sha256}  ${file.name}`)) fail(`the release folder's SHA-256 for ${file.name} is not the one built here.`);
}
console.log(`release: ${version} is published. Installed apps (0.1.2 and later) are offered it the next time they check.`);

// The Download page, and copies older than 0.1.2 (they ask the site), see it once the
// pipeline has built the site again. A push to main starts that, so say whether the site
// lists it yet and whether this checkout has anything to push.
const listed = await fetch(`${SITE}/releases.json`, { signal: AbortSignal.timeout(20_000) })
  .then((res) => (res.ok ? res.json() : null))
  .then((site) => (Array.isArray(site?.releases) ? site.releases.some((r) => r?.version === version) : null))
  .catch(() => null);
const toPush = output("git", ["rev-list", "--count", "origin/main..HEAD"]).stdout?.trim() !== "0"
  || !!output("git", ["status", "--porcelain", "--untracked-files=no"]).stdout?.trim();
if (listed) console.log("release: the Download page lists it already.");
else if (toPush) console.log("release: the Download page does not list it yet. Push this to main: the site build that starts lists it, and copies older than 0.1.2 are offered it then.");
else console.log(`release: the Download page does not list it yet, and this checkout has nothing to push, so nothing will start a site build. Run "knitted release" in EZPIPELINE: once it has run, the page lists it and copies older than 0.1.2 are offered it.`);
