// A wait that cannot fail. Given an async check, Playwright's waitForFunction returns
// after the check's first answer, true or not. Twenty "the edit was saved" waits in the
// e2e suite were written that way: each passed at once, and a test that went on to read
// the server failed whenever the save had not landed yet. serverHas, in
// test/e2e/harness.mjs, polls the server from the test instead.

import assert from "node:assert/strict";
import test from "node:test";
import { findAsyncWaits, projectFiles, read } from "./lib/scan.mjs";

// Built in pieces, so this file does not itself contain what it looks for.
const WAIT = "waitForFunction(";

test("the detector finds an async check handed to waitForFunction (it can fail)", () => {
  const text = [`await page.${WAIT}() => document.title === "x");`, `await page.${WAIT}async ({ id }) => (await fetch(id)).ok, { id });`, `await page.${WAIT}`, "  async function () { return false; });"].join("\n");
  assert.deepEqual(findAsyncWaits(text).map((h) => h.line), [2, 3]);
});

test("no test hands waitForFunction an async check", () => {
  const offenders = [];
  for (const f of projectFiles().filter((x) => /\.(m?js|ts)$/.test(x))) {
    for (const h of findAsyncWaits(read(f))) offenders.push(`${f}:${h.line}: ${h.text}`);
  }
  assert.deepEqual(offenders, [], `use serverHas from test/e2e/harness.mjs instead:\n${offenders.join("\n")}`);
});
