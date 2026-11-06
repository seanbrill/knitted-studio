// Code the studio's bundler changes on its way into the server.
//
// Every import from a link failed in the desktop app with "Transform is not a
// constructor", while every test on source passed: `new (await import("node:stream")).Transform`
// is fine in Node, but webpack hands a dynamic import a stand-in namespace, and for
// node:stream, whose export is a function, that has no Transform. Import built-ins at
// the top of the file instead. This reads the source, so it needs no build to catch it.

import assert from "node:assert/strict";
import test from "node:test";
import { findDynamicNodeImports, projectFiles, read } from "./lib/scan.mjs";

// What the bundler takes in: the packages' source and the two Next apps. Scripts,
// tests and the Electron shell run on Node as they are.
const bundled = (f) => /\.(m?js|tsx?)$/.test(f)
  && (/^packages\/[^/]+\/src\//.test(f) || /^apps\/(studio|site)\/(app|lib|components)\//.test(f));

test("the detector finds a built-in imported at run time (it can fail)", () => {
  const bad = [
    `const limit = new (await import("node:stream")).Transform({ transform(c, _e, cb) { cb(null, c); } });`,
    `const { pipeline } = await import('node:stream/promises');`,
    `import ( "node:fs" ).then((fs) => fs.statSync(p));`,
  ];
  assert.deepEqual(findDynamicNodeImports(bad.join("\n")).map((h) => h.line), [1, 2, 3]);
  const fine = [`import { Transform } from "node:stream";`, `await import("playwright");`, `await import(/* webpackIgnore: true */ "node:fs");`];
  assert.deepEqual(findDynamicNodeImports(fine.join("\n")), []);
});

test("no bundled source imports a Node built-in at run time", () => {
  const files = projectFiles().filter(bundled);
  assert.ok(files.some((f) => f === "packages/core/src/yarn.ts"), "the sweep covers the packages' source");
  assert.ok(files.some((f) => f.startsWith("apps/studio/app/")), "and the studio's routes");
  const offenders = files.flatMap((f) => findDynamicNodeImports(read(f)).map((h) => `${f}:${h.line}: ${h.text.slice(0, 100)}`));
  assert.deepEqual(offenders, [], `import these at the top of the file instead:\n${offenders.join("\n")}`);
});

// Every bundled font failed in the desktop app with ENOENT: in the server, `import.meta.url`
// is not where the file is but where it was when the server was BUILT, which the bundler
// writes in, and the pipeline builds in a folder no one else has. A file found from it has
// to be looked for from where the server runs as well (process.cwd(), apps/studio).
test("bundled source that finds files from import.meta.url also looks where the server runs", () => {
  // The MCP server for Claude Code runs on Node as it is, so its import.meta.url is true.
  const asItIs = new Set(["packages/mcp/src/server.mjs"]);
  const files = projectFiles().filter(bundled).filter((f) => !asItIs.has(f));
  const offenders = files.filter((f) => /import\.meta\.url/.test(read(f)) && !/process\.cwd\(\)/.test(read(f)));
  assert.ok(files.includes("packages/fonts/src/index.mjs"), "the sweep covers the fonts package");
  assert.deepEqual(offenders, [], `these find files only where they were built:\n${offenders.join("\n")}`);
});
