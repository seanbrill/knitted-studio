// What each desktop app carries that is built for one system: ffmpeg, ffprobe, and
// sharp's native part with the libvips it links. npm installed this machine's, which
// fit no other system, so each app gets its own system's here: ffmpeg from the
// ffmpeg-static release its installer downloads from, ffprobe and sharp's parts from
// npm, at the versions the installed packages ask for. Each is fetched once into
// node_modules/.cache, and every program is read to check it is built for its system
// before it goes in (an "arm64" ffprobe that was really x86_64 has happened here).
//
// Called by scripts/after-pack.mjs for each app electron-builder packs. KNITTED_DESKTOP_CACHE
// moves the cache somewhere a fresh checkout keeps, as the pipeline does.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, cp, mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const cache = process.env.KNITTED_DESKTOP_CACHE || join(root, "node_modules/.cache/knitted-desktop");
const manifest = async (name) => JSON.parse(await readFile(join(root, "node_modules", name, "package.json"), "utf8"));

/** A download, kept in the cache once it is whole. */
async function download(url, dest, decode = (b) => b) {
  if (existsSync(dest)) return dest;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${url}: ${res.status} ${res.statusText}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(`${dest}.part`, decode(Buffer.from(await res.arrayBuffer())));
  await rename(`${dest}.part`, dest);
  return dest;
}

/** An npm package for any system, unpacked into the cache: its folder. */
async function unpacked(name, version) {
  const dir = join(cache, "npm", `${name.replace("/", "+")}@${version}`);
  if (existsSync(dir)) return dir;
  const part = `${dir}.part`;
  await rm(part, { recursive: true, force: true });
  await mkdir(part, { recursive: true });
  // npm's own script when npm started this (on Windows, `npm` is a .cmd that cannot be run directly).
  const npm = process.env.npm_execpath ? [process.execPath, process.env.npm_execpath] : ["npm"];
  execFileSync(npm[0], [...npm.slice(1), "pack", `${name}@${version}`, "--pack-destination", part, "--silent"], { stdio: ["ignore", "ignore", "inherit"] });
  const tgz = (await readdir(part)).find((f) => f.endsWith(".tgz"));
  execFileSync("tar", ["-xzf", join(part, tgz), "-C", part, "--strip-components", "1"]);
  await rm(join(part, tgz));
  await rename(part, dir);
  return dir;
}

const MACHO = { 0x01000007: "x64", 0x0100000c: "arm64" };
/** The systems a program or library is built for, read from its header: ["darwin-arm64"] and the like. */
async function builtFor(file) {
  const fh = await open(file, "r");
  const h = Buffer.alloc(4096);
  await fh.read(h, 0, h.length, 0);
  await fh.close();
  if (h.readUInt32BE(0) === 0x7f454c46) return [`linux-${{ 0x3e: "x64", 0xb7: "arm64" }[h.readUInt16LE(18)]}`];
  if (h.readUInt32LE(0) === 0xfeedfacf) return [`darwin-${MACHO[h.readUInt32LE(4)]}`];
  if (h.readUInt32BE(0) === 0xcafebabe) return Array.from({ length: h.readUInt32BE(4) }, (_, i) => `darwin-${MACHO[h.readUInt32BE(8 + 20 * i)]}`);
  if (h.toString("latin1", 0, 2) === "MZ") return [`win32-${{ 0x8664: "x64", 0xaa64: "arm64", 0x14c: "ia32" }[h.readUInt16LE(h.readUInt32LE(0x3c) + 4)]}`];
  return [];
}
async function mustBeFor(file, target) {
  const systems = await builtFor(file);
  if (!systems.includes(target)) throw new Error(`${file} is built for ${systems.join(" and ") || "no system it names"}, not ${target}.`);
}

/**
 * Put one system's ffmpeg, ffprobe and sharp parts into a packed app. platform and
 * arch are Node's names (darwin, win32, linux; x64, arm64); resources is the app's
 * resources folder, the one that holds app-server.
 */
export async function stageBinaries(platform, arch, resources) {
  const target = `${platform}-${arch}`;
  const exe = platform === "win32" ? ".exe" : "";

  const tag = (await manifest("ffmpeg-static"))["ffmpeg-static"]["binary-release-tag"];
  const release = `https://github.com/eugeneware/ffmpeg-static/releases/download/${tag}`;
  const ffmpeg = await download(`${release}/ffmpeg-${target}.gz`, join(cache, `ffmpeg-${tag}`, target, "ffmpeg"), gunzipSync);
  const licence = await download(`${release}/${target}.LICENSE`, join(cache, `ffmpeg-${tag}`, target, "ffmpeg.LICENSE"));
  const probe = `@ffprobe-installer/${target}`;
  const probeVersion = (await manifest("@ffprobe-installer/ffprobe")).optionalDependencies[probe];
  if (!probeVersion) throw new Error(`There is no ffprobe for ${target}.`);
  const ffprobe = join(await unpacked(probe, probeVersion), `ffprobe${exe}`);

  const bin = join(resources, "bin");
  await rm(bin, { recursive: true, force: true });
  await mkdir(bin, { recursive: true });
  for (const [name, src] of [["ffmpeg", ffmpeg], ["ffprobe", ffprobe]]) {
    await mustBeFor(src, target);
    await copyFile(src, join(bin, name + exe));
    await chmod(join(bin, name + exe), 0o755);
  }
  await copyFile(licence, join(bin, "ffmpeg.LICENSE"));

  // sharp loads @img/sharp-<system>, which links @img/sharp-libvips-<system> (on
  // Windows the one package holds both). This machine's go, the app's system's come in.
  const img = join(resources, "app-server/node_modules/@img");
  if (!existsSync(img)) return;
  for (const e of await readdir(img)) if (/^sharp-(libvips-)?(darwin|linux|linuxmusl|win32)-/.test(e)) await rm(join(img, e), { recursive: true });
  const versions = (await manifest("sharp")).optionalDependencies;
  for (const name of [`@img/sharp-${target}`, ...(platform === "win32" ? [] : [`@img/sharp-libvips-${target}`])]) {
    if (!versions[name]) throw new Error(`sharp has no ${name}.`);
    await cp(await unpacked(name, versions[name]), join(img, name.slice("@img/".length)), { recursive: true });
  }
  const lib = join(img, `sharp-${target}`, "lib");
  await mustBeFor(join(lib, (await readdir(lib)).find((f) => f.endsWith(".node"))), target);
}
