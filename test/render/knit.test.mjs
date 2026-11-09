// The Knit pipeline against a REAL browser and real ffmpeg: real files, real pixels.
// Not part of `npm test` (it needs Chromium); `npm run test:render` runs it, and CI installs the browser.

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { activeSwatch, importYarn, knitPath, knitVersions, listKnits, openStore, updateSwatch, uploadTempPath, getKnit, yarnPath } from "@knitted/core/node";
import { postflight, preflight, SIZES } from "@knitted/core";
import { openRenderer, runKnit, previewKnit, applyRow } from "@knitted/engine";

const dir = mkdtempSync(join(tmpdir(), "knitted-render-"));
const store = openStore(join(dir, "k.db"));
const renderer = await openRenderer();
after(async () => { await renderer.close(); });

const project = store.createProject({ name: "Knit tests", starter: "social" });
const patterns = store.listPatterns(project.id);
const story = patterns.find((p) => p.size.name === "Story");
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");

async function knit(patternId, params = {}) {
  const job = store.createJob("knit", project.id, { patternId, params });
  const r = await runKnit(store, { jobId: job.id, projectId: project.id, patternId, params, renderer });
  return { job: store.getJob(job.id), ...r };
}

test("a still knits to a real PNG at exactly the pattern's size, and is recorded", async () => {
  const { knits, job } = await knit(story.id, { reuse: false });
  assert.equal(job.status, "done");
  assert.equal(knits.length, 1);
  const f = knitPath(store, knits[0]);
  const m = await sharp(f).metadata();
  assert.deepEqual([m.format, m.width, m.height], ["png", 1080, 1920]);
  assert.equal(getKnit(store, knits[0].id).format, "png");
});

test("DETERMINISM: the same inputs knit twice give byte-identical files", async () => {
  const a = (await knit(story.id, { reuse: false })).knits[0];
  const b = (await knit(story.id, { reuse: false })).knits[0];
  assert.notEqual(a.file, b.file === a.file ? "" : "x"); // two records
  assert.equal(sha(knitPath(store, a)), sha(knitPath(store, b)), "a render must not depend on timing or run");
});

test("an unchanged pattern is REUSED instead of redrawn, and changing it is not", async () => {
  const first = (await knit(story.id)).knits[0];
  const before = listKnits(store, project.id).length;
  const again = await knit(story.id);
  assert.equal(again.progress.units[0].status, "reused");
  assert.equal(listKnits(store, project.id).length, before, "no new file");
  store.apply(story.id, { type: "fillSlot", slot: "headline", content: "A different line" }, "human");
  const changed = (await knit(story.id)).knits[0];
  assert.notEqual(changed.hash, first.hash);
  assert.notEqual(sha(knitPath(store, changed)), sha(knitPath(store, first)));
});

test("2x scale doubles the pixels", async () => {
  const k = (await knit(story.id, { scale: 2, reuse: false })).knits[0];
  const m = await sharp(knitPath(store, k)).metadata();
  assert.deepEqual([m.width, m.height], [2160, 3840]);
});

test("VERSIONS: the same pattern at 2x is another format of its knit, and changed, a new version shown in its place", async () => {
  const p = store.duplicatePattern(story.id);
  const one = (await knit(p.id)).knits[0];
  const two = (await knit(p.id, { scale: 2 })).knits[0];
  let v = knitVersions(store, one.id);
  assert.deepEqual([v.versions.length, v.versions[0].files.map((f) => f.id), two.scale], [1, [one.id, two.id], 2], "one version, two formats, the first shown");
  assert.deepEqual(listKnits(store, project.id, { patternId: p.id }).map((k) => k.id), [one.id]);
  store.apply(p.id, { type: "fillSlot", slot: "headline", content: "Version two" }, "human");
  const changed = (await knit(p.id)).knits[0];
  v = knitVersions(store, one.id);
  assert.deepEqual([v.versions.length, v.current], [2, 2]);
  assert.deepEqual(listKnits(store, project.id, { patternId: p.id }).map((k) => k.id), [changed.id], "Knits shows the new version, once");
  assert.equal(listKnits(store, project.id, { patternId: p.id, every: true }).length, 3);
});

