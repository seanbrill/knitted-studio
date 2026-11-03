// Parts through a REAL browser: do they draw, scale, animate the same way every time,
// and does editing one re-render everything that uses it?

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createPart, knitPath, listParts, openStore, updatePart } from "@knitted/core/node";
import { SIZES } from "@knitted/core";
import { openRenderer, runKnit } from "@knitted/engine";

const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-partsr-")), "k.db"));
const renderer = await openRenderer();
after(async () => { await renderer.close(); });
const project = store.createProject({ name: "Parts render", starter: "blank" });
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const lower = () => listParts(store, project.id).find((p) => p.name === "Lower third");

async function knit(patternId, params = {}) {
  const job = store.createJob("knit", project.id, {});
  return runKnit(store, { jobId: job.id, projectId: project.id, patternId, params: { reuse: false, ...params }, renderer });
}
function patternWith(overrides = {}, w = 0.8) {
  const part = lower();
  const p = store.createPattern(project.id, { name: `P${Math.random()}`, size: SIZES[2], stitches: [
    { id: "bg", kind: "shape", x: 0, y: 0, w: 1, h: 1, locked: false, style: { background: "#ffffff" } },
    { id: "i", kind: "part", slot: "lower_third", x: 0.1, y: 0.4, w, h: (w * 1080) / part.aspect / 1080, locked: false, partId: part.id, partVersion: part.version, overrides, partSlots: part.slots },
  ] });
  return p;
}

test("a Part instance draws, and its slot values change the pixels", async () => {
  const a = (await knit(patternWith({ name: "Ada Lovelace" }).id)).knits[0];
  const b = (await knit(patternWith({ name: "Grace Hopper" }).id)).knits[0];
  assert.notEqual(sha(knitPath(store, a)), sha(knitPath(store, b)));
  const m = await sharp(knitPath(store, a)).metadata();
  assert.deepEqual([m.width, m.height], [1080, 1080]);
});

test("everything inside a Part scales with its box", async () => {
  const dark = async (k) => { const { data, info } = await sharp(knitPath(store, k)).greyscale().raw().toBuffer({ resolveWithObject: true }); let n = 0; for (const v of data) if (v < 200) n++; return n / (info.width * info.height); };
  const small = await dark((await knit(patternWith({}, 0.4).id)).knits[0]);
  const big = await dark((await knit(patternWith({}, 0.8).id)).knits[0]);
  assert.ok(big > small * 3, `a part twice as wide covers about four times the area: ${small.toFixed(3)} vs ${big.toFixed(3)}`);
});

test("editing a Part re-renders everything that uses it, even with reuse on", async () => {
  const p = patternWith({ name: "Same" });
  const first = (await knit(p.id, { reuse: true })).knits[0];
  const edited = createPart(store, project.id, { name: "Tweakable", stitches: [{ id: "x", kind: "shape", x: 0, y: 0, w: 1, h: 1, locked: false, style: { background: "#ff0000" } }], aspect: 2 });
  const pat = store.createPattern(project.id, { name: "Uses tweakable", size: SIZES[2], stitches: [{ id: "i", kind: "part", slot: "t", x: 0, y: 0, w: 1, h: 0.5, locked: false, partId: edited.id, partVersion: 1, overrides: {}, partSlots: [] }] });
  const one = (await knit(pat.id, { reuse: true })).knits[0];
  updatePart(store, edited.id, { stitches: [{ id: "x", kind: "shape", x: 0, y: 0, w: 1, h: 1, locked: false, style: { background: "#0000ff" } }] });
  const two = (await knit(pat.id, { reuse: true })).knits[0];
  assert.notEqual(one.hash, two.hash, "the part's version is part of what a knit is");
  assert.notEqual(sha(knitPath(store, one)), sha(knitPath(store, two)));
  void first;
});

test("a CODE Part animates through the engine's clock, and every frame is the same on a second run", async () => {
  const part = createPart(store, project.id, { name: "Slide card", kind: "code", slots: [{ name: "title", kind: "text", locked: false, default: "Hi" }],
    html: '<div class="b">{{title}}</div>', css: ".b{position:absolute;inset:0;background:#df5a0f;color:#17110b;font:800 12vw sans-serif;display:grid;place-items:center;animation:slide 1s linear both}@keyframes slide{from{transform:translateX(-100%)}to{transform:none}}", aspect: 1 });
  const pat = store.createPattern(project.id, { name: "Code motion", size: { name: "T", w: 360, h: 360 }, stitches: [{ id: "i", kind: "part", slot: "card", x: 0, y: 0, w: 1, h: 1, locked: false, partId: part.id, partVersion: 1, overrides: { title: "Go" }, partSlots: part.slots }] });
  store.apply(pat.id, { type: "setMeta", durationMs: 1000 }, "human");
  const a = (await knit(pat.id)).knits[0], b = (await knit(pat.id)).knits[0];
  const md5 = (f) => execFileSync("ffmpeg", ["-v", "error", "-i", f, "-f", "framemd5", "-"]).toString().split("\n").filter((l) => /^0,/.test(l)).map((l) => l.split(",").pop().trim());
  const fa = md5(knitPath(store, a));
  assert.equal(fa.length, 30);
  assert.deepEqual(fa, md5(knitPath(store, b)), "deterministic, iframe and all");
  assert.notEqual(fa[0], fa[29], "the sandboxed part really moved");
});
