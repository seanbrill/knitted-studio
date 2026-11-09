// The claims check's shared half: the words a model is given, where a quote it answers with
// is on the pattern, and the fix put in its place.

import assert from "node:assert/strict";
import test from "node:test";
import { applyFix, claimTexts, claimWords, placeQuote, sameWords } from "../src/index.ts";

const text = (id, content, more = {}) => ({ id, kind: "text", x: 0, y: 0, w: 1, h: 0.2, locked: false, content, ...more });

test("the words checked are the texts knitted, in their order; an imported page's are its words", () => {
  const p = { stitches: [text("a", "Fresh bread"), { id: "s", kind: "shape" }, text("b", "  "), text("c", "Hidden", { style: { hidden: true } }), text("d", "Open Sundays", { slot: "body" })] };
  assert.deepEqual(claimTexts(p), [{ id: "a", slot: undefined, text: "Fresh bread" }, { id: "d", slot: "body", text: "Open Sundays" }]);
  assert.deepEqual(claimWords({ stitches: [], html: "<style>p{}</style><h1>Hi &amp; welcome</h1><p>Open&nbsp;daily</p>" }), { "": "Hi & welcome Open daily" });
  assert.ok(sameWords({ a: "x", b: "y" }, { b: "y", a: "x" }));
  assert.ok(!sameWords({ a: "x" }, { a: "x", b: "y" }));
  assert.ok(!sameWords({ a: "x" }, { a: "z" }));
});

test("a quote is placed in its text, and can be replaced only when it is there exactly once", () => {
  const words = { a: "Works with Apple Music and Spotify", b: "Plays every song. Plays every song, anywhere.", c: "Rated **#1** by “Wired”" };
  assert.deepEqual(placeQuote(words, "Apple Music and Spotify"), { stitchId: "a", replaceable: true });
  assert.deepEqual(placeQuote(words, "Plays every song"), { stitchId: "b", replaceable: false }, "twice");
  assert.deepEqual(placeQuote(words, "rated #1 by \"wired\""), { stitchId: "c", replaceable: false }, "copied loosely: found, to show");
  assert.equal(placeQuote(words, "Free forever"), null);
  assert.equal(placeQuote(words, "  "), null);
  assert.deepEqual(placeQuote({ "": "An imported page" }, "imported page"), { stitchId: null, replaceable: false }, "not in a text of its own");
});

test("a fix goes in the quote's place, as it is written, $ and all", () => {
  assert.equal(applyFix("Only $49 a year, billed yearly", "$49 a year", "$5 a month ($60 a year)"), "Only $5 a month ($60 a year), billed yearly");
  assert.equal(applyFix("a a", "a", "b"), null);
  assert.equal(applyFix("abc", "x", "y"), null);
});