test("the preview says what each file comes back as: new, kept, drawn again, another format, or the next version", async () => {
  const p = store.duplicatePattern(story.id);
  const as = (params = {}) => previewKnit(store, { projectId: project.id, patternId: p.id, params }).map(({ versions, look, current, same, kept }) => ({ versions, look, current, same, kept }));
  assert.deepEqual(as(), [{ versions: 0, look: null, current: null, same: false, kept: false }], "never knitted: new");
  await knit(p.id);
  assert.deepEqual(as(), [{ versions: 1, look: 1, current: 1, same: true, kept: true }], "the very file is there: kept");
  assert.deepEqual(as({ reuse: false }), [{ versions: 1, look: 1, current: 1, same: true, kept: false }], "with reuse off it is drawn again");
  assert.deepEqual(as({ scale: 2 }), [{ versions: 1, look: 1, current: 1, same: false, kept: false }], "at 2x, another format of the one there");
  const was = store.db.prepare("select id, look from knits where pattern_id = ?").get(p.id);
  store.db.prepare("update knits set look = 'an older kind of look' where id = ?").run(was.id);
  assert.deepEqual(as(), [{ versions: 1, look: 1, current: 1, same: true, kept: true }], "a file whose look was kept another way still says which version it is");
  store.db.prepare("update knits set look = ? where id = ?").run(was.look, was.id);
  store.apply(p.id, { type: "fillSlot", slot: "headline", content: "Something new" }, "human");
  assert.deepEqual(as(), [{ versions: 1, look: null, current: 1, same: false, kept: false }], "changed: the next version");
  const sizes = SIZES.filter((s) => ["Story", "Square"].includes(s.name));
  assert.deepEqual(as({ sizes }).map((u) => u.versions), [1, 0], "a size never knitted is a knit of its own");
});

test("one pattern knits to several sizes in one go, each at its own dimensions", async () => {
  const sizes = SIZES.filter((s) => ["Story", "Square", "Landscape"].includes(s.name));
  const { knits } = await knit(story.id, { sizes, reuse: false });
  assert.equal(knits.length, 3);
  const dims = await Promise.all(knits.map(async (k) => { const m = await sharp(knitPath(store, k)).metadata(); return `${m.width}x${m.height}`; }));
  assert.deepEqual(dims.sort(), ["1080x1080", "1080x1920", "1920x1080"].sort());
});

test("BATCH: twelve rows make twelve files, named from the rows, with real progress", async () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ headline: `Post number ${i + 1}` }));
  const { knits, progress } = await knit(story.id, { rows, reuse: false });
  assert.equal(knits.length, 12);
  assert.equal(progress.done, 12);
  assert.equal(new Set(knits.map((k) => k.file)).size, 12, "no two share a name");
  assert.match(knits[3].file, /-4-post-number-4-/);
  assert.equal(new Set(knits.map((k) => k.batchId)).size, 1, "they belong to one batch");
  assert.equal(new Set(knits.map((k) => sha(knitPath(store, k)))).size, 12, "each one is different");
});

test("a batch row that tries a LOCKED slot fails that row, in plain words, and the rest still knit", async () => {
  const rows = [{ headline: "Fine one" }, { headline: "Sneaky", eyebrow: "HIJACK" }, { headline: "Fine two" }];
  const { knits, progress, job } = await knit(story.id, { rows, reuse: false });
  assert.equal(knits.length, 2);
  assert.equal(progress.units[1].status, "failed");
  assert.match(progress.units[1].issues.map((i) => i.message).join(" "), /eyebrow: locked by the pattern/);
  assert.equal(job.status, "done");
});

