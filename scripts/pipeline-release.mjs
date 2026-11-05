#!/usr/bin/env node
// The pipeline's release (ci/ezpipeline/knitted-release.yaml), on Linux: when this version
// is not in the FileFreak release folder yet, build every installer that can be built off a
// Mac and publish them, as npm run release does on a Mac.
//
//   node scripts/pipeline-release.mjs               on every run: publishes a new version
//   node scripts/pipeline-release.mjs --no-upload   builds into dist/desktop and stops,
//                                                    whatever the release folder holds
//
//   FILEFREAK_KEY   the release folder's write key (files:write), for a new version
//
// macOS gets its .zip and no .dmg: a disk image is made with hdiutil, which only macOS
// has. Installed Mac apps update from the .zip, and the Download page offers the newest
// .dmg there is beside it (apps/site/lib/downloads.ts). npm run release on a Mac makes
// the .dmg: run on a version this published, it replaces the files with a Mac's and adds
// it. electron-builder signs Mac apps only on a Mac, so after-pack.mjs signs them here as
// a Mac would (mac-sign.mjs).
//
// A version already in the folder is left as it is, whoever put it there. npm run release
// uploads before it pushes, so the run its push starts finds the version up and goes on
// to build the site: one of the two uploads a version, never both.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import builder from "electron-builder";
import { problem, published, unserved } from "./release-check.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const say = (m) => console.log(`pipeline-release: ${m}`);
const fail = (m) => { console.error(`pipeline-release: ${m}`); process.exit(1); };
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} did not succeed.`);
};
const upload = !process.argv.includes("--no-upload");
const { version } = JSON.parse(await readFile(join(root, "apps/studio/package.json"), "utf8"));
const inFolder = () => published(version).catch((e) => fail(`the release folder could not be read the way the apps read it: ${e.message}`));

if (upload) {
  if ((await inFolder())?.finished) {
    say(`v${version} is in the release folder already, so there is nothing to build. A push that changes the app gets the next version (.github/workflows/version.yml), and the run for that builds it.`);
    // Said on every run, not first at the next version: whether its installers can go up.
    if (!process.env.FILEFREAK_KEY) say("FILEFREAK_KEY is not set, so the next version's installers cannot go up from here. Set it in EZPIPELINE to the release folder's write key.");
    else if (spawnSync("node", ["scripts/publish-release.mjs", "--check"], { cwd: root, stdio: "inherit" }).status !== 0) say("FILEFREAK_KEY cannot write to the release folder (above), so the next version's installers cannot go up from here.");
    process.exit(0);
  }
  if (!process.env.FILEFREAK_KEY) fail(`v${version} is new, and FILEFREAK_KEY is not set. Set it in EZPIPELINE to the release folder's write key.`);
  run("node", ["scripts/publish-release.mjs", "--check"]);                  // the key can write, before a long build
}

await rm(join(root, "dist/desktop"), { recursive: true, force: true });  // so only this build's installers go up
run("npm", ["run", "build:app"]);
run("node", ["scripts/app-icons.mjs"]);
// electron-builder makes the Windows uninstaller by running the installer it has just made:
// with Wine anywhere but Windows, except on a Mac, where it reads the uninstaller out of the
// installer instead. Wine has no build for this ARM Linux host, so it goes the Mac's way.
// The check is used for nothing else (app-builder-lib/out/targets/nsis/NsisTarget.js).
const macosVersion = createRequire(import.meta.url)(join(root, "node_modules/app-builder-lib/out/util/macosVersion.js"));
if (process.platform === "linux") macosVersion.isMacOsCatalina = () => true;
// Each system's targets from electron-builder.yml, except the Mac's .dmg. It reads the
// hook's path there from the folder it runs in, which npm run desktop:dist makes apps/studio.
process.chdir(join(root, "apps/studio"));
await builder.build({ projectDir: ".", mac: ["zip:arm64", "zip:x64"], win: [], linux: [], publish: "never" })
  .catch((e) => fail(`electron-builder did not finish: ${e.message}`));

const built = (await readdir(join(root, "dist/desktop"))).filter((f) => /\.(zip|exe|appimage)$/i.test(f)).sort();
const missing = unserved(built);
if (missing.length) fail(`the build has no file for ${missing.join(", ")}: it made ${built.join(", ") || "nothing"}.`);
say(`built ${built.join(", ")}`);
if (!upload) process.exit(0);

// npm run release may have put this version up while this built. Then its files stay.
if ((await inFolder())?.finished) {
  say(`v${version} went up from elsewhere while this built (npm run release), so these are not uploaded.`);
  process.exit(0);
}
run("node", ["scripts/publish-release.mjs", "dist/desktop"]);
const wrong = await problem(version, await readFile(join(root, "dist/desktop/SHA256SUMS.txt"), "utf8"));
if (wrong) fail(wrong);
say(`v${version} is published, without a .dmg. Installed apps (0.1.2 and later) are offered it the next time they check, and the site built next lists it.`);
