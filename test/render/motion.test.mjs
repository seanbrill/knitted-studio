// Motion in a REAL browser: does the engine's clock actually drive each preset?

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { activeSwatch, importYarn, knitPath, openStore, uploadTempPath } from "@knitted/core/node";
import { familiesUsed, pageFor } from "@knitted/render";
import { fontFaceCss, fontPath } from "@knitted/fonts";
import { openRenderer, runKnit } from "@knitted/engine";

const dir = mkdtempSync(join(tmpdir(), "knitted-motion-"));
const store = openStore(join(dir, "k.db"));
const renderer = await openRenderer();
after(async () => { await renderer.close(); });
const project = store.createProject({ name: "Motion", starter: "blank" });
const swatch = activeSwatch(store, project.id);
const clip = (id, preset, startMs, endMs, extra = {}) => ({ id, preset, startMs, endMs, ...extra });

const SIZE = { name: "T", w: 360, h: 640 };
function pat(stitches, motion, durationMs = 3000) {
  return { id: "p", projectId: project.id, name: "M", size: SIZE, durationMs, version: 1, updatedAt: "", stitches, motion };
}
async function at(pattern, times, evalFn, arg) {
  const file = join(dir, `p${Math.random()}.html`);
  // The same bundled fonts a real knit gets (runner.mjs), or text is measured in a fallback.
  const fontFaces = fontFaceCss(familiesUsed(pattern, swatch), (f) => pathToFileURL(fontPath(f)).href);
  writeFileSync(file, pageFor(pattern, { swatch, mode: "render", fontFaces }));
  const page = await renderer.newPage({ width: SIZE.w, height: SIZE.h });
  try {
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => window.__stage.ready());
    const out = [];
    for (const t of times) { await page.evaluate((x) => window.__stage.seek(x), t); out.push(await page.evaluate(evalFn, arg)); }
    return out;
  } finally { await page.close(); }
}
const box = { id: "b", kind: "shape", x: 0.2, y: 0.2, w: 0.5, h: 0.2, locked: false, style: { background: "#ff0000" } };
const styleOf = (prop) => getComputedStyle(document.querySelector('[data-stitch-id="b"]'))[prop];

test("fade-in: invisible before it starts, half way through, fully visible after", async () => {
  const [before, mid, after_] = await at(pat([box], { tracks: { b: [clip("a", "fade-in", 1000, 2000, { ease: "linear" })] } }), [0, 1500, 2500], styleOf, "opacity");
  assert.equal(before, "0", "waits in its starting state");
  assert.ok(Math.abs(Number(mid) - 0.5) < 0.02, `linear half way is about 0.5, got ${mid}`);
  assert.equal(after_, "1", "holds its end state");
});

test("seek is idempotent and order-independent: the clock is SET, not played", async () => {
  const m = { tracks: { b: [clip("a", "fade-in", 0, 1000, { ease: "linear" })] } };
  const [a, b, c] = await at(pat([box], m), [800, 200, 800], styleOf, "opacity");
  assert.equal(a, c, "going back and forth lands on the same value");
  assert.notEqual(a, b);
});