test("a row naming a slot the pattern does not have is told so, not silently dropped", async () => {
  const { progress } = await knit(story.id, { rows: [{ headline: "x", nonsense: "y" }], reuse: false });
  assert.ok(progress.units[0].issues.some((i) => i.code === "no-such-slot"));
});

test("missing Yarn blocks that knit before any drawing, with a fix", async () => {
  const p = store.createPattern(project.id, { name: "Broken", size: SIZES[2], stitches: [{ id: "i", kind: "image", slot: "photo", x: 0, y: 0, w: 1, h: 1, locked: false, yarnId: "yn_gone" }] });
  const r = await knit(p.id, { reuse: false });
  assert.equal(r.knits.length, 0);
  assert.equal(r.job.status, "failed");
  assert.match(r.progress.units[0].issues[0].message, /deleted\. Choose another file/);
});

test("a font knitted has no file for is reported before anything is drawn", () => {
  const p = store.createPattern(project.id, { name: "No such font", size: SIZES[2], stitches: [{ id: "t", kind: "text", slot: "headline", x: 0.1, y: 0.1, w: 0.8, h: 0.2, locked: false, content: "Hello", style: { fontFamily: "Helvetica Neue LT Pro" } }] });
  const [w] = previewKnit(store, { projectId: project.id, patternId: p.id }).flatMap((u) => u.issues).filter((i) => i.code === "missing-font");
  assert.match(w.message, /"Helvetica Neue LT Pro", which knitted does not have, so it would be drawn in a stand-in font/);
  const ok = store.createPattern(project.id, { name: "Bundled font", size: SIZES[2], stitches: [{ id: "t", kind: "text", x: 0.1, y: 0.1, w: 0.8, h: 0.2, locked: false, content: "Hello", style: { fontFamily: "Lora" } }] });
  assert.deepEqual(previewKnit(store, { projectId: project.id, patternId: ok.id }).flatMap((u) => u.issues).filter((i) => i.code === "missing-font"), []);
});

test("a font file that will not load stops the knit, instead of drawing the text in a stand-in", async () => {
  // Every knit of 11-05 came out in Helvetica when the desktop app could not find its fonts, and nothing said so.
  const tmp = uploadTempPath(store, project.id); mkdirSync(join(tmp, ".."), { recursive: true });
  writeFileSync(tmp, readFileSync(new URL("../../packages/fonts/files/lora-latin-wght-normal.woff2", import.meta.url)));
  const { yarn } = await importYarn(store, project.id, tmp, "brand.woff2", {});
  store.db.prepare("update yarn set meta = json_set(meta, '$.family', 'Brand Face') where id = ?").run(yarn.id);
  execFileSync("rm", [yarnPath(store, yarn)]);
  const p = store.createPattern(project.id, { name: "Lost font", size: SIZES[2], stitches: [{ id: "t", kind: "text", slot: "headline", x: 0.1, y: 0.1, w: 0.8, h: 0.2, locked: false, content: "Hello", style: { fontFamily: "Brand Face" } }] });
  const r = await knit(p.id, { reuse: false });
  assert.equal(r.knits.length, 0);
  assert.match(r.progress.units[0].issues.find((i) => i.code === "font-failed").message, /"Brand Face" did not load.*Nothing was made/);
});

test("text still rising in at the start is measured where it lands, so a snug box is not reported as overflowing", async () => {
  // A real "notch.fm" end card: one line in a snug box, brought in a word at a time, was reported
  // as cut off because at time 0 the word sits 0.4em below its line.
  const p = store.createPattern(project.id, { name: "Snug", size: { name: "T", w: 360, h: 640 }, stitches: [{ id: "t", kind: "text", slot: "headline", x: 0.05, y: 0.4, w: 0.9, h: 0.07, locked: false, content: "notch", style: { fontSize: 0.1, verticalAlign: "middle", textAlign: "center" } }] });
  store.apply(p.id, { type: "setMeta", durationMs: 600 }, "human");
  store.apply(p.id, { type: "setMotion", stitchId: "t", clips: [{ id: "c", preset: "stitch-in", startMs: 0, endMs: 500 }] }, "human");
  const { progress } = await knit(p.id, { reuse: false });
  assert.deepEqual(progress.units[0].issues.filter((i) => i.code === "text-overflow"), []);
});

