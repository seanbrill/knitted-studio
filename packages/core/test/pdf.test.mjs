import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { cropToYarn, deleteYarn, getYarn, importYarn, listYarn, moveAllToFolder, openStore, pdfPagePath, pdfText, purgeDeletedYarn, uploadTempPath, yarnPath } from "../src/node.ts";
import { makePdf } from "./fixtures/pdf.mjs";

const dir = mkdtempSync(join(tmpdir(), "knitted-pdf-"));
const store = openStore(join(dir, "k.db"));
const project = store.createProject({ name: "PDF tests", starter: "social" });

async function imp(name, data, opts) {
  const tmp = uploadTempPath(store, project.id);
  mkdirSync(join(tmp, ".."), { recursive: true });
  writeFileSync(tmp, data);
  return importYarn(store, project.id, tmp, name, opts);
}
const pixel = async (file, x, y) => { const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true }); const i = (Math.round(y) * info.width + Math.round(x)) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
const orange = ([r, g, b]) => r > 200 && g > 60 && g < 120 && b < 50;

test("a PDF becomes Yarn with its pages counted, its text kept beside it and its first page as its picture", async () => {
  const { yarn: y, existing } = await imp("Spring brochure.pdf", makePdf(["Hello spring", "Prices from 12 dollars"]), { shelf: "reference" });
  assert.equal(existing, false);
  assert.equal(y.kind, "pdf");
  assert.equal(y.shelf, "reference");
  assert.equal(y.meta.pages, 2);
  assert.deepEqual([y.width, y.height], [612, 792], "a page's size in points");
  assert.ok(y.meta.textChars > 10);
  assert.ok(y.meta.thumb && existsSync(join(store.paths.yarnDir(project.id), ".thumbs", y.meta.thumb)));
  assert.deepEqual(await pdfText(store, y), ["Hello spring", "Prices from 12 dollars"]);
  assert.equal(listYarn(store, project.id).some((x) => x.id === y.id), false, "the reference is not Yarn");
  assert.equal(listYarn(store, project.id, { shelf: "reference" })[0].id, y.id);
  assert.equal(store.listProjects().find((p) => p.id === project.id).counts.yarn, 0, "nor is it counted as Yarn");
});

test("the same PDF on the other shelf is a file of its own; on the same shelf it is the one there", async () => {
  const pdf = makePdf(["Twice"]);
  const a = await imp("Twice.pdf", pdf, { shelf: "reference" });
  const b = await imp("Twice again.pdf", pdf, { shelf: "reference" });
  const c = await imp("Twice.pdf", pdf);
  assert.equal(b.existing, true);
  assert.equal(b.yarn.id, a.yarn.id);
  assert.equal(c.existing, false);
  assert.equal(c.yarn.shelf, "yarn");
});

test("a page is drawn the first time it is asked for, kept, and asked for again from the disk", async () => {
  const { yarn: y } = await imp("Pages.pdf", makePdf(["One", "Two", "Three"]), { shelf: "reference" });
  const p2 = await pdfPagePath(store, y, 2, 700);
  assert.match(p2, /-p2-800\.webp$/, "the next size up it is kept at");
  const m = await sharp(p2).metadata();
  assert.equal(Math.max(m.width, m.height), 800);
  assert.equal(await pdfPagePath(store, y, 2, 700), p2);
  await assert.rejects(pdfPagePath(store, y, 4), /has 3 pages\. Ask for one from 1 to 3/);
  await assert.rejects(pdfPagePath(store, y, 0), /from 1 to 3/);
});

