// A style that nothing draws. StitchSchema.style takes any key, so `fontsize` was
// stored, reported clean by check_pattern, and never drawn: the silent no-op the lock
// rule refuses everywhere else. The warning is only as good as its list of keys, so
// the list is held to the one place that reads them, the renderer.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FALLBACK_SWATCH, STYLE_KEYS, preflight } from "../src/index.ts";
import { socialStarterPack } from "../src/starters.ts";
import { BUILTIN_PARTS } from "../src/builtin-parts.ts";

const pattern = (style) => ({ id: "pt", projectId: "pj", name: "P", size: { name: "Square", w: 1080, h: 1080 }, version: 1, stitches: [{ id: "st_1", kind: "text", slot: "headline", x: 0.1, y: 0.1, w: 0.8, h: 0.2, locked: false, content: "Hello", style }] });
const unknownStyle = (style) => preflight(pattern(style), FALLBACK_SWATCH, { yarn: {} }).filter((i) => i.code === "unknown-style");

test("the style keys checked are exactly the ones the renderer reads", () => {
  const src = readFileSync(join(import.meta.dirname, "../../render/src/pure.mjs"), "utf8");
  const read = new Set([...src.matchAll(/\bst\.([a-zA-Z]+)/g), ...src.matchAll(/resolveStyle\([^)]*\)\.([a-zA-Z]+)/g)].map((m) => m[1]));
  assert.ok(read.size > 20, "the scan found the renderer's reads");
  assert.deepEqual([...STYLE_KEYS].sort(), [...read].sort());
});

test("a style nothing draws is a warning, with the key that was meant", () => {
  assert.deepEqual(unknownStyle({ fontSize: 0.05, color: "$color.text" }), []);
  const [w] = unknownStyle({ fontSize: 0.05, fontsize: 0.08, nonsenseKey: "x" });
  assert.equal(w.slot, "headline");
  assert.match(w.message, /nothing draws: fontsize, nonsenseKey/);
  assert.match(w.message, /Did you mean fontSize for fontsize\?/);
  assert.match(unknownStyle({ letterspacing: 0.1 })[0].message, /letterSpacing for letterspacing/);
});

test("nothing knitted ships uses a style nothing draws", () => {
  const styles = [];
  const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { if (k === "style" && v && typeof v === "object") styles.push(v); else walk(v); } };
  walk(socialStarterPack()); walk(BUILTIN_PARTS);
  assert.ok(styles.length > 10, "the walk found the starters' styles");
  const stray = [...new Set(styles.flatMap(Object.keys))].filter((k) => !STYLE_KEYS.includes(k));
  assert.deepEqual(stray, []);
});