test("a long headline is reported as overflowing its box", async () => {
  const p = store.createPattern(project.id, { name: "Overflow", size: SIZES[2], stitches: [{ id: "t", kind: "text", slot: "headline", x: 0.05, y: 0.05, w: 0.3, h: 0.05, locked: false, content: "This headline is far too long to fit inside such a small box at this size", style: { fontFamily: "$font.display", fontSize: 0.08, color: "$color.text" } }] });
  const { progress } = await knit(p.id, { reuse: false });
  assert.ok(progress.units[0].issues.some((i) => i.code === "text-overflow"));
});

test("images come from Yarn, and the heat grade really changes the pixels", async () => {
  const tmp = uploadTempPath(store, project.id); mkdirSync(join(tmp, ".."), { recursive: true });
  writeFileSync(tmp, await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 30, g: 120, b: 220 } } }).png().toBuffer());
  const { yarn } = await importYarn(store, project.id, tmp, "blue.png");
  const mk = (heat) => store.createPattern(project.id, { name: `Photo ${heat ?? "plain"}`, size: SIZES[2], stitches: [{ id: "i", kind: "image", slot: "photo", x: 0, y: 0, w: 1, h: 1, locked: false, yarnId: yarn.id, style: { fit: "cover", ...(heat ? { heat, heatStrength: 0.8 } : {}) } }] });
  const plain = (await knit(mk(null).id, { reuse: false })).knits[0];
  const heated = (await knit(mk("ember").id, { reuse: false })).knits[0];
  const px = async (k) => (await sharp(knitPath(store, k)).resize(1, 1).raw().toBuffer());
  const [a, b] = [await px(plain), await px(heated)];
  assert.ok(a[2] > 150, "the plain photo is blue");
  assert.ok(b[0] > b[2], `the heat-graded one is warm: rgb(${[...b]})`);
});

test("changing the swatch's display font changes the render: brand fonts really are applied", async () => {
  const p = store.createProject({ name: "Fonts", starter: "blank" });
  const pat = store.listPatterns(p.id)[0];
  store.apply(pat.id, { type: "addStitch", stitch: { id: "h", kind: "text", slot: "headline", x: 0.05, y: 0.3, w: 0.9, h: 0.3, locked: false, content: "Typography", style: { fontFamily: "$font.display", fontSize: 0.12, fontWeight: 800, color: "$color.text" } } }, "human");
  const job = (params) => { const j = store.createJob("knit", p.id, {}); return runKnit(store, { jobId: j.id, projectId: p.id, patternId: pat.id, params, renderer }); };
  const a = (await job({ reuse: false })).knits[0];
  updateSwatch(store, activeSwatch(store, p.id).id, { fonts: { display: { family: "Playfair Display" }, body: { family: "Geist" } } });
  const b = (await job({ reuse: false })).knits[0];
  assert.notEqual(sha(knitPath(store, a)), sha(knitPath(store, b)));
});

test("CANCEL mid-batch keeps what finished, marks the job cancelled, and leaves no stray files", async () => {
  const ctl = new AbortController();
  const rows = Array.from({ length: 8 }, (_, i) => ({ headline: `Cancel ${i}` }));
  const job = store.createJob("knit", project.id, {});
  const t = setInterval(() => { const j = store.getJob(job.id); if ((j.progress?.done ?? 0) >= 2) ctl.abort(); }, 20);
  const r = await runKnit(store, { jobId: job.id, projectId: project.id, patternId: story.id, params: { rows, reuse: false }, signal: ctl.signal, renderer });
  clearInterval(t);
  assert.equal(r.cancelled, true);
  assert.equal(store.getJob(job.id).status, "cancelled");
  assert.ok(r.knits.length >= 2 && r.knits.length < 8);
  for (const k of r.knits) assert.ok(existsSync(knitPath(store, k)));
  assert.ok(!existsSync(join(store.paths.projectDir(project.id), ".pages", `${job.id}-7.html`)));
});

