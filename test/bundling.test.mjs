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
