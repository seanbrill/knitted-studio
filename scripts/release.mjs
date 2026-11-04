#!/usr/bin/env node
// Build the desktop app for macOS, Windows and Linux, publish it as this version's download,
// and deploy the site, so the Download page and the apps' update check list it at once.
//
//   npm run release
//
//   In .env (see .env.example):
//   FILEFREAK_KEY                  the release folder's write key (files:write)
//   KNITTED_RELEASE_DOWNLOAD_KEY   the release folder's read key: the site build lists the releases with it
//   FILEFREAK_SITE_KEY             the site's key: made for the app that owns the site, allowed sites:deploy
//   KNITTED_SITE_NAME              which site, if not "knitted"
//
// Run it on a Mac. electron-builder builds macOS apps only on macOS, and a Mac builds the
// Windows and Linux apps as well, each carrying its own system's ffmpeg, ffprobe and sharp
// (scripts/desktop-binaries.mjs). The version is apps/studio/package.json's. The files go
// up as scripts/publish-release.mjs says, replacing that version's files if it ran before.
// The site is static and lists the release folder as it was when it was built, so it is
// built again here, from this checkout, once the files are up. The pipeline still deploys
// it on every push to main, from main.

import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (m) => { console.error(`release: ${m}`); process.exit(1); };
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} did not succeed.`);
};
const output = (cmd, args, env = {}) => spawnSync(cmd, args, { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });

if (process.platform !== "darwin") fail("run this on a Mac. Only macOS can build the macOS app, and a Mac builds all three.");
if (!process.env.FILEFREAK_KEY) fail("FILEFREAK_KEY is not set. Put the release folder's write key in .env.");
if (!process.env.KNITTED_RELEASE_DOWNLOAD_KEY) fail("KNITTED_RELEASE_DOWNLOAD_KEY is not set. Put the release folder's read key in .env: the site lists the releases with it.");
if (!process.env.FILEFREAK_SITE_KEY) fail("FILEFREAK_SITE_KEY is not set. Put the site's key in .env (see .env.example): this deploys the site, so the new version is listed.");
const site = process.env.KNITTED_SITE_NAME || "knitted";
const siteKey = { FILEFREAK_KEY: process.env.FILEFREAK_SITE_KEY };
const { version } = JSON.parse(await readFile(join(root, "apps/studio/package.json"), "utf8"));

// Everything that can be asked is asked now, not after a long build.
run("node", ["scripts/publish-release.mjs", "--check"]);                  // the upload key can write
const cli = output("filefreak", ["--version"]);
if (cli.error) fail("the FileFreak command line (filefreak) is not installed, and it deploys the site. Install it, then run this again.");
const sites = output("filefreak", ["sites", "list"], siteKey);
if (sites.status !== 0) fail(`FILEFREAK_SITE_KEY cannot see the sites: ${(sites.stderr || sites.stdout).trim()}\nIt has to be a key made for the app that owns the site, not limited to a folder, allowed sites:deploy.`);
if (!new RegExp(`(^|[^\\w-])${site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w-]|$)`, "m").test(sites.stdout)) fail(`that key's app has no site called ${site}. It has:\n${sites.stdout.trim()}`);
// The site is deployed from this checkout: one without main's latest would take the live
// site back to an older one.
if (output("git", ["fetch", "--quiet", "origin", "main"]).status !== 0) fail("could not fetch main from origin, to check this checkout has everything the live site has.");
if (output("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"]).status !== 0) fail("this checkout is missing commits on origin/main. Pull, then run this again: the site deploys from here.");

await rm(join(root, "dist/desktop"), { recursive: true, force: true });  // so only this build's installers go up
run("npm", ["run", "build:app"]);
run("npm", ["run", "desktop:dist", "-w", "@knitted/studio", "--", "--mac", "--win", "--linux"]);
run("node", ["scripts/publish-release.mjs", "dist/desktop"]);

// The site build writes the release folder's list into content/releases.json, which is
// committed with none in it (a fork or a clone without the key lists nothing). Put it back.
const listFile = join(root, "apps/site/content/releases.json");
const committed = await readFile(listFile, "utf8");
try {
  // Next builds only in production mode (a shell that says development breaks the error pages).
  run("npm", ["run", "build:site"], { NODE_ENV: "production" });
} finally {
  await writeFile(listFile, committed);
}
const built = JSON.parse(await readFile(join(root, "dist/site/releases.json"), "utf8"));
if (!built.releases.some((r) => r.version === version)) fail(`the site build does not list ${version}, so it was not deployed. Check that v${version}'s files are public in the release folder, then run npm run build:site and deploy, or push to main.`);
run("filefreak", ["sites", "deploy", "dist/site", "--site", site], siteKey);

// What visitors and the apps' update check get, not what was sent.
const live = `https://${site}.filefreak.page/releases.json`;
let listed = false;
for (let i = 0; i < 12 && !listed; i++) {
  if (i) await new Promise((r) => setTimeout(r, 5000));
  try { listed = (await (await fetch(`${live}?release=${Date.now()}`)).json()).releases.some((r) => r.version === version); } catch {}
}
if (!listed) fail(`deployed, but ${live} does not list ${version} yet. Look again in a minute; if it still does not, run the site pipeline.`);
console.log(`release: ${version} is published, and the Download page and the apps' update check list it.`);