test("MOTION: a 1 second pattern becomes a yuv420p MP4 with exactly 30 frames, identical on a second run", async () => {
  const p = store.createPattern(project.id, { name: "Motion", size: { name: "Test", w: 360, h: 640 }, stitches: [
    { id: "b", kind: "shape", x: 0, y: 0, w: 1, h: 1, locked: false, style: { background: "$color.primary" } },
    { id: "t", kind: "text", slot: "headline", x: 0.1, y: 0.4, w: 0.8, h: 0.2, locked: false, content: "Move", style: { fontFamily: "$font.display", fontSize: 0.2, fontWeight: 800, color: "$color.text" } },
  ] });
  store.apply(p.id, { type: "setMeta", durationMs: 1000 }, "human");
  const pat = store.getPattern(p.id);
  store.db.prepare("update patterns set doc = ? where id = ?").run(JSON.stringify({ stitches: pat.stitches, css: ".stitch.text{animation:slide 1s linear both} @keyframes slide{from{transform:translateX(-100px);opacity:0}to{transform:none;opacity:1}}" }), p.id);
  const a = (await knit(p.id, { reuse: false })).knits[0], b = (await knit(p.id, { reuse: false })).knits[0];
  const fa = knitPath(store, a);
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=pix_fmt,nb_read_frames,width,height", "-of", "json", fa]).toString()).streams[0];
  assert.equal(probe.pix_fmt, "yuv420p");
  assert.equal(Number(probe.nb_read_frames), 30);
  const md5 = (f) => execFileSync("ffmpeg", ["-v", "error", "-i", f, "-f", "framemd5", "-"]).toString().split("\n").filter((l) => /^0,/.test(l)).map((l) => l.split(",").pop().trim());
  assert.deepEqual(md5(fa), md5(knitPath(store, b)), "every decoded frame is identical across runs: time is SET, never waited for");
  assert.notEqual(md5(fa)[0], md5(fa)[29], "and the animation really moves");
});

test("a video's colours come out as drawn: converted and tagged BT.709, and it can start playing before it has all loaded", async () => {
  // Converted with ffmpeg's default BT.601 matrix and left untagged, players read the file as 709 and
  // a brand red came out orange in real FileFreak knits.
  const p = store.createPattern(project.id, { name: "Red", size: { name: "Test", w: 320, h: 320 }, stitches: [
    { id: "b", kind: "shape", x: 0, y: 0, w: 1, h: 1, locked: false, style: { background: "#e0242f" } },
  ] });
  store.apply(p.id, { type: "setMeta", durationMs: 500 }, "human");
  const file = knitPath(store, (await knit(p.id, { reuse: false })).knits[0]);
  const tags = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_space,color_primaries,color_transfer,color_range", "-of", "json", file]).toString()).streams[0];
  assert.deepEqual(tags, { color_range: "tv", color_space: "bt709", color_transfer: "bt709", color_primaries: "bt709" });
  const px = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-frames:v", "1", "-vf", "crop=8:8:156:156,scale=1:1:in_color_matrix=bt709:in_range=tv,format=rgb24", "-f", "rawvideo", "-"]);
  const want = [0xe0, 0x24, 0x2f];
  assert.ok([...px].every((v, i) => Math.abs(v - want[i]) <= 4), `decoded as 709 it is the red that was drawn: got ${[...px].join(",")}`);
  const bytes = readFileSync(file);
  assert.ok(bytes.indexOf("moov") < bytes.indexOf("mdat"), "the index is at the front (faststart)");
});

