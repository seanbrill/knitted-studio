import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ok, route, store } from "@/lib/server";

export const dynamic = "force-dynamic";

function size(dir: string): number {
  let total = 0;
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      total += e.isDirectory() ? size(p) : statSync(p).size;
    }
  } catch {}
  return total;
}

export const GET = route(() => {
  const s = store();
  return ok({ root: s.paths.root, bytes: size(s.paths.root), projects: s.listProjects().length });
});
