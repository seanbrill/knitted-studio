// Footage in a knit: it plays from when its stitch comes in, from its in-point, through a copy
// made the size it is drawn (so 4K knits at the speed of 1080p), and frames are taken with
// Chrome's fast PNG, which must give exactly the pixels Playwright's screenshot did.

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { importYarn, knitPath, openStore, uploadTempPath } from "@knitted/core/node";
import { fastShots, openRenderer, probeFootage, proxyPlan, runKnit } from "@knitted/engine";

const dir = mkdtempSync(join(tmpdir(), "knitted-footage-"));
const f = (n) => join(dir, n);
const ff = (...a) => execFileSync("ffmpeg", ["-v", "error", "-y", ...a]);
const store = openStore(join(dir, "k.db"));
const renderer = await openRenderer();
after(async () => { await renderer.close(); });

// 4K footage that is red for its first second, then green, then blue, built to be played (one
// whole frame in 250), as a camera makes it.
ff("-f", "lavfi", "-i", "color=c=red:s=3840x2160:r=30:d=1", "-f", "lavfi", "-i", "color=c=lime:s=3840x2160:r=30:d=1", "-f", "lavfi", "-i", "color=c=blue:s=3840x2160:r=30:d=1",
  "-filter_complex", "[0][1][2]concat=n=3:v=1[v]", "-map", "[v]", "-c:v", "libx264", "-g", "250", "-pix_fmt", "yuv420p", f("rgb.mp4"));

async function footageProject(name) {
  const project = store.createProject({ name, starter: "blank" });
  const tmp = uploadTempPath(store, project.id);
  execFileSync("mkdir", ["-p", join(tmp, "..")]); execFileSync("cp", [f("rgb.mp4"), tmp]);
  const y = (await importYarn(store, project.id, tmp, "rgb.mp4", { name: "rgb" })).yarn;
  return { project, y };
}
/** The average colour of one frame of a knitted video, at a time in seconds. */
let frames = 0;
async function colourAt(file, s) {
  // Each frame its own file: sharp keeps what it read by path, and gave the first frame again.
  const out = f(`frame-${frames++}.png`);
  ff("-ss", String(s), "-i", file, "-frames:v", "1", out);
  const { channels } = await sharp(out).stats();
  return channels.slice(0, 3).map((c) => Math.round(c.mean));
}
const near = (c, want) => c.every((v, i) => Math.abs(v - want[i]) < 40);

test("the copy is cut to what the box shows, at the size it is drawn, and only the part played", async () => {
  const src = { width: 3840, height: 2160, durationMs: 60000 };
  const story = { w: 1080, h: 1920 };
  assert.deepEqual(proxyPlan(src, story, { playMs: 5000 }), { crop: { x: 1312, y: 0, w: 1216, h: 2160 }, out: { w: 1080, h: 1920 }, trim: { startMs: 0, lengthMs: 6000 } });
  assert.equal(proxyPlan(src, story, { focalX: 0 }).crop.x, 0, "the focus point is kept where the box would put it");
  assert.equal(proxyPlan(src, story, { fit: "contain" }).out.w, 1080, "contain: the whole frame, as wide as the box");
  assert.deepEqual(proxyPlan(src, { w: 540, h: 960 }, { zoom: 1.15 }).out, { w: 622, h: 1104 }, "a slow zoom needs a little more");
  assert.deepEqual(proxyPlan(src, story, { zoom: 1.15 }).out, { w: 1216, h: 2160 }, "but never more than the file has");
  assert.deepEqual(proxyPlan({ width: 640, height: 360, durationMs: 4000 }, story, {}).out, { w: 202, h: 360 }, "never bigger than the file");
  assert.deepEqual(proxyPlan(src, story, { fromMs: 30000, playMs: 4000 }).trim, { startMs: 30000, lengthMs: 5000 }, "from the in-point");
  assert.deepEqual(proxyPlan({ ...src, durationMs: 5000 }, story, { playMs: 8000 }).trim, { startMs: 0, lengthMs: null }, "footage that loops is copied whole");
  const probe = await probeFootage(f("rgb.mp4"));
  assert.deepEqual([probe.width, probe.height, probe.pixFmt], [3840, 2160, "yuv420p"]);
});

