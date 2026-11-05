// The release the pipeline makes on Linux (scripts/pipeline-release.mjs): every installer
// but the Mac's .dmg, published only when the version is new, with the Mac app signed as a
// Mac signs it. Building and uploading need the pipeline (docs/RELEASING.md); the rules are here.

import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RELEASES } from "../apps/studio/electron/update.mjs";
import { problem, published, unserved } from "../scripts/release-check.mjs";
import { signArgs } from "../scripts/mac-sign.mjs";

const names = (v, { dmg = true } = {}) => [
  ...(dmg ? [`knitted-${v}-mac-arm64.dmg`, `knitted-${v}-mac-x64.dmg`] : []),
  `knitted-${v}-mac-arm64.zip`, `knitted-${v}-mac-x64.zip`, `knitted-${v}-win-x64.exe`, `knitted-${v}-linux-x86_64.AppImage`, `knitted-${v}-linux-arm64.AppImage`,
];

test("a release without the disk images still has a file for every installed app to update with", () => {
  assert.deepEqual(unserved(names("0.2.0", { dmg: false })), []);
  assert.deepEqual(unserved(names("0.2.0")), []);
  // A Mac app updates from the .zip, never the .dmg, so disk images alone serve no one.
  assert.deepEqual(unserved(["knitted-0.2.0-mac-arm64.dmg", "knitted-0.2.0-mac-x64.dmg", "knitted-0.2.0-win-x64.exe"]), ["darwin arm64", "darwin x64", "linux x64", "linux arm64"]);
});

// FileFreak's public answers for the release folder: each version's files, and its SHA256SUMS.txt unless still going up.
const sha = (name) => createHash("sha256").update(name).digest("hex");
function fileFreak(versions, { goingUp = [], sums = sha } = {}) {
  let ids = 0;
  const uid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
  const lists = new Map([[RELEASES, []]]), raws = new Map();
  for (const [version, files] of Object.entries(versions)) {
    const folder = { id: uid(), kind: "folder", name: `v${version}` };
    const items = files.map((name) => ({ id: uid(), kind: "file", name }));
    if (!goingUp.includes(version)) {
      items.push({ id: uid(), kind: "file", name: "SHA256SUMS.txt" });
      raws.set(items.at(-1).id, files.map((n) => `${sums(n)}  ${n}`).join("\n") + "\n");
    }
    lists.get(RELEASES).push(folder);
    lists.set(folder.id, items);
  }
  return async (url) => {
    const [, id, what] = /^\/api\/public\/files\/([^/]+)\/(items|raw)$/.exec(new URL(url).pathname) ?? [];
    if (what === "items" && lists.has(id)) return Response.json({ items: lists.get(id), nextOffset: null });
    if (what === "raw" && raws.has(id)) return new Response(raws.get(id));
    return Response.json({ error: "not_found" }, { status: 404 });
  };
}
const built = (files) => files.map((n) => `${sha(n)}  ${n}`).join("\n") + "\n";

test("a new version is one the release folder has not finished; one npm run release finished is left alone", async () => {
  const fetch = fileFreak({ "0.1.4": names("0.1.4"), "0.1.5": names("0.1.5", { dmg: false }) }, { goingUp: ["0.1.5"] });
  assert.equal((await published("0.1.4", fetch)).finished, true, "up: the pipeline builds nothing");
  assert.equal((await published("0.1.5", fetch)).finished, false, "still going up, or a run that stopped: built again");
  assert.equal(await published("0.1.6", fetch), null, "not there at all: built");
});

test("once uploaded, a version is checked the way the apps read it", async () => {
  const pipeline = names("0.1.5", { dmg: false });
  assert.equal(await problem("0.1.5", built(pipeline), fileFreak({ "0.1.5": pipeline })), null, "the pipeline's files, no .dmg, are a whole release");
  assert.match(await problem("0.1.5", built(pipeline), fileFreak({ "0.1.5": pipeline }, { goingUp: ["0.1.5"] })), /has no SHA256SUMS\.txt in the release folder/);
  assert.match(await problem("0.1.5", built(pipeline), fileFreak({ "0.1.5": pipeline.filter((n) => !n.includes("mac-x64")) })), /no file the darwin x64 app can update itself with/);
  assert.match(await problem("0.1.5", built(pipeline), fileFreak({ "0.1.5": pipeline }, { sums: () => "0".repeat(64) })), /SHA-256 for knitted-0\.1\.5-mac-arm64\.zip is not the one built here/,
    "a Mac's upload of the same version, landing between, shows as files that are not these");
  assert.match(await problem("0.1.6", built(pipeline), fileFreak({ "0.1.5": pipeline })), /shows no v0\.1\.6/);
});

