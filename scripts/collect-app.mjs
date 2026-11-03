// Assemble the studio's standalone server into dist/app.
//
// Next's standalone output is a server.js plus a traced node_modules, but it
// deliberately leaves out static assets and public/. Without copying them the
// server starts and then 404s on every script and stylesheet, which is a
// failure that only shows up in a browser.

import { cp, rm, mkdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const studio = join(root, "apps/studio");
const standalone = join(studio, ".next/standalone");
const dest = join(root, "dist", "app");

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
// outputFileTracingRoot is the repo root, so the app sits at apps/studio inside.
await cp(standalone, dest, { recursive: true });
await cp(join(studio, ".next/static"), join(dest, "apps/studio/.next/static"), { recursive: true });
const pub = join(root, "public");
if (await stat(pub).then(() => true, () => false)) {
  await cp(pub, join(dest, "apps/studio/public"), { recursive: true });
}
console.log("dist/app ready: node dist/app/apps/studio/server.js");
