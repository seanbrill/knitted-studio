// Measure the theme instead of trusting it.
//
//   node scripts/check-contrast.mjs
//
// Reads the REAL tokens out of packages/ui/src/globals.css and checks every
// foreground/ground pair the design claims, in both themes. WCAG 2 contrast:
// 4.5:1 for text, 3:1 for UI. It also asserts that white on ember FAILS, since
// "never white on ember" is only a rule while it is true of this exact hex.

import { readFileSync } from "node:fs";
import { ratio } from "../packages/core/src/contrast.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CSS = join(dirname(fileURLToPath(import.meta.url)), "../packages/ui/src/globals.css");

/** Pull `--name: #hex` pairs out of one rule block. */
function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

export function loadThemes(css) {
  const day = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1];
  const night = css.match(/:root\[data-theme="night"\]\s*\{([\s\S]*?)\n\}/)?.[1];
  if (!day || !night) throw new Error("could not find the Day and Night blocks in globals.css");
  const base = tokens(day);
  return { day: base, night: { ...base, ...tokens(night) } };
}

export { ratio };

// [foreground token, ground token, minimum ratio, what it is]
const SURFACES = ["surface", "surface-raised", "surface-sunken"];
const PAIRS = [
  ...SURFACES.flatMap((g) => [
    ["ink", g, 4.5, "body text"],
    ["ink-muted", g, 4.5, "secondary text"],
    ["ember-ink", g, 4.5, "orange text"],
    ["danger", g, 4.5, "danger text"],
    ["success", g, 4.5, "success text"],
  ]),
  ["on-ember", "ember", 4.5, "text on the primary button"],
  ["on-red", "red", 4.5, "text on red"],
  ["on-red", "oxblood", 4.5, "text on oxblood"],
  ["on-rail", "rail", 4.5, "rail icons"],
  ["on-rail-muted", "rail", 4.5, "inactive rail icons"],
  ["rail-active-ink", "rail", 4.5, "active rail icon"],
  ["ember", "surface", 3, "focus ring and selection on the workspace"],
  ["ember", "surface-raised", 3, "focus ring on cards"],
];

/** Pairs the design says must NOT be used. They have to actually fail. */
const MUST_FAIL = [["#ffffff", "ember", 4.5, "white on ember"]];

// Colours composited over a surface: the orange tint (selection, hover, chips) is a
// translucent ember over whatever is behind it, and text on it must still read.
function over(fg, bg, alpha) {
  const mix = (i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * alpha + parseInt(bg.slice(i, i + 2), 16) * (1 - alpha));
  return "#" + [1, 3, 5].map((i) => mix(i).toString(16).padStart(2, "0")).join("");
}

export function check(css = readFileSync(CSS, "utf8")) {
  const themes = loadThemes(css);
  const problems = [];
  const rows = [];
  for (const [name, t] of Object.entries(themes)) {
    // Add the tinted grounds, at the strongest tint either theme uses.
    const tinted = Object.fromEntries(SURFACES.map((g) => [`${g}+tint`, over(t.ember, t[g], name === "night" ? 0.16 : 0.12)]));
    const tintPairs = SURFACES.flatMap((g) => [["ink", `${g}+tint`, 4.5, "text on a selected or hovered ground"], ["ember-ink", `${g}+tint`, 4.5, "orange text on the orange tint"]]);
    for (const [fg, bg, min, what] of [...PAIRS, ...tintPairs]) {
      const a = t[fg] ?? tinted[fg], b = t[bg] ?? tinted[bg];
      if (!a || !b) { problems.push(`${name}: token --${!a ? fg : bg} is missing or not a 6-digit hex`); continue; }
      const r = ratio(a, b);
      rows.push({ theme: name, fg, bg, r, min, what, ok: r >= min });
      if (r < min) problems.push(`${name}: ${what}: --${fg} ${a} on --${bg} ${b} is ${r.toFixed(2)}:1, needs ${min}:1`);
    }
    for (const [fg, bg, min, what] of MUST_FAIL) {
      const a = fg.startsWith("#") ? fg : t[fg], b = t[bg];
      const r = ratio(a, b);
      if (r >= min) problems.push(`${name}: "${what}" now PASSES at ${r.toFixed(2)}:1, so the rule against it is no longer true. Revisit the ember hex or the rule`);
    }
  }
  return { problems, rows };
}

if (process.argv[1] && process.argv[1].endsWith("check-contrast.mjs")) {
  const { problems, rows } = check();
  for (const r of rows) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.theme.padEnd(5)} ${r.r.toFixed(2).padStart(5)}:1  --${r.fg} on --${r.bg}  (${r.what})`);
  if (problems.length) { console.error("\n" + problems.join("\n")); process.exit(1); }
  console.log(`\n${rows.length} pairs pass, and white on ember still fails as the rule says.`);
}
