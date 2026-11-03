#!/usr/bin/env node
// Publish the built installers as a versioned download on FileFreak.
//
//   node scripts/publish-release.mjs [dir]        dir defaults to dist/desktop
//   node scripts/publish-release.mjs --check      only checks the key can write, before a long build
//
//   FILEFREAK_KEY   a key that may write files (files:write), limited to the release folder
//
// The files go in v<version> at the top of what the key can reach (the release folder),
// beside a SHA256SUMS.txt, and replace same-named files, so running a version again is safe.
//
// Only WRITE calls are made. A folder is made with ifExists "use", which hands back
// the folder already there, and each file is uploaded into that folder's id. So a CI
// key that may write but not read is enough. The filefreak command line looks every
// path up first, which needs files:read, and that is why this is not `filefreak cp`.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { FileFreak, FileFreakError } from "@filefreak.io/sdk";
import { fromPath } from "@filefreak.io/sdk/node";

const INSTALLER = /\.(dmg|zip|exe|msi|appimage|deb|rpm)$/i;
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const dir = resolve(args.find((a) => !a.startsWith("--")) ?? "dist/desktop");
const key = process.env.FILEFREAK_KEY;
const fail = (m) => { console.error(`publish: ${m}`); process.exit(1); };
if (!key) fail("FILEFREAK_KEY is not set.");

const version = JSON.parse(await readFile(resolve("apps/studio/package.json"), "utf8")).version;
const ff = new FileFreak({ apiKey: key });
const refused = (e) => { if (e instanceof FileFreakError) fail(`FileFreak refused it (${e.status} ${e.code}): ${e.message}`); throw e; };
const versionFolder = () => ff.folders.create({ name: `v${version}`, ifExists: "use" }).then((r) => r.item, refused);
if (checkOnly) {
  await versionFolder();
  console.log(`publish: this key can write v${version} into the release folder`);
  process.exit(0);
}

const installers = (await readdir(dir)).filter((f) => INSTALLER.test(f)).sort();
if (!installers.length) fail(`no installers in ${dir}, so there is nothing to publish.`);

const mb = (n) => `${(n / 1024 ** 2).toFixed(1)} MB`;
const sha256 = (p) => new Promise((ok, no) => {
  const h = createHash("sha256");
  createReadStream(p).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", no);
});
// Each file's SHA-256 is also kept with it in FileFreak, where the Download page reads it.
const hashes = new Map();
for (const f of installers) hashes.set(f, await sha256(join(dir, f)));
await writeFile(join(dir, "SHA256SUMS.txt"), [...hashes].map(([f, h]) => `${h}  ${f}`).join("\n") + "\n");
hashes.set("SHA256SUMS.txt", await sha256(join(dir, "SHA256SUMS.txt")));

const parentId = (await versionFolder()).id;
console.log(`publish: v${version} in the release folder`);

let hidden = 0;
for (const f of [...installers, "SHA256SUMS.txt"]) {
  const path = join(dir, f);
  const total = (await stat(path)).size;
  let shown = 0;
  const item = await ff.upload(await fromPath(path), {
    // Stored as it is, so its public link downloads it. A file FileFreak keeps compressed
    // has no direct address: its public link opens a FileFreak page that rebuilds it.
    parentId, onConflict: "replace", sha256: hashes.get(f), compress: false,
    onProgress: (sent) => { const pct = Math.floor((sent / total) * 4) * 25; if (pct > shown && pct < 100) { shown = pct; console.log(`  ${f} ${pct}%`); } },
  }).catch(refused);
  if (!item.publicUrl) hidden++;
  console.log(`  ${f}  ${mb(total)}  ${item.publicUrl ?? "(not public)"}`);
}
if (hidden) console.warn(`publish: ${hidden} file(s) are not public. The Download page lists only public files: make the release folder public in FileFreak.`);
