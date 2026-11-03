// The migration is a copy: a dry run changes nothing, and --apply leaves the source untouched.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ff5a1f" } }).png().toBuffer();
const script = join(process.cwd(), "scripts/migrate-notch.mjs");

async function fixture() {
  const from = await mkdtemp(join(tmpdir(), "notch-src-"));
  const a = join(from, "assets");
  await mkdir(join(a, "videos"), { recursive: true }); await mkdir(join(a, "memes"), { recursive: true });
  await writeFile(join(a, "photo-a.png"), png);
  await writeFile(join(a, "photo-copy.png"), png);                // identical bytes: stored once
  await writeFile(join(a, "memes", "m.png"), await sharp({ create: { width: 9, height: 9, channels: 3, background: "#111" } }).png().toBuffer());
  await writeFile(join(a, "notes.xyz"), "not importable");
  await symlink("/etc/hosts", join(a, "link.png")).catch(() => {}); // a link out of the folder must be ignored
  return { from, a };
}
async function snapshot(dir) {
  const out = {};
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const p = join(e.parentPath, e.name);
    out[p] = createHash("sha256").update(await readFile(p)).digest("hex") + (await stat(p)).mtimeMs;
  }
  return out;
}
const run = (args, home) => spawnSync(process.execPath, [script, ...args, "--home", home], { encoding: "utf8" });

test("a dry run reports the plan and writes nothing, anywhere", async () => {
  const { from } = await fixture(); const home = await mkdtemp(join(tmpdir(), "k-home-"));
  const before = await snapshot(from);
  const r = run(["--from", from], home);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY RUN/); assert.match(r.stdout, /Not importable \(1\)/);
  assert.deepEqual(await snapshot(from), before);
  assert.deepEqual(await readdir(home), [], "the library is untouched too");
});

test("--apply imports, dedupes identical files, skips links, and never touches the source", async () => {
  const { from } = await fixture(); const home = await mkdtemp(join(tmpdir(), "k-home-"));
  const before = await snapshot(from);
  const r = run(["--apply", "--from", from], home);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Imported 2, already present 1, failed 0/);
  assert.deepEqual(await snapshot(from), before, "the source folder is byte and mtime identical afterwards");
  const map = JSON.parse(await readFile(join(home, "notch-id-map.json"), "utf8"));
  assert.ok(map.map["photo-a.png"] && map.map["memes/m.png"] && !map.map["link.png"]);
});

test("--skip-loose leaves the loose files for a person to decide", async () => {
  const { from } = await fixture(); const home = await mkdtemp(join(tmpdir(), "k-home-"));
  const r = run(["--apply", "--skip-loose", "--from", from], home);
  assert.match(r.stdout, /Imported 1,/);
});
