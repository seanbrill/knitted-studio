// electron-builder never copies a folder called node_modules into extraResources,
// and the server's traced dependencies live in exactly that. Copy them by hand, after
// packing, into wherever this platform keeps resources.
// The shell's own tooling is never needed by the server and electron alone is 260MB.
const SKIP = new Set(["electron", "@electron-internal", "electron-builder", "app-builder-bin", "typescript", "ffmpeg-static", "@ffprobe-installer"]);
import { cp, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
};
