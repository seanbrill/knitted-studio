// Motion in a REAL browser: does the engine's clock actually drive each preset?

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { activeSwatch, knitPath, openStore } from "@knitted/core/node";
import { pageFor } from "@knitted/render";
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
  writeFileSync(file, pageFor(pattern, { swatch, mode: "render" }));
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

test("stitch-in reveals in discrete rows from the top", async () => {
  const text = { id: "b", kind: "text", slot: "headline", x: 0.1, y: 0.1, w: 0.8, h: 0.3, locked: false, content: "Rows", style: { fontSize: 0.2, color: "#000000" } };
  const cuts = await at(pat([text], { tracks: { b: [clip("a", "stitch-in", 0, 1000)] } }), [0, 250, 500, 750, 1000], () => getComputedStyle(document.querySelector('[data-stitch-id="b"]')).clipPath);
  assert.equal(new Set(cuts).size >= 4, true, `distinct reveal steps: ${cuts.join(" | ")}`);
  assert.match(cuts[4], /inset\(0%|inset\(0px/);
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
