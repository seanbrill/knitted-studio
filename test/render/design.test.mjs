// A design sheet drawn as a picture in a REAL browser: a sheet far bigger than any window is
// drawn in tiles, and every frame shows in the picture, to the far bottom corner. A whole sheet
// of 13,000 by 24,000 once came out as a blank picture of a few kilobytes.

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createDesign, openStore } from "@knitted/core/node";
import { openRenderer, renderDesign } from "@knitted/engine";

const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-designr-")), "k.db"));
const renderer = await openRenderer();
after(async () => { await renderer.close(); });
const project = store.createProject({ name: "Design render", starter: "blank" });

// Twelve frames, each one solid colour of its own, in three sections of four, each 6,000 tall.
const colours = Array.from({ length: 12 }, (_, i) => {
  const c = [(i * 67) % 256, (40 + i * 97) % 256, (200 - i * 53 + 512) % 256];
  return { hex: `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`, rgb: c };
});

test("a sheet bigger than the browser draws is drawn in tiles, every frame to the far corner", async () => {
  const ops = [];
  for (let s = 0; s < 3; s++) {
    ops.push({ op: "addSection", name: `Section ${s + 1}` });
    for (let f = 0; f < 4; f++) {
      const c = colours[s * 4 + f];
      ops.push({ op: "setFrame", section: `Section ${s + 1}`, name: `Frame ${s * 4 + f + 1}`, width: 1440, height: 6000, html: "<main></main>", css: `html,body,main{margin:0;height:100%;background:${c.hex}}` });
    }
  }
  const d = createDesign(store, project.id, { name: "Huge", start: "blank", ops });
  const png = await renderDesign(store, d.id, { renderer });
  const { data, info } = await sharp(png, { limitInputPixels: false }).raw().toBuffer({ resolveWithObject: true });
  // Taller than 16,000 at full size, so drawn smaller: the long side is 16,000.
  assert.ok(Math.max(info.width, info.height) <= 16_000 && Math.max(info.width, info.height) > 15_000, `${info.width}x${info.height}`);
  assert.ok(info.width > 4096 && info.height > 4096, "more than one tile across and down");
  // The board at full size: four frames, the gaps between them, the board's padding and the section's.
  const scale = info.width / (4 * 1440 + 3 * 64 + 2 * 80 + 2 * 56);
  const each = 1440 * 6000 * scale * scale;
  const counts = new Array(12).fill(0);
  for (let i = 0; i < data.length; i += info.channels) {
    for (let k = 0; k < 12; k++) {
      const c = colours[k].rgb;
      if (Math.abs(data[i] - c[0]) <= 2 && Math.abs(data[i + 1] - c[1]) <= 2 && Math.abs(data[i + 2] - c[2]) <= 2) { counts[k]++; break; }
    }
  }
  counts.forEach((n, k) => assert.ok(n > each * 0.9, `Frame ${k + 1} shows ${Math.round((100 * n) / each)}% of itself`));
});