test("an animation composes with a stitch's own rotation instead of replacing it", async () => {
  const rotated = { ...box, style: { background: "#ff0000", rotate: 20 } };
  const [t0, t1] = await at(pat([rotated], { tracks: { b: [clip("a", "slide-up", 0, 1000, { ease: "linear" })] } }), [0, 1000], () => { const cs = getComputedStyle(document.querySelector('[data-stitch-id="b"]')); return [cs.transform, cs.translate]; });
  assert.notEqual(t0[0], "none", "the rotation is still there mid-animation");
  assert.match(t0[0], /matrix\(0\.93/, "20 degrees: cos is about 0.94");
  assert.notEqual(t0[1], "none", "and the slide offset is applied on top");
  assert.ok(t1[1] === "none" || /^0(px|%)?( 0(px|%)?)?$/.test(t1[1]), `settled: ${t1[1]}`);
});

test("type-on types one character at a time, in reading order, line by line, and nothing moves while it does", async () => {
  // Two lines' worth in a narrow box: the old sweep typed both lines at once and cut letters in half.
  const text = { id: "b", kind: "text", slot: "headline", x: 0.1, y: 0.1, w: 0.5, h: 0.4, locked: false, content: "Rate it *once*, keep it", style: { fontSize: 0.09, color: "#000000" } };
  const shown = () => [...document.querySelectorAll('[data-stitch-id="b"] .kc')].map((c) => (getComputedStyle(c).opacity === "1" ? c.textContent : "_")).join("");
  const where = () => [...document.querySelectorAll('[data-stitch-id="b"] .kc')].map((c) => `${Math.round(c.getBoundingClientRect().left)},${Math.round(c.getBoundingClientRect().top)}`).join(" ");
  const p = pat([text], { tracks: { b: [clip("a", "type-on", 1000, 2900)] } });
  const [before, early, mid, done] = await at(p, [999, 1100, 1950, 2900], shown);
  assert.equal(before, "_".repeat(17), "nothing before it starts (17 characters, spaces aside)");
  assert.equal(early, "R" + "_".repeat(16), "the first character first");
  assert.match(mid, /^[^_]+_+$/, `a run from the start, never a gap: ${mid}`);
  assert.equal(done, "Rateitonce,keepit", "everything by the end");
  const [a0, a1] = await at(p, [999, 2900], where);
  assert.equal(a0, a1, "every character holds its place: no reflow as it types");
  const [lines] = await at(p, [2900], () => new Set([...document.querySelectorAll('[data-stitch-id="b"] .kc')].map((c) => Math.round(c.getBoundingClientRect().top))).size);
  assert.ok(lines >= 2, "the text really wraps, so line-by-line was tested");
  const [accent] = await at(p, [2900], () => document.querySelector('[data-stitch-id="b"] em.accent')?.textContent);
  assert.equal(accent, "once", "the accent word is still the accent");
});

test("stitch-in on text brings in a word at a time, each rising into place, and lands by the end", async () => {
  const text = { id: "b", kind: "text", slot: "headline", x: 0.1, y: 0.1, w: 0.8, h: 0.3, locked: false, content: "Same library. Two drives.", style: { fontSize: 0.08, color: "#000000" } };
  const words = () => [...document.querySelectorAll('[data-stitch-id="b"] .kw')].map((w) => Number(getComputedStyle(w).opacity).toFixed(2)).join(" ");
  const [before, mid, done] = await at(pat([text], { tracks: { b: [clip("a", "stitch-in", 1000, 2000)] } }), [999, 1450, 2000], words);
  // Three pieces: "Two" starts a sentence, so it keeps to "drives." and rises in with it.
  assert.equal(before, "0.00 0.00 0.00");
  const m = mid.split(" ").map(Number);
  assert.ok(m[0] > m[2] && m[0] > 0.5, `earlier words are further in: ${mid}`);
  assert.equal(done, "1.00 1.00 1.00");
  const [clipPath] = await at(pat([text], { tracks: { b: [clip("a", "stitch-in", 1000, 2000)] } }), [1500], () => getComputedStyle(document.querySelector('[data-stitch-id="b"]')).clipPath);
  assert.equal(clipPath, "none", "no hard cut through the letters");
});

test("MOTION KNIT: two runs give identical frames, the picture moves, and lint warnings reach the job", async () => {
  const p = store.createPattern(project.id, { name: "Moving", size: SIZE, stitches: [
    { id: "bg", kind: "shape", x: 0, y: 0, w: 1, h: 1, locked: false, style: { background: "$color.primary" } },
    { id: "h", kind: "text", slot: "headline", x: 0.1, y: 0.4, w: 0.8, h: 0.2, locked: false, content: "Make it knitted", style: { fontFamily: "$font.display", fontSize: 0.14, fontWeight: 800, color: "$color.text" } },
  ] });
  store.apply(p.id, { type: "setMeta", durationMs: 1500 }, "human");
  store.apply(p.id, { type: "setMotion", stitchId: "h", clips: [clip("a", "slide-up", 100, 700), clip("o", "fade-out", 1000, 1400)] }, "human");
  const run = async () => { const job = store.createJob("knit", project.id, {}); return runKnit(store, { jobId: job.id, projectId: project.id, patternId: p.id, params: { reuse: false }, renderer }); };
  const a = await run(), b = await run();
  const md5 = (f) => execFileSync("ffmpeg", ["-v", "error", "-i", f, "-f", "framemd5", "-"]).toString().split("\n").filter((l) => /^0,/.test(l)).map((l) => l.split(",").pop().trim());
  const fa = md5(knitPath(store, a.knits[0]));
  assert.equal(fa.length, 45, "1.5 seconds at 30 fps");
  assert.deepEqual(fa, md5(knitPath(store, b.knits[0])));
  assert.notEqual(fa[0], fa[20]);
  assert.ok(a.progress.units[0].issues.some((i) => i.code === "text-too-brief"), "the readability warning reached the Knit report");
});

test("a sliding stitch is on a layer only while it slides: before and after, it is drawn in place and as sharp as a still", async () => {
  const layers = await at(pat([box], { tracks: { b: [clip("s", "slide-up", 1000, 2000)] } }), [500, 1500, 2500, 1500], () => document.querySelector('[data-stitch-id="b"]').style.willChange);
  assert.deepEqual(layers, ["", "translate", "", "translate"]);
  const [faded] = await at(pat([box], { tracks: { b: [clip("f", "fade-in", 1000, 2000)] } }), [1500], () => document.querySelector('[data-stitch-id="b"]').style.willChange);
  assert.equal(faded, "", "only slides get a layer");
});

test("FOOTAGE: a 30 fps clip in a 30 fps knit shows a new frame every frame, none twice", async () => {
  // Frames are asked for at whole milliseconds (33, 67, 100, 133...). Footage frame 1 starts at
  // 33.33 ms, so the browser showed frame 0 again at 33 ms, every third frame: a frame twice,
  // then one skipped.
  const src = join(dir, "count.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=30", "-t", "2", "-pix_fmt", "yuv420p", "-c:v", "libx264", src]);
  const tmp = uploadTempPath(store, project.id);
  mkdirSync(dirname(tmp), { recursive: true });
  writeFileSync(tmp, readFileSync(src));
  const clipYarn = (await importYarn(store, project.id, tmp, "count.mp4", { name: "Count" })).yarn;
  // At Story size: at a small size the browser happened to show the right frame anyway.
  const p = store.createPattern(project.id, { name: "Footage", size: { name: "Story", w: 1080, h: 1920 }, stitches: [
    { id: "v", kind: "video", x: 0, y: 0, w: 1, h: 1, locked: false, yarnId: clipYarn.id, style: { fit: "cover" } },
  ] });
  // Nothing else moves: an animation on the page hid the repeats.
  store.apply(p.id, { type: "setMeta", durationMs: 1500 }, "human");
  const job = store.createJob("knit", project.id, {});
  const r = await runKnit(store, { jobId: job.id, projectId: project.id, patternId: p.id, params: { reuse: false }, renderer });
  // A frame shown twice comes back from the encoder nearly, not exactly, the same: measure the change.
  const W = 90, H = 160;
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", knitPath(store, r.knits[0]), "-vf", `scale=${W}:${H},format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 });
  const n = raw.length / (W * H);
  assert.equal(n, 45);
  const change = Array.from({ length: n - 1 }, (_, i) => { let d = 0; for (let j = 0; j < W * H; j++) d += Math.abs(raw[(i + 1) * W * H + j] - raw[i * W * H + j]); return d / (W * H); });
  const twice = change.filter((d) => d < 0.2).length;
  assert.equal(twice, 0, `${twice} frames repeated the one before (change: ${change.map((d) => d.toFixed(1)).join(" ")})`);
});

