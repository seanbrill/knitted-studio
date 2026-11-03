#!/usr/bin/env node
// Build the desktop app for macOS, Windows and Linux, and publish it as this version's download.
//
//   npm run release
//
//   FILEFREAK_KEY   in .env: the release folder's write key (files:write)
//
// Run it on a Mac. electron-builder builds macOS apps only on macOS, and a Mac builds the
// Windows and Linux apps as well, each carrying its own system's ffmpeg, ffprobe and sharp
// (scripts/desktop-binaries.mjs). The version is apps/studio/package.json's. The files go
// up as scripts/publish-release.mjs says, replacing that version's files if it ran before.
// The Download page lists them from the site's next build: push to main, or run the site
// pipeline in EZPIPELINE.

import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (m) => { console.error(`release: ${m}`); process.exit(1); };
const run = (cmd, ...args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} did not succeed.`);
};

if (process.platform !== "darwin") fail("run this on a Mac. Only macOS can build the macOS app, and a Mac builds all three.");
if (!process.env.FILEFREAK_KEY) fail("FILEFREAK_KEY is not set. Put the release folder's write key in .env.");

run("node", "scripts/publish-release.mjs", "--check");                   // the key works, before a long build
await rm(join(root, "dist/desktop"), { recursive: true, force: true });  // so only this build's installers go up
run("npm", "run", "build:app");
run("npm", "run", "desktop:dist", "-w", "@knitted/studio", "--", "--mac", "--win", "--linux");
run("node", "scripts/publish-release.mjs", "dist/desktop");
console.log("release: published. The Download page lists it from the site's next build: push to main, or run the site pipeline.");
