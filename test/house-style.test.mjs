// House style: no em dashes, anywhere. Carried over from notch.fm, where a test
// enforces it. Use a comma, a colon, or a full stop.

import assert from "node:assert/strict";
import test from "node:test";
import { EM_DASH, EN_DASH, findEmDashes, projectFiles, read } from "./lib/scan.mjs";

test("the detector finds an em dash (it can fail)", () => {
  const hits = findEmDashes(`fine\nnot fine ${EM_DASH} here\nfine`);
  assert.deepEqual(hits.map((h) => h.line), [2]);
  assert.equal(findEmDashes(`hyphen - and en dash ${EN_DASH} are allowed`).length, 0);
});

test("no file in the project contains an em dash", () => {
  const offenders = [];
  for (const f of projectFiles()) {
    for (const h of findEmDashes(read(f))) offenders.push(`${f}:${h.line}: ${h.text.trim().slice(0, 80)}`);
  }
  assert.deepEqual(offenders, [], `em dashes found:\n${offenders.join("\n")}`);
});
