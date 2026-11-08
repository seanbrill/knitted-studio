// Sign a packed Mac app on a computer that is not a Mac. The pipeline builds the Mac app on
// Linux (scripts/pipeline-release.mjs), where electron-builder does not sign it, and an
// unsigned download says "knitted is damaged". rcodesign, an open-source copy of Apple's
// codesign (https://github.com/indygreg/apple-platform-rs), signs it the way a Mac build is
// signed (identity "-" in electron-builder.yml): ad-hoc, every program and library in it,
// with electron-builder's entitlements on each program. Apple's codesign accepts it
// (codesign --verify --deep --strict, which the updater runs before it installs a version),
// and Gatekeeper treats it as it treats a Mac build: Open Anyway, once.
//
// Called by scripts/after-pack.mjs. rcodesign is fetched once into the desktop cache, at a
// pinned version, and checked against the SHA-256 it was published with.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { cache, root } from "./desktop-binaries.mjs";

const VERSION = "0.29.0";
// Each Linux build's SHA-256, as published beside it.
const BUILDS = {
  arm64: ["aarch64-unknown-linux-musl", "4af92c87ddf52f5f2d1258a3b4e56c7dcb8f1b2468df744976c5f139e031961f"],
  x64: ["x86_64-unknown-linux-musl", "dbe85cedd8ee4217b64e9a0e4c2aef92ab8bcaaa41f20bde99781ff02e600002"],
};
// What electron-builder gives every program in a Mac build. Without the hardened runtime
// (hardenedRuntime: false) none of it changes what the app may do; it keeps the two builds alike.
const ENTITLEMENTS = join(root, "node_modules/app-builder-lib/templates/entitlements.mac.plist");

/** rcodesign for this computer, fetched once. */
export async function rcodesign() {
  const build = process.platform === "linux" && BUILDS[process.arch];
  if (!build) throw new Error(`There is no rcodesign for ${process.platform} ${process.arch} here. Build the Mac app on a Mac or on Linux.`);
  const [triple, sha256] = build;
  const dir = join(cache, `rcodesign-${VERSION}-${triple}`);
  if (existsSync(join(dir, "rcodesign"))) return join(dir, "rcodesign");
  const name = `apple-codesign-${VERSION}-${triple}.tar.gz`;
  const res = await fetch(`https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F${VERSION}/${name}`);
  if (!res.ok) throw new Error(`Could not download rcodesign: ${res.status} ${res.statusText}`);
  const tgz = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(tgz).digest("hex");
  if (got !== sha256) throw new Error(`The rcodesign download is not the one published: its SHA-256 is ${got}, not ${sha256}.`);
  const part = `${dir}.part`;
  await rm(part, { recursive: true, force: true });
  await mkdir(part, { recursive: true });
  await writeFile(join(part, name), tgz);
  execFileSync("tar", ["-xzf", join(part, name), "-C", part, "--strip-components", "1"]);
  await rm(join(part, name));
  await rename(part, dir);
  return join(dir, "rcodesign");
}

const MH_MAGIC_64 = 0xfeedfacf, FAT_MAGIC = 0xcafebabe, MH_EXECUTE = 2;
/** Is this file a Mach-O program, not a library? A universal one counts by its first part. */
async function isProgram(file) {
  const fh = await open(file, "r");
  try {
    const h = Buffer.alloc(32);
    await fh.read(h, 0, h.length, 0);
    if (h.readUInt32LE(0) === MH_MAGIC_64) return h.readUInt32LE(12) === MH_EXECUTE;
    if (h.readUInt32BE(0) !== FAT_MAGIC) return false;
    const part = Buffer.alloc(16);
    await fh.read(part, 0, part.length, h.readUInt32BE(16));   // the first part's offset, after its cputype and cpusubtype
    return part.readUInt32LE(0) === MH_MAGIC_64 && part.readUInt32LE(12) === MH_EXECUTE;
  } finally {
    await fh.close();
  }
}

/**
 * rcodesign's arguments for an app: the entitlements on the app's own program and on each
 * program in it (its helpers, chrome_crashpad_handler, ffmpeg and ffprobe), by its path in
 * the app. Libraries get none, as in a Mac build. Links are not followed: a framework's
 * Versions/Current leads to files already counted.
 */
export async function signArgs(app) {
  const own = join(app, "Contents/MacOS");
  const programs = [];
  for (const e of await readdir(app, { withFileTypes: true, recursive: true })) {
    if (!e.isFile() || e.parentPath === own) continue;
    const file = join(e.parentPath, e.name);
    // rcodesign scopes are paths inside the bundle, forward slashes on any system that signs.
    if (await isProgram(file)) programs.push(relative(app, file).split(/[\\/]/).join("/"));
  }
  // rcodesign reads a colon or an @ in a path as part of the scope. No program's path has one.
  const scoped = programs.filter((p) => !/[:@]/.test(p)).sort();
  return ["sign", "--entitlements-xml-file", ENTITLEMENTS, ...scoped.flatMap((p) => ["--entitlements-xml-file", `${p}:${ENTITLEMENTS}`]), app];
}

/** Sign a packed knitted.app ad-hoc, in place. */
export async function signMacApp(app) {
  const bin = await rcodesign();
  const args = await signArgs(app);
  try {
    execFileSync(bin, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    const said = String(e.stderr || e.stdout || e.message).trim().split("\n").slice(-12).join("\n");
    throw new Error(`rcodesign could not sign ${app}:\n${said}`);
  }
}