// ── the quality gates must be able to FAIL (the brief: prove a check on its own bug) ──
test("postflight rejects each injected fault", () => {
  const ok = { kind: "image", width: 100, height: 100, expectW: 100, expectH: 100, blank: false };
  assert.equal(postflight(ok).issues.length, 0);
  assert.match(postflight({ ...ok, width: 99 }).issues[0].message, /came out 99x100/);
  assert.match(postflight({ ...ok, blank: true }).issues[0].message, /one flat colour/);
  const v = { kind: "video", width: 100, height: 100, expectW: 100, expectH: 100, pixFmt: "yuv420p", frames: 30, expectFrames: 30, videoMs: 1000, audioMs: 1000 };
  assert.equal(postflight(v).issues.length, 0);
  assert.match(postflight({ ...v, pixFmt: "yuv444p" }).issues[0].message, /green screen/);
  assert.match(postflight({ ...v, frames: 29 }).issues[0].message, /29 frames but the timeline needs 30/);
  assert.match(postflight({ ...v, audioMs: 700 }).issues[0].message, /audio is shorter than the picture/);
});

test("preflight flags low contrast and small images, and passes a good pattern", async () => {
  const sw = activeSwatch(store, project.id);
  assert.equal(preflight(story, sw, { yarn: {} }).filter((i) => i.level === "error").length, 0);
  const lowContrast = { ...story, stitches: story.stitches.map((s) => (s.slot === "headline" ? { ...s, style: { ...s.style, color: "#fffbf6" } } : s)) };
  assert.ok(preflight(lowContrast, { ...sw, colors: sw.colors.map((c) => (c.role === "primary" ? { ...c, hex: "#fffbf6" } : c)) }, { yarn: {} }).some((i) => i.code === "low-contrast"));
});

test("previewKnit reports problems WITHOUT drawing anything", () => {
  const before = listKnits(store, project.id).length;
  const units = previewKnit(store, { projectId: project.id, patternId: story.id, params: { rows: [{ headline: "ok" }, { eyebrow: "locked!" }] } });
  assert.equal(units.length, 2);
  assert.ok(units[1].issues.some((i) => i.code === "locked-slot"));
  assert.equal(listKnits(store, project.id).length, before);
});

test("applyRow can never write a locked slot, whatever the row says", () => {
  const r = applyRow(story, { eyebrow: "x", headline: "y" }, [], 0);
  assert.equal(r.pattern.stitches.find((s) => s.slot === "eyebrow").content, "NEW THIS WEEK");
  assert.equal(r.pattern.stitches.find((s) => s.slot === "headline").content, "y");
});

test("a solid full-bleed colour is a legitimate design, not a blank file", async () => {
  const p = store.createPattern(project.id, { name: "Flat", size: SIZES[2], stitches: [{ id: "f", kind: "shape", x: 0, y: 0, w: 1, h: 1, locked: false, style: { background: "$color.primary" } }] });
  const r = await knit(p.id, { reuse: false });
  assert.equal(r.knits.length, 1);
});

test("a pattern whose text never drew IS flagged as blank", async () => {
  // Text the same colour as the field it sits on, so the render is flat despite having content.
  const p = store.createPattern(project.id, { name: "Invisible", size: SIZES[2], stitches: [
    { id: "f", kind: "shape", x: 0, y: 0, w: 1, h: 1, locked: false, style: { background: "#ffffff" } },
    { id: "t", kind: "text", slot: "headline", x: 0.1, y: 0.1, w: 0.8, h: 0.3, locked: false, content: "You cannot see me", style: { fontSize: 0.1, color: "#ffffff" } },
  ] });
  const r = await knit(p.id, { reuse: false });
  assert.equal(r.knits.length, 0);
  assert.ok(r.progress.units[0].issues.some((i) => i.code === "blank"));
});
