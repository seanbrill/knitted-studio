// A page with no [param] in its path is drawn once, when the app is built. If anything it
// shows reads the address (useSearchParams), Next.js refuses to build unless that is inside a
// <Suspense>, and only the production build says so: the dev server, and so every end-to-end
// test, draws it fine. 0.1.19 failed to publish this way (/library). This finds it before a push.

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const STUDIO = join(import.meta.dirname, "..", "apps", "studio");
const APP = join(STUDIO, "app");

function pages(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n.startsWith("api") && dir === APP ? [] : pages(p);
    return n === "page.tsx" ? [p] : [];
  });
}

/** The file an import names, if it is one of the studio's own. */
function resolve(from, spec) {
  const base = spec.startsWith("@/") ? join(STUDIO, spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null;
  if (!base) return null;
  return [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")].find((f) => existsSync(f) && statSync(f).isFile()) ?? null;
}

/**
 * Whether a file, or anything of the studio's it imports, reads the address outside a
 * <Suspense>. A file that draws one is taken to hold what it imports inside it, as AskView does.
 */
function readsAddress(file, seen = new Set()) {
  if (seen.has(file)) return null;
  seen.add(file);
  const src = readFileSync(file, "utf8");
  if (/<Suspense\b/.test(src)) return null;
  if (/\buseSearchParams\s*\(/.test(src)) return file;
  for (const m of src.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    const f = resolve(file, m[1]);
    const hit = f && readsAddress(f, seen);
    if (hit) return hit;
  }
  return null;
}

test("a page drawn at build time that reads the address wraps it in Suspense", () => {
  const bad = [];
  for (const page of pages(APP)) {
    const route = relative(APP, dirname(page));
    if (route.includes("[")) continue; // drawn when asked for, not at build time
    const reader = readsAddress(page);
    if (reader) bad.push(`${relative(STUDIO, page)} (through ${relative(STUDIO, reader)})`);
  }
  assert.deepEqual(bad, [], "Wrap the view in <Suspense> in these pages, as app/(app)/stock/page.tsx does");
});

test("the check can fail: a view that reads the address with no Suspense over it is found", () => {
  assert.ok(readsAddress(join(STUDIO, "components", "LibraryView.tsx")), "the Library's view reads the address, through Yarn");
  assert.equal(readsAddress(join(APP, "(app)", "library", "page.tsx")), null, "and its page holds it in a Suspense");
});
