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
