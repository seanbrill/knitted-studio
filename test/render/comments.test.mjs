// A comment as a model looks at it, in a REAL browser: the picture with the pin where the
// person put it, and what is under the pin, the stitch in the knit's pattern, the element in
// the frame's HTML, or the moment of a video.

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { addComment, changeDesign, createDesign, insertKnit, knitPath, openStore } from "@knitted/core/node";
import { lookAtComment, openRenderer } from "@knitted/engine";

const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-commentsr-")), "k.db"));
const renderer = await openRenderer();
after(async () => { await renderer.close(); });
const project = store.createProject({ name: "Comments", starter: "blank" });

const knitOf = async (fields, draw) => {
  const k = insertKnit(store, { projectId: project.id, patternId: null, patternName: "P", jobId: null, batchId: null, label: "k", file: `c/${fields.label}.${fields.format ?? "png"}`, kind: "image", format: "png", width: 1080, height: 1080, bytes: 1, durationMs: null, hash: fields.label, report: {}, ...fields });
  mkdirSync(dirname(knitPath(store, k)), { recursive: true });
  await draw(knitPath(store, k));
  return k;
};

test("on a knit, the pin is drawn where the person put it, and the stitch under it is named", async () => {
  const pattern = store.createPattern(project.id, {
    name: "Square", size: { name: "Square", w: 1080, h: 1080 },
    stitches: [
      { id: "bg", kind: "shape", x: 0, y: 0, w: 1, h: 1, locked: false, style: { fill: "#204060" } },
      { id: "head", kind: "text", slot: "headline", x: 0.1, y: 0.1, w: 0.8, h: 0.2, locked: false, content: "Spring sale" },
    ],
  });
  const k = await knitOf({ label: "sale", patternId: pattern.id, patternName: "Square" }, (f) => sharp({ create: { width: 1080, height: 1080, channels: 3, background: "#204060" } }).png().toFile(f));
  const c = addComment(store, { knitId: k.id, x: 0.5, y: 0.2, text: "Bigger" });
  const seen = await lookAtComment(store, c.id, { renderer });
  assert.equal(seen.patternId, pattern.id);
  assert.deepEqual(seen.under.map((u) => u.stitchId), ["head", "bg"], "top first");
  assert.deepEqual(seen.under[0], { stitchId: "head", kind: "text", slot: "headline", text: "Spring sale" });
  // The whole knit, 1080 drawn at 1080 or less, with the close-up of the spot beside it.
  const { width, height } = await sharp(seen.png).metadata();
  assert.ok(width > 1080 + 500 && height >= 560, `${width}x${height}`);
  // The pin is red, where the person put it: half across, a fifth down.
  const { data, info } = await sharp(seen.png).raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => { const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
  const r = Math.round(1080 * 0.03);
  const ring = [[540 + r, 216], [540 - r, 216], [540, 216 + r], [540, 216 - r]].map(([x, y]) => at(x, y));
  assert.ok(ring.some(([R, G, B]) => R > 180 && G < 90 && B < 90), `a red ring round the spot: ${JSON.stringify(ring)}`);
});

test("on a frame, the element under the pin is named with its place in the HTML", async () => {
  const d = createDesign(store, project.id, { name: "Site", start: "blank" });
  const frameId = changeDesign(store, d.id, [{ op: "setFrame", section: d.sections[0].id, name: "Home", width: 1000, height: 800,
    html: '<main><header class="top"><h1>Hello</h1></header><section class="cta"><button class="buy">Buy now</button></section></main>',
    css: "body{margin:0}.top{height:400px;background:#eee}.top h1{margin:0;font-size:60px}.cta{height:400px;display:grid;place-items:center}.buy{width:400px;height:200px;font-size:40px}" }]).made.frames[0];
  const c = addComment(store, { designId: d.id, frameId, x: 0.5, y: 0.75, text: "Say what it costs" });
  const seen = await lookAtComment(store, c.id, { renderer });
  assert.equal(seen.under.tag, "button.buy");
  assert.equal(seen.under.text, "Buy now");
  assert.match(seen.under.path, /main > section\.cta > button\.buy$/);
  const { width } = await sharp(seen.png).metadata();
  assert.ok(width > 1000, "the frame, and the close-up beside it");
  // A comment on the whole sheet is drawn without a pin, and has nothing under it.
  const whole = await lookAtComment(store, addComment(store, { designId: d.id, text: "More air" }).id, { renderer });
  assert.equal(whole.under, null);
  // Its frame deleted since, a comment is shown on the whole sheet, and says the frame is gone.
  changeDesign(store, d.id, [{ op: "removeFrame", frameId }]);
  const gone = await lookAtComment(store, c.id, { renderer });
  assert.equal(gone.frameGone, true);
  assert.equal(gone.under, null);
  assert.ok(gone.png.length > 0);
});

test("in a video, the picture is the moment the comment is at", async () => {
  // Two seconds red, then two seconds blue.
  const k = await knitOf({ label: "reel", kind: "video", format: "mp4", durationMs: 4000, width: 320, height: 320 }, (f) => execFileSync("ffmpeg", ["-v", "error", "-y",
    "-f", "lavfi", "-i", "color=c=red:s=320x320:d=2:r=25", "-f", "lavfi", "-i", "color=c=blue:s=320x320:d=2:r=25",
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]", "-pix_fmt", "yuv420p", f]));
  const look = async (timeMs) => {
    const seen = await lookAtComment(store, addComment(store, { knitId: k.id, timeMs, text: "Here" }).id, { renderer });
    const { data } = await sharp(seen.png).extract({ left: 10, top: 10, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    return [...data].slice(0, 3);
  };
  const early = await look(500), late = await look(3000);
  assert.ok(early[0] > 180 && early[2] < 80, `red at 0:00.5: ${early}`);
  assert.ok(late[2] > 180 && late[0] < 80, `blue at 0:03.0: ${late}`);
});
