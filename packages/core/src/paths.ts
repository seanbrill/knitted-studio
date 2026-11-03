// Where knitted keeps things on disk. The ONE place that knows.
//
// Desktop-readiness rule 1: every filesystem location comes from here. The
// Electron shell sets KNITTED_HOME to its userData directory before anything
// else loads, so nothing downstream has to know Electron exists; dev and the
// CLI fall back to ~/.knitted-studio. Paths stored in the database are always
// RELATIVE to one of these roots, never absolute.

import { homedir } from "node:os";
import { join } from "node:path";

export interface KnittedPaths {
  root: string;
  db: string;
  projectsDir: string;
  cacheDir: string;
  modelsDir: string;
  projectDir(id: string): string;
  yarnDir(id: string): string;
  outDir(id: string): string;
}

export function paths(env: Record<string, string | undefined> = process.env): KnittedPaths {
  const root = env.KNITTED_HOME || join(homedir(), ".knitted-studio");
  const projectsDir = join(root, "projects");
  return {
    root,
    db: join(root, "knitted.db"),
    projectsDir,
    cacheDir: join(root, "cache"),
    modelsDir: join(root, "models"),
    projectDir: (id) => join(projectsDir, id),
    yarnDir: (id) => join(projectsDir, id, "yarn"),
    outDir: (id) => join(projectsDir, id, "knits"),
  };
}