test("footage starts from its first frame when its stitch comes in, not from the pattern's clock", async () => {
  const { project, y } = await footageProject("Entrance");
  // The video comes in at 1 s. At 1.5 s it has played half a second: red. On the pattern's clock it was green.
  const p = store.createPattern(project.id, { name: "Late footage", size: { name: "T", w: 270, h: 480 }, stitches: [{ id: "v", kind: "video", x: 0, y: 0, w: 1, h: 1, locked: false, yarnId: y.id }] });
  store.apply(p.id, { type: "batch", commands: [{ type: "setMeta", durationMs: 2500 }, { type: "setMotion", stitchId: "v", clips: [{ id: "a", preset: "fade-in", startMs: 1000, endMs: 1100 }] }] }, "human");
  const job = store.createJob("knit", project.id, {});
  const r = await runKnit(store, { jobId: job.id, projectId: project.id, patternId: p.id, params: { reuse: false }, renderer });
  const file = knitPath(store, r.knits[0]);
  assert.ok(near(await colourAt(file, 1.5), [255, 0, 0]), `red at 1.5 s: ${await colourAt(file, 1.5)}`);
  assert.ok(near(await colourAt(file, 2.3), [0, 255, 0]), `green from 2 s: ${await colourAt(file, 2.3)}`);
  // From an in-point 2 s into the file: blue as soon as it is in.
  store.apply(p.id, { type: "updateStitch", id: "v", patch: { style: { fromMs: 2000 } } }, "human");
  const again = await runKnit(store, { jobId: store.createJob("knit", project.id, {}).id, projectId: project.id, patternId: p.id, params: { reuse: false }, renderer });
  assert.ok(near(await colourAt(knitPath(store, again.knits[0]), 1.5), [0, 0, 255]), "blue: it starts 2 s in");
});

test("4K footage in a Story is knitted from a copy the Story's size, made once", async () => {
  const { project, y } = await footageProject("4K");
  const p = store.createPattern(project.id, { name: "Story footage", size: { name: "Story", w: 1080, h: 1920 }, stitches: [{ id: "v", kind: "video", x: 0, y: 0, w: 1, h: 1, locked: false, yarnId: y.id }] });
  store.apply(p.id, { type: "setMeta", durationMs: 1000 }, "human");
  const knit = () => runKnit(store, { jobId: store.createJob("knit", project.id, {}).id, projectId: project.id, patternId: p.id, params: { reuse: false }, renderer });
  const r = await knit();
  assert.equal(r.progress.units[0].status, "done");
  const copies = readdirSync(join(store.paths.cacheDir, "footage")).filter((n) => n.endsWith(".mp4") && !n.includes(".part"));
  const mine = copies.map((n) => join(store.paths.cacheDir, "footage", n)).filter((n) => execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", n]).toString().trim() === "1080,1920");
  assert.equal(mine.length, 1, `one copy at the Story's size: ${copies}`);
  assert.ok(near(await colourAt(knitPath(store, r.knits[0]), 0.5), [255, 0, 0]));
  await knit();
  assert.equal(readdirSync(join(store.paths.cacheDir, "footage")).filter((n) => n.endsWith(".mp4")).length, copies.length, "the second knit uses the same copy");
});

test("Chrome's fast PNG is exactly the pixels Playwright's screenshot gave, at 1x and 2x; where the page is clear, black", async () => {
  for (const scale of [1, 2]) {
    const page = await renderer.newPage({ width: 320, height: 240, scale });
    // A pattern has a background of its own: then every pixel is as before.
    await page.setContent(`<body style="margin:0;background:#f4ead8"><div style="width:200px;height:240px;background:linear-gradient(90deg,#c0392b,#2980b9);border-radius:40px;opacity:0.8"></div><p style="position:absolute;top:80px;left:30px;font:700 30px sans-serif;color:#fff">Knit it</p></body>`);
    const a = await page.screenshot({ omitBackground: true });
    const shoot = await fastShots(page);
    assert.ok(shoot, "the browser offers the fast capture");
    const b = await shoot();
    const [ra, rb] = await Promise.all([sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true })]);
    assert.deepEqual([rb.info.width, rb.info.height], [320 * scale, 240 * scale]);
    assert.ok(ra.data.equals(rb.data), `the same pixels at ${scale}x`);
    // With nothing behind, as a video shows it: black, opaque.
    await page.setContent(`<body style="margin:0;background:transparent"><div style="width:100px;height:100px;background:#c0392b"></div></body>`);
    const clear = await sharp(await shoot()).ensureAlpha().extract({ left: 300 * scale, top: 200 * scale, width: 1, height: 1 }).raw().toBuffer();
    assert.deepEqual([...clear], [0, 0, 0, 255]);
    await page.close();
  }
});