test("an entrance then an exit on one stitch: hidden before, shown between, gone after", async () => {
  const two = { tracks: { b: [clip("a", "fade-in", 500, 1000, { ease: "linear" }), clip("o", "fade-out", 2000, 2500, { ease: "linear" })] } };
  assert.deepEqual(await at(pat([box], two), [0, 1500, 2800], styleOf, "opacity"), ["0", "1", "0"]);
});

test("a pop on left-aligned text grows from where the words are, not from the middle of the box", async () => {
  // In real knits a pop on a wide left-aligned headline slid the line sideways as it grew.
  const t = { id: "b", kind: "text", x: 0.05, y: 0.3, w: 0.9, h: 0.2, locked: false, content: "Hi", style: { fontSize: 0.1, textAlign: "left" } };
  const left = () => document.querySelector('[data-stitch-id="b"] .t').getBoundingClientRect().left;
  const [mid, end] = await at(pat([t], { tracks: { b: [clip("a", "pop", 0, 1000, { ease: "linear" })] } }), [300, 1000], left);
  assert.ok(Math.abs(mid - end) < 1, `the first letter stays put while it grows: ${mid} then ${end}`);
});

test("code keeps its indentation, and a headline is balanced, never one word alone on its last line", async () => {
  const code = { id: "b", kind: "text", x: 0.05, y: 0.1, w: 0.9, h: 0.3, locked: false, content: "if (ok) {\n    ship();\n}", style: { fontFamily: "$font.mono", fontSize: 0.05 } };
  const head = { id: "h", kind: "text", x: 0.05, y: 0.5, w: 0.9, h: 0.4, locked: false, content: "Rate every song you hear at the gig tonight", style: { fontSize: 0.09 } };
  const [r] = await at(pat([code, head], null), [0], () => {
    const lineStarts = (el) => { const range = document.createRange(); const xs = new Map(); const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = walk.nextNode())) for (let i = 0; i < n.length; i++) { if (!/\S/.test(n.data[i])) continue; range.setStart(n, i); range.setEnd(n, i + 1); const b = range.getBoundingClientRect(); const y = Math.round(b.top); if (!xs.has(y)) xs.set(y, { x: b.left, words: 0 }); } return [...xs.values()]; };
    const words = (el) => { const range = document.createRange(); const lines = new Map(); const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = walk.nextNode())) for (const m of n.data.matchAll(/\S+/g)) { range.setStart(n, m.index); range.setEnd(n, m.index + 1); const y = Math.round(range.getBoundingClientRect().top); lines.set(y, (lines.get(y) ?? 0) + 1); } return [...lines.values()]; };
    return { code: lineStarts(document.querySelector('[data-stitch-id="b"] .t')).map((l) => l.x), head: words(document.querySelector('[data-stitch-id="h"] .t')) };
  });
  assert.equal(r.code.length, 3);
  assert.ok(r.code[1] - r.code[0] > 20, `the indented line starts further in: ${r.code.join(", ")}`);
  assert.ok(r.head.length > 1 && r.head.at(-1) > 1, `no word alone on the last line: ${r.head.join(" / ")} words a line`);
  assert.ok(Math.max(...r.head) - Math.min(...r.head) <= 1, `and the lines are even: ${r.head.join(" / ")}`);
});