// The start of a Mach-O file: 64-bit, its type at byte 12 (2 a program, 6 a library, 8 a plug-in like sharp's .node).
const machO = (type) => { const b = Buffer.alloc(64); b.writeUInt32LE(0xfeedfacf, 0); b.writeUInt32LE(0x0100000c, 4); b.writeUInt32LE(type, 12); return b; };
const universal = (type) => { const b = Buffer.alloc(4096 + 64); b.writeUInt32BE(0xcafebabe, 0); b.writeUInt32BE(1, 4); b.writeUInt32BE(4096, 16); machO(type).copy(b, 4096); return b; };

test("a Mac app signed off a Mac gets electron-builder's entitlements on each program in it, and its libraries none", () => {
  const app = join(mkdtempSync(join(tmpdir(), "knitted-mac-sign-")), "knitted.app");
  const put = (path, content) => { mkdirSync(join(app, path, ".."), { recursive: true }); writeFileSync(join(app, path), content); };
  put("Contents/MacOS/knitted", machO(2));
  put("Contents/Frameworks/knitted Helper (GPU).app/Contents/MacOS/knitted Helper (GPU)", machO(2));
  put("Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework", machO(6));
  put("Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler", universal(2));
  symlinkSync("A", join(app, "Contents/Frameworks/Electron Framework.framework/Versions/Current"));
  symlinkSync("Versions/Current/Helpers", join(app, "Contents/Frameworks/Electron Framework.framework/Helpers"));
  put("Contents/Resources/bin/ffmpeg", machO(2));
  put("Contents/Resources/bin/ffmpeg.LICENSE", "GPL");
  put("Contents/Resources/app-server/node_modules/@img/sharp-darwin-arm64/lib/sharp.node", machO(8));
  put("Contents/Resources/app-server/node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.dylib", machO(6));
  put("Contents/Resources/app-server/server.js", "require('next')");

  return signArgs(app).then((args) => {
    const ent = args[2];
    assert.deepEqual(args.slice(0, 3), ["sign", "--entitlements-xml-file", ent], "unscoped, the app's own program gets them");
    assert.match(readFileSync(ent, "utf8"), /com\.apple\.security\.cs\.allow-jit/);
    const scoped = args.slice(3, -1).filter((a) => a !== "--entitlements-xml-file").map((a) => a.slice(0, -(ent.length + 1)));
    assert.deepEqual(scoped, [
      "Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler",
      "Contents/Frameworks/knitted Helper (GPU).app/Contents/MacOS/knitted Helper (GPU)",
      "Contents/Resources/bin/ffmpeg",
    ], "each program once, by its real path, and no library, plug-in or other file");
    assert.equal(args.at(-1), app);
  });
});

test("the pipeline publishes a new version after the checks and before it builds the site, which then lists it", () => {
  const yaml = readFileSync("ci/ezpipeline/knitted-release.yaml", "utf8");
  const steps = [...yaml.matchAll(/^ {2}- name: (.+)$/gm)].map((m) => m[1]);
  const at = (name) => { const i = steps.indexOf(name); assert.ok(i >= 0, `no step "${name}" in ${steps.join(", ")}`); return i; };
  assert.ok(at("Install and check") < at("Publish the installers") && at("Publish the installers") < at("Build the site"));
  const step = yaml.slice(yaml.indexOf("- name: Publish the installers"), yaml.indexOf("- name: Build the site"));
  assert.match(step, /node scripts\/pipeline-release\.mjs\s*$/m);
  assert.match(step, /NODE_ENV: production/, "the app's Next.js build fails in development mode, as the site's does");
});
