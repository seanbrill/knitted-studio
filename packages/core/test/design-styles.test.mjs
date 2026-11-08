// What a sheet is drawn with, read from its code, for the style guide in its download.

import assert from "node:assert/strict";
import test from "node:test";
import { designStyles, FALLBACK_SWATCH } from "../src/index.ts";

const frame = (name, css, html = "<main></main>") => ({ id: name, name, width: 1440, html, css });
const sheet = { sections: [{ id: "s1", name: "Pages", frames: [
  frame("Home", ".hero{background:var(--color-primary);color:var(--color-on-primary);padding:96px 120px;border-radius:var(--radius-lg)}h1{font:700 56px/1.1 var(--font-display)}p{font-size:18px;margin:0 0 24px}.card{box-shadow:0 8px 24px rgba(0,0,0,.12);border-radius:14px;background:#FFF}"),
  frame("Menu", "h1{font-family:var(--font-display);font-size:56px;font-weight:600;color:var(--color-text)}.tag{color:#e0891a;background:var(--color-neutral, #eee);gap:8px}", '<p style="color:#e0891a">Hot</p>'),
] }] };

test("the brand's tokens, with how often each is used and where", () => {
  const s = designStyles(sheet, FALLBACK_SWATCH);
  const primary = s.colors.find((c) => c.variable === "--color-primary");
  assert.match(primary.value, /^#[0-9a-f]{6}$/i);
  assert.equal(primary.uses, 1);
  assert.deepEqual(primary.frames, ["Home"]);
  assert.deepEqual(s.colors.find((c) => c.variable === "--color-accent").frames, [], "a colour no frame uses is still shown");
  assert.equal(s.fonts.find((f) => f.variable === "--font-display").uses, 2);
  assert.equal(s.radii.find((r) => r.variable === "--radius-lg").uses, 1);
});

test("values written by hand: colours not through a token, type sizes and weights, corners, spacing and shadows", () => {
  const s = designStyles(sheet, FALLBACK_SWATCH);
  // #FFF and #fff are one colour; a var()'s fallback is not a colour the sheet uses.
  assert.deepEqual(s.otherColors.map((c) => c.value).sort(), ["#e0891a", "#ffffff", "rgba(0,0,0,.12)"].sort());
  assert.deepEqual(s.otherColors.find((c) => c.value === "#e0891a").frames, ["Menu"]);
  assert.equal(s.otherColors.find((c) => c.value === "#e0891a").uses, 2, "in the CSS and in the HTML");
  assert.deepEqual(s.sizes.map((z) => z.value), ["56px", "18px"], "largest first, a shorthand's size too");
  assert.equal(s.sizes[0].uses, 2);
  assert.deepEqual(s.weights.map((w) => w.value), ["700", "600"]);
  assert.deepEqual(s.otherRadii.map((r) => r.value), ["14px"], "a corner through a token is not counted again");
  assert.deepEqual(s.spacing.map((p) => p.value), ["8px", "24px", "96px", "120px"]);
  assert.deepEqual(s.shadows.map((h) => h.value), ["0 8px 24px rgba(0,0,0,.12)"]);
});

test("a colour written out that is one of the brand's says which token it is", () => {
  const hex = FALLBACK_SWATCH.colors.find((c) => c.role === "primary").hex;
  const s = designStyles({ sections: [{ id: "s", name: "S", frames: [frame("A", `a{color:${hex.toUpperCase()}}`)] }] }, FALLBACK_SWATCH);
  assert.equal(s.otherColors[0].sameAs, "--color-primary");
});
