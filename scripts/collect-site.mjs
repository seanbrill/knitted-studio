// Copy the static site export to dist/site.
//
// `next build` with output:"export" writes apps/site/out. The two builds each
// have one well-known home at the repo root so CI, deploy scripts and the
// verifier never need to know which app produced what.

import { cp, rm, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "dist", "site");
await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(join(root, "apps/site/out"), dest, { recursive: true });
console.log("dist/site ready");