test("a frame shows a picture from the Brief's reference as well as from Yarn: the page as it is, beside a new design of it", async () => {
  const { importYarn } = await import("@knitted/core/node");
  const dir = mkdtempSync(join(tmpdir(), "knitted-designref-"));
  const pic = async (name, rgb) => { const f = join(dir, `${name}.png`); await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toFile(f); return f; };
  const ref = (await importYarn(store, project.id, await pic("today", [20, 160, 60]), "today.png", { shelf: "reference" })).yarn;
  const own = (await importYarn(store, project.id, await pic("photo", [30, 60, 200]), "photo.png")).yarn;
  assert.equal(ref.shelf, "reference");
  const d = createDesign(store, project.id, { name: "Pictures", start: "blank", ops: [{ op: "setFrame", section: "Pages", name: "Both", width: 400, height: 200,
    html: `<img src="yarn:${ref.id}" alt="today"><img src="yarn:${own.id}" alt="a photo">`, css: "html,body{margin:0;display:flex}img{display:block;width:200px;height:200px}" }] });
  const frameId = d.sections[0].frames[0].id;
  const png = await renderDesign(store, d.id, { frameId, renderer });
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => { const i = (Math.round(y * info.height) * info.width + Math.round(x * info.width)) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
  const [left, right] = [at(0.25, 0.5), at(0.75, 0.5)];
  assert.ok(left[1] > 130 && left[0] < 60 && left[2] < 90, `the reference picture, green, not the grey stand-in: ${left}`);
  assert.ok(right[2] > 170 && right[0] < 70, `the Yarn picture, blue: ${right}`);
});

test("a pattern and a Yarn picture on a sheet are drawn as they are, by the renderer the editor uses, and a pin on the pattern names its stitch", async () => {
  const { changeDesign, importYarn, addComment } = await import("@knitted/core/node");
  const { lookAtComment } = await import("@knitted/engine");
  const post = store.createPattern(project.id, { name: "Launch post", size: { name: "Instagram post", w: 1080, h: 1350 }, stitches: [
    { id: "bg", kind: "shape", x: 0, y: 0, w: 1, h: 1, locked: false, style: { background: "#204060" } },
    { id: "head", kind: "text", slot: "headline", x: 0.1, y: 0.1, w: 0.8, h: 0.2, locked: false, content: "Spring sale" },
  ] });
  const dir = mkdtempSync(join(tmpdir(), "knitted-pieces-"));
  await sharp({ create: { width: 600, height: 400, channels: 3, background: "#c03020" } }).png().toFile(join(dir, "red.png"));
  const red = (await importYarn(store, project.id, join(dir, "red.png"), "red.png")).yarn;
  const d = createDesign(store, project.id, { name: "Campaign", start: "blank" });
  const made = changeDesign(store, d.id, [{ op: "addPiece", section: "Pages", kind: "pattern", id: post.id, width: 540 }, { op: "addPiece", section: "Pages", kind: "yarn", id: red.id }]).made.frames;

  // Each on its own: the pattern at the width it is drawn, in its own shape; the picture as it is.
  const share = async (png, [r, g, b]) => {
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    let n = 0; for (let i = 0; i < data.length; i += info.channels) if (Math.abs(data[i] - r) <= 6 && Math.abs(data[i + 1] - g) <= 6 && Math.abs(data[i + 2] - b) <= 6) n++;
    return { share: n / (info.width * info.height), w: info.width, h: info.height };
  };
  const pat = await share(await renderDesign(store, d.id, { frameId: made[0], renderer }), [0x20, 0x40, 0x60]);
  assert.deepEqual([pat.w, pat.h], [540, 675]);
  assert.ok(pat.share > 0.6, `the pattern's own colour fills it: ${Math.round(pat.share * 100)}%`);
  const pic = await share(await renderDesign(store, d.id, { frameId: made[1], renderer }), [0xc0, 0x30, 0x20]);
  assert.deepEqual([pic.w, pic.h], [600, 400]);
  assert.ok(pic.share > 0.95, `the picture: ${Math.round(pic.share * 100)}%`);
  // On the whole sheet, both, beside each other.
  const sheet = await sharp(await renderDesign(store, d.id, { renderer })).metadata();
  assert.ok(sheet.width > 540 + 600 && sheet.height > 675, `${sheet.width}x${sheet.height}`);

  // A pin on the pattern is about the pattern: the stitches under it, top first.
  const c = addComment(store, { designId: d.id, frameId: made[0], x: 0.5, y: 0.2, text: "Bigger" });
  const seen = await lookAtComment(store, c.id, { renderer });
  assert.equal(seen.patternId, post.id);
  assert.deepEqual(seen.piece, { kind: "pattern", id: post.id, name: "Launch post" });
  assert.deepEqual(seen.under.map((u) => u.stitchId), ["head", "bg"]);

  // Shown as a Story, it is laid out at that size: a Story's shape, still the pattern's own colour.
  changeDesign(store, d.id, [{ op: "setFrame", section: "Pages", frameId: made[0], size: "Story" }]);
  const story = await share(await renderDesign(store, d.id, { frameId: made[0], renderer }), [0x20, 0x40, 0x60]);
  assert.deepEqual([story.w, story.h], [540, 960]);
  assert.ok(story.share > 0.6, `laid out at a Story's size: ${Math.round(story.share * 100)}%`);
  // A pin low on the Story is on the background: the headline is a fifth of a taller frame now.
  const low = addComment(store, { designId: d.id, frameId: made[0], x: 0.5, y: 0.6, text: "Something here" });
  assert.deepEqual((await lookAtComment(store, low.id, { renderer })).under.map((u) => u.stitchId), ["bg"]);
  assert.equal(store.getPattern(post.id).size.h, 1350, "the pattern keeps its own size");
});
