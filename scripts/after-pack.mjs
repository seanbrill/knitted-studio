// electron-builder never copies a folder called node_modules into extraResources,
// and the server's traced dependencies live in exactly that. Copy them by hand, after
// packing, into wherever this platform keeps resources. Then the app gets its own
// system's ffmpeg, ffprobe and sharp (desktop-binaries.mjs), since the ones npm
// installed fit only this machine, and a Mac packs the Windows and Linux apps too.
// Last, a Mac app packed anywhere but a Mac is signed (mac-sign.mjs): electron-builder
// signs only on a Mac, and nothing changes the app between this and its .zip.
// The shell's own tooling is never needed by the server and electron alone is 260MB.
const SKIP = new Set(["electron", "@electron-internal", "electron-builder", "app-builder-bin", "typescript", "ffmpeg-static", "@ffprobe-installer"]);
import { cp, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import builder from "electron-builder";
import { stageBinaries } from "./desktop-binaries.mjs";
import { signMacApp } from "./mac-sign.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export default async function afterPack(ctx) {
  const resources = ctx.electronPlatformName === "darwin"
    ? join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app/Contents/Resources`)
    : join(ctx.appOutDir, "resources");
  const src = join(here, "..", "dist", "app");
  const found = [];
  const walk = async (rel) => {
    for (const e of await readdir(join(src, rel), { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const r = join(rel, e.name);
      if (e.name === "node_modules") found.push(r); else if (rel.split("/").length < 3) await walk(r);
    }
  };
  await walk("");
  for (const rel of found) await cp(join(src, rel), join(resources, "app-server", rel), { recursive: true, dereference: true, filter: (p) => !(p.includes("node_modules") && SKIP.has(p.split("node_modules/").pop().split("/")[0]) && !p.endsWith("node_modules")) });
  console.log(`  • copied ${found.length} node_modules folder(s) into app-server`);
  const system = `${ctx.electronPlatformName}-${builder.Arch[ctx.arch]}`;
  await stageBinaries(ctx.electronPlatformName, builder.Arch[ctx.arch], resources);
  console.log(`  • ffmpeg, ffprobe and sharp for ${system}`);
  if (ctx.electronPlatformName === "darwin" && process.platform !== "darwin") {
    await signMacApp(join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`));
    console.log(`  • signed the ${system} app ad-hoc with rcodesign, as a Mac signs it`);
  }
};