test("shrink to fit sizes text as it lands, not around words still waiting to rise in", async () => {
  const t = (motion) => pat([{ id: "b", kind: "text", x: 0.05, y: 0.4, w: 0.9, h: 0.08, locked: false, content: "Rate it", style: { fontSize: 0.12, fit: "shrink", verticalAlign: "middle" } }], motion);
  const size = () => getComputedStyle(document.querySelector('[data-stitch-id="b"]')).fontSize;
  const [still] = await at(t(null), [0], size);
  const [moving, later] = await at(t({ tracks: { b: [clip("a", "stitch-in", 0, 800)] } }), [0, 400], size);
  assert.equal(moving, still, "the same size as without the motion");
  assert.equal(later, still);
});

test("a short word that starts a sentence is never left alone at the end of a line, typed, stitched in or still", async () => {
  // A real story read "5 GB. No card. It / never charges."
  const together = () => { const tops = {}; const range = document.createRange(); for (const el of document.querySelectorAll(".stitch .t")) { const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; const chars = []; while ((n = walk.nextNode())) for (let i = 0; i < n.length; i++) { if (!/\S/.test(n.data[i]) || n.data[i] === " ") continue; range.setStart(n, i); range.setEnd(n, i + 1); chars.push([n.data[i], Math.round(range.getBoundingClientRect().top)]); } const s = chars.map((c) => c[0]).join(""); const at = (i) => chars[i][1]; tops[el.parentElement.dataset.stitchId] = [at(s.indexOf("5")) === at(s.indexOf("GB")), at(s.indexOf("It")) === at(s.indexOf("never"))]; } return tops; };
  const widths = Array.from({ length: 12 }, (_, i) => 0.45 + i * 0.045);
  for (const motion of [null, "stitch-in", "type-on"]) {
    const stitches = widths.map((w, i) => ({ id: `w${i}`, kind: "text", x: 0.02, y: 0.02 + i * 0.08, w, h: 0.08, locked: false, content: "5 GB. No card. It never charges.", style: { fontSize: 0.05, fontWeight: 800 } }));
    const m = motion ? { tracks: Object.fromEntries(stitches.map((s) => [s.id, [clip(`c${s.id}`, motion, 0, 1800)]])) } : null;
    const [r] = await at(pat(stitches, m), [2000], together);
    for (const [id, [gb, it]] of Object.entries(r)) { assert.ok(gb, `${motion ?? "still"} ${id}: "5 GB" kept together`); assert.ok(it, `${motion ?? "still"} ${id}: "It never" kept together`); }
  }
});