test("a part of a PDF's page becomes a picture in Yarn, sharp, and says where it came from", async () => {
  const { yarn: pdf } = await imp("Crop me.pdf", makePdf(["Crop me"]), { shelf: "reference" });
  // The orange box: 72..372 across, 192..392 down from the top of a 612 by 792 page.
  const box = { x: 72 / 612, y: 192 / 792, w: 300 / 612, h: 200 / 792 };
  const { yarn: cut, existing } = await cropToYarn(store, pdf.id, { page: 1, box });
  assert.equal(existing, false);
  assert.equal(cut.kind, "image");
  assert.equal(cut.shelf, "yarn", "a crop is for patterns, so it goes to Yarn");
  assert.equal(cut.name, "Crop me, page 1");
  assert.equal(cut.meta.from.id, pdf.id);
  assert.equal(cut.meta.from.page, 1);
  assert.ok(cut.width > 1000, `drawn big enough to cut from: ${cut.width}`);
  assert.ok(orange(await pixel(yarnPath(store, cut), cut.width / 2, cut.height / 2)));
  const again = await cropToYarn(store, pdf.id, { page: 1, box });
  assert.equal(again.existing, true, "the same part twice is the one already there");
  await assert.rejects(cropToYarn(store, pdf.id, { page: 2, box }), /has 1 page\./);
  await assert.rejects(cropToYarn(store, pdf.id, { page: 1, box: { x: 0.5, y: 0.5, w: 0.001, h: 0.001 } }), /too small/);
  await assert.rejects(cropToYarn(store, pdf.id, { page: 1, box: { x: "a" } }), /fraction from 0 to 1/);
});

test("a picture is cut the right way up, a photo stored on its side as it is shown", async () => {
  // 300 wide and 200 high as stored, orange on its left half; turned a quarter clockwise to be shown (orientation 6).
  const stored = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#ffffff" } })
    .composite([{ input: await sharp({ create: { width: 150, height: 200, channels: 3, background: "#ff5a0f" } }).png().toBuffer(), left: 0, top: 0 }])
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const { yarn: photo } = await imp("Sideways.jpg", stored);
  // Shown, it is 200 wide and 300 high, and the orange is its top half.
  const { yarn: top } = await cropToYarn(store, photo.id, { box: { x: 0, y: 0, w: 1, h: 0.5 } });
  assert.deepEqual([top.width, top.height], [200, 150]);
  assert.equal(top.mime, "image/jpeg", "a photo's crop stays a photo");
  assert.ok(orange(await pixel(yarnPath(store, top), 100, 75)));
  assert.equal(top.name, "Sideways, cropped");
  await assert.rejects(cropToYarn(store, photo.id, { page: 2, box: { x: 0, y: 0, w: 1, h: 1 } }), /no pages/);
});

test("a picture is not replaced by a PDF: what uses it uses it as a picture", async () => {
  const { yarn: pic } = await imp("Hero.png", await sharp({ create: { width: 40, height: 40, channels: 3, background: "#000" } }).png().toBuffer());
  const tmp = uploadTempPath(store, project.id);
  writeFileSync(tmp, makePdf(["Not a picture"]));
  await assert.rejects(importYarn(store, project.id, tmp, "Hero.pdf", { replaceId: pic.id }), /Hero is a picture, and that is a PDF/);
  assert.equal(existsSync(tmp), false, "the upload is cleaned up");
  assert.equal(getYarn(store, pic.id).kind, "image");
});

test("a file that says it is a PDF and is not one is turned away", async () => {
  await assert.rejects(imp("Fake.pdf", Buffer.from("hello there, not a pdf")), /says it is a PDF but is not one/);
  await assert.rejects(imp("Broken.pdf", Buffer.from("%PDF-1.4\nnot really")), /not a PDF knitted can read/);
});

test("moving a file to the reference moves it to that shelf, and back", async () => {
  const { yarn: y } = await imp("Shelf move.pdf", makePdf(["Move me"]));
  assert.equal(y.shelf, "yarn");
  moveAllToFolder(store, project.id, { reference: [y.id] }, "Brochures");
  assert.equal(getYarn(store, y.id).shelf, "reference");
  assert.equal(getYarn(store, y.id).folder, "Brochures");
  moveAllToFolder(store, project.id, { yarn: [y.id] }, "");
  assert.equal(getYarn(store, y.id).shelf, "yarn");
});

test("purging a PDF takes its text and drawn pages with it", async () => {
  const { yarn: y } = await imp("Purge.pdf", makePdf(["Gone soon"]), { shelf: "reference" });
  await pdfPagePath(store, y, 1, 320);
  const dirOf = (sub) => readdirSync(join(store.paths.yarnDir(project.id), sub)).filter((n) => n.startsWith(`${y.id}-`));
  assert.ok(dirOf(".text").length && dirOf(".thumbs").length);
  deleteYarn(store, y.id);
  await purgeDeletedYarn(store, -1);
  assert.deepEqual(dirOf(".text"), []);
  assert.deepEqual(dirOf(".thumbs"), []);
});
