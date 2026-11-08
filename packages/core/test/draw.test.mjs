import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { LIBRARY_ID } from "../src/index.ts";
import { drawSheet, importYarn, openStore, prepareSvg, saveDrawing, svgColors, uploadTempPath, yarnPath } from "../src/node.ts";

const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-draw-")), "k.db"));
const p = store.createProject({ name: "Cafe" });
const CUP = '<svg viewBox="0 0 24 24" fill="none" stroke="#2B2118" stroke-width="2" stroke-linecap="round"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M8 3v3M12 3v3"/></svg>';
const PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="#2b2118" stroke-width="2"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';
const size = async (png) => { const m = await sharp(png).metadata(); return [m.width, m.height]; };

test("markup is made ready: a namespace, and a viewBox from its size when it has none", () => {
  const r = prepareSvg('<svg width="400" height="300"><rect width="400" height="300" fill="red"/></svg>');
  assert.match(r.svg, /^<svg [^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(r.svg, /^<svg [^>]*viewBox="0 0 400 300"/);
  assert.deepEqual([r.w, r.h], [400, 300]);
  assert.match(r.notes[0], /given viewBox="0 0 400 300"/);
  assert.equal(prepareSvg("```svg\n" + CUP + "\n```").w, 24, "a fenced block is taken as its markup");
  assert.throws(() => prepareSvg('<svg><circle r="4"/></svg>'), /Give the <svg> a viewBox/);
  assert.throws(() => prepareSvg('<svg viewBox="0 0 24 24"><circle r="4"/>'), /cut off/);
  assert.throws(() => prepareSvg('<svg viewBox="0 0 2400 2"><circle r="4"/></svg>'), /far too thin/);
  assert.throws(() => prepareSvg("a cup"), /no <svg> tag/);
  assert.match(prepareSvg('<svg viewBox="0 0 10 10"><text>Hi</text></svg>').notes.join(" "), /<text>/);
});

test("the colours it uses are listed, as written, short hex made long", () => {
  assert.deepEqual(svgColors('<svg fill="#F00" stroke="currentColor"><path fill="none" stroke="#2b2118"/><stop stop-color="#abcdef"/><g style="fill: rebeccapurple"/></svg>'), ["#ff0000", "#2b2118", "#abcdef", "rebeccapurple"]);
});

test("a drawing is kept as Yarn, marked as drawn, and drawn back on light and dark at icon sizes", async () => {
  const r = await saveDrawing(store, p.id, { svg: CUP, name: "Cup, steaming", folder: "Icons", prompt: "a cafe icon set", tags: ["icon"] });
  assert.equal(r.existing, false);
  assert.equal(r.yarn.kind, "image");
  assert.equal(r.yarn.mime, "image/svg+xml");
  assert.equal(r.yarn.name, "Cup, steaming");
  assert.equal(r.yarn.folder, "Icons");
  assert.deepEqual([...r.yarn.tags].sort(), ["drawn", "icon"]);
  assert.equal(r.yarn.meta.made.by, "model");
  assert.equal(r.yarn.meta.made.prompt, "a cafe icon set");
  assert.deepEqual(r.colors, ["#2b2118"]);
  assert.deepEqual(await size(r.preview), [960, 584], "two halves, and a row of small sizes for a square one");
  assert.match(readFileSync(yarnPath(store, r.yarn), "utf8"), /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  const wide = await saveDrawing(store, p.id, { svg: '<svg viewBox="0 0 400 100"><rect x="10" y="10" width="380" height="80" rx="40" fill="#f4a340"/></svg>', name: "Divider" });
  assert.deepEqual(await size(wide.preview), [960, 480], "no icon sizes for a wide one");
});

test("one that draws nothing, or will not draw, is refused with what to check", async () => {
  await assert.rejects(saveDrawing(store, p.id, { svg: '<svg viewBox="0 0 24 24"><path d="M1 1" fill="none"/></svg>' }), /draws nothing that shows/);
  await assert.rejects(saveDrawing(store, p.id, { svg: '<svg viewBox="0 0 24 24"><circle cx="40" cy="40" r="5" fill="red"/></svg>' }), /draws nothing that shows/, "drawn outside its viewBox");
  await assert.rejects(saveDrawing(store, p.id, { svg: '<svg viewBox="0 0 24 24"><rect width="10" height="10" fill="red"><rect></svg>' }), /could not be drawn: .*tag mismatch.*Check every tag is closed/);
});

test("scripts and links out are taken out, and it says so", async () => {
  const r = await saveDrawing(store, p.id, { svg: '<svg viewBox="0 0 24 24" onload="alert(1)"><script>alert(2)</script><circle cx="12" cy="12" r="8" fill="#123456"/><image href="https://example.com/x.png" width="4" height="4"/></svg>', name: "Dot" });
  const saved = readFileSync(yarnPath(store, r.yarn), "utf8");
  assert.doesNotMatch(saved, /script|onload|example\.com/);
  assert.ok(r.notes.some((n) => /taken out/.test(n)));
});

test("a drawing is drawn again in place: the same id, the new markup, the old name and tags", async () => {
  const ref = await (async () => {
    const tmp = uploadTempPath(store, p.id);
    mkdirSync(join(tmp, ".."), { recursive: true });
    writeFileSync(tmp, await sharp({ create: { width: 200, height: 200, channels: 3, background: "#f4a340" } }).png().toBuffer());
    return (await importYarn(store, p.id, tmp, "Sunny.png", {})).yarn;
  })();
  const first = await saveDrawing(store, p.id, { svg: PIN, name: "Pin", tags: ["icon"], from: [ref.id] });
  assert.deepEqual(first.yarn.meta.made.from, [{ id: ref.id, name: "Sunny" }]);
  const again = await saveDrawing(store, p.id, { svg: PIN.replace('stroke-width="2"', 'stroke-width="1.5"'), replaceId: first.yarn.id });
  assert.equal(again.yarn.id, first.yarn.id);
  assert.notEqual(again.yarn.hash, first.yarn.hash);
  assert.equal(again.yarn.name, "Pin");
  assert.deepEqual([...again.yarn.tags].sort(), ["drawn", "icon"]);
  assert.deepEqual(again.yarn.meta.made.from, [{ id: ref.id, name: "Sunny" }], "what it was drawn from is kept");
  assert.match(readFileSync(yarnPath(store, again.yarn), "utf8"), /stroke-width="1.5"/);
  const renamed = await saveDrawing(store, p.id, { svg: PIN, replaceId: first.yarn.id, name: "Map pin" });
  assert.equal(renamed.yarn.name, "Map pin");
  assert.ok(store.activity(p.id, 20).some((a) => a.action === "yarn.changed" && a.subject === "Pin" && a.actor === "model"));
});

test("a file it did not draw is never drawn over", async () => {
  const tmp = uploadTempPath(store, p.id);
  mkdirSync(join(tmp, ".."), { recursive: true });
  writeFileSync(tmp, CUP.replace("#2B2118", "#000000"));
  const logo = (await importYarn(store, p.id, tmp, "Logo.svg", {})).yarn;
  await assert.rejects(saveDrawing(store, p.id, { svg: PIN, replaceId: logo.id }), /not drawn by a model, so it is not drawn over/);
  const other = store.createProject({ name: "Florist" });
  const theirs = await saveDrawing(store, other.id, { svg: PIN.replace("#2b2118", "#336699"), name: "Their pin" });
  await assert.rejects(saveDrawing(store, p.id, { svg: PIN, replaceId: theirs.yarn.id }), /not in this project's Yarn/);
});

test("a drawing can go to the Library", async () => {
  const r = await saveDrawing(store, LIBRARY_ID, { svg: PIN.replace("#2b2118", "#aa3355"), name: "Shared pin" });
  assert.equal(r.yarn.projectId, LIBRARY_ID);
});

test("a sheet shows a set side by side at one size, on light and dark", async () => {
  const both = await drawSheet(store, p.id, { folder: "Icons", size: 64 });
  assert.deepEqual(both.items.map((i) => i.name), ["Cup, steaming"]);
  const pin = (await saveDrawing(store, p.id, { svg: PIN.replace("#2b2118", "#112233"), name: "Pin two", folder: "Icons" })).yarn;
  const two = await drawSheet(store, p.id, { folder: "Icons", size: 64 });
  assert.equal(two.items.length, 2);
  const [w, h] = await size(two.data);
  const light = await drawSheet(store, p.id, { folder: "Icons", size: 64, background: "light" });
  const [, hl] = await size(light.data);
  assert.equal(h, hl * 2, "light and dark: twice as tall");
  assert.ok(w > 2 * 64);
  const byIds = await drawSheet(store, p.id, { ids: [pin.id], size: 32 });
  assert.deepEqual(byIds.items.map((i) => i.id), [pin.id]);
  await assert.rejects(drawSheet(store, p.id, {}), /their ids, a folder, or a tag/);
  await assert.rejects(drawSheet(store, p.id, { folder: "Nothing here" }), /no pictures there/);
});
