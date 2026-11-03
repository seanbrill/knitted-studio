// Desktop-readiness rule 2 and decision D10: nothing loads from a third party.
// The app must work offline, and a visit to the site must not leak to anyone.
// Fonts are bundled; this stays true only if something fails when it is not.

import assert from "node:assert/strict";
import test from "node:test";
import { findCdnReferences, projectFiles, read } from "./lib/scan.mjs";

test("the detector finds each kind of CDN reference (it can fail)", () => {
  for (const bad of [
    '<link href="https://fonts.googleapis.com/css2?family=Geist" rel="stylesheet" />',
    '<link rel="stylesheet" href="https://example.com/a.css">',
    '<script src="https://cdn.example.com/x.js"></script>',
    '@import url("https://fonts.gstatic.com/x.css");',
    "const u = 'https://unpkg.com/react';",
  ]) {
    assert.equal(findCdnReferences(bad).length, 1, `not detected: ${bad}`);
  }
  assert.equal(findCdnReferences('<a href="https://github.com/x">source</a>').length, 0, "plain links are fine");
});

test("no source file loads anything from a CDN or Google Fonts", () => {
  const scanned = projectFiles().filter(
    // Shipped code only: test fixtures (a hostile SVG that imports a remote stylesheet,
    // say) legitimately contain the very things this guard exists to keep out.
    (f) => /^(apps|packages)\//.test(f) && !/\/test\//.test(f) && /\.(tsx?|mjs|css|html)$/.test(f)
  );
  assert.ok(scanned.length > 5, "the scan found suspiciously few files");
  const offenders = [];
  for (const f of scanned) for (const h of findCdnReferences(read(f))) offenders.push(`${f}:${h.line}: ${h.text.slice(0, 90)}`);
  assert.deepEqual(offenders, [], `third-party loads found:\n${offenders.join("\n")}`);
});
