import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { ValidationError, activeSwatch, colorsFromYarn, copySwatchToProject, createSwatch, deleteSwatch, duplicateSwatch, exportSwatch, importSwatch, importYarn, listSwatches, openStore, proposeFromWebsite, setActiveSwatch, updateSwatch, uploadTempPath } from "../src/node.ts";
import { colorFor, fontFor, ratio, resolveStyle, resolveToken, suggestPassing, grade, FALLBACK_SWATCH, readableOn } from "../src/index.ts";
import { writeFileSync, mkdirSync } from "node:fs";

const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-sw-")), "k.db"));

test("contrast: published reference values", () => {
  assert.equal(ratio("#000000", "#ffffff").toFixed(2), "21.00");
  assert.equal(ratio("#777777", "#ffffff").toFixed(2), "4.48");
  assert.equal(grade(4.5), "AA"); assert.equal(grade(3.2), "AA large"); assert.equal(grade(2), "fail"); assert.equal(grade(8), "AAA");
});

test("the one-click fix: white on ember fails, and the suggestion for the text colour passes", () => {
  assert.ok(ratio("#ffffff", "#df5a0f") < 4.5, "this is the theme's own rule");
  const fixed = suggestPassing("#ffffff", "#df5a0f");
  assert.ok(fixed && ratio(fixed, "#df5a0f") >= 4.5, `suggested ${fixed}`);
  assert.equal(suggestPassing("#17110b", "#ffffff"), "#17110b", "an already-passing pair is left alone");
  assert.equal(readableOn("#df5a0f"), "#17110b", "dark text on ember, as the theme says");
  assert.equal(readableOn("#5c1410"), "#ffffff");
});

test("every new project starts with a Swatch, and it is the active one", () => {
  const p = store.createProject({ name: "Brand A", starter: "social" });
  const sw = activeSwatch(store, p.id);
  assert.ok(p.swatchId);
  assert.equal(sw.id, p.swatchId);
  assert.equal(sw.colors.find((c) => c.role === "primary").hex, "#df5a0f");
});

test("tokens resolve against the swatch, and a plain value passes through", () => {
  const sw = FALLBACK_SWATCH;
  assert.equal(resolveToken(sw, "$color.primary"), "#df5a0f");
  assert.equal(resolveToken(sw, "$font.display"), "Bricolage Grotesque");
  assert.equal(resolveToken(sw, "#123456"), "#123456");
  assert.equal(resolveToken(sw, 42), 42);
  assert.deepEqual(resolveStyle(sw, { color: "$color.text", fontSize: 0.1 }), { color: "#17110b", fontSize: 0.1 });
});

test("changing the swatch changes what every token resolves to: the point of having one", () => {
  const p = store.createProject({ name: "Brand B", starter: "social" });
  const sw = activeSwatch(store, p.id);
  const before = colorFor(sw, "primary");
  const after = updateSwatch(store, sw.id, { colors: sw.colors.map((c) => (c.role === "primary" ? { ...c, hex: "#0044cc" } : c)) });
  assert.notEqual(colorFor(after, "primary"), before);
  const headline = store.listPatterns(p.id)[0].stitches.find((s) => s.slot === "headline");
  assert.equal(headline.style.color, "$color.text", "the pattern stores the ROLE, not a hex");
});

test("validation speaks plainly and enforces the minimum a pattern needs", () => {
  const p = store.createProject({ name: "Brand C" });
  const sw = activeSwatch(store, p.id);
  assert.throws(() => updateSwatch(store, sw.id, { colors: [{ role: "primary", name: "x", hex: "red" }] }), /not a colour\. Use six digits/);
  assert.throws(() => updateSwatch(store, sw.id, { colors: [{ role: "primary", name: "x", hex: "#ff0000" }] }), /needs a text colour/);
  assert.throws(() => updateSwatch(store, sw.id, { name: "  " }), /Give the swatch a name/);
  const nine = Array.from({ length: 9 }, (_, i) => ({ role: i < 3 ? ["primary", "text", "background"][i] : "accent", name: "c", hex: "#aabbcc" }));
  assert.throws(() => updateSwatch(store, sw.id, { colors: nine }), /up to 8/);
  assert.throws(() => updateSwatch(store, sw.id, { colors: [{ role: "nope", name: "x", hex: "#aabbcc" }] }), ValidationError);
});

test("several swatches per project; activate, duplicate, delete (never the last one)", () => {
  const p = store.createProject({ name: "Brand D" });
  const a = activeSwatch(store, p.id);
  const b = createSwatch(store, p.id, { template: "retail" });
  assert.equal(listSwatches(store, p.id).length, 2);
  assert.equal(activeSwatch(store, p.id).id, a.id, "creating one does not steal the active slot");
  setActiveSwatch(store, p.id, b.id);
  assert.equal(activeSwatch(store, p.id).id, b.id);
  const d = duplicateSwatch(store, b.id);
  assert.match(d.name, /copy$/);
  deleteSwatch(store, b.id);
  assert.notEqual(activeSwatch(store, p.id).id, b.id, "deleting the active swatch falls back to another");
  deleteSwatch(store, d.id);
  assert.throws(() => deleteSwatch(store, a.id), /at least one swatch/);
});

test("a swatch cannot be activated in a project it does not belong to", () => {
  const p1 = store.createProject({ name: "P1" }), p2 = store.createProject({ name: "P2" });
  assert.throws(() => setActiveSwatch(store, p1.id, activeSwatch(store, p2.id).id), /belongs to another project/);
  const copy = copySwatchToProject(store, activeSwatch(store, p2.id).id, p1.id);
  assert.equal(copy.projectId, p1.id);
});

test("duplicating a project carries the brand with it", () => {
  const p = store.createProject({ name: "Orig brand", starter: "social" });
  const sw = activeSwatch(store, p.id);
  updateSwatch(store, sw.id, { name: "Custom brand" });
  const copy = store.duplicateProject(p.id);
  assert.equal(activeSwatch(store, copy.id).name, "Custom brand");
  assert.notEqual(activeSwatch(store, copy.id).id, sw.id, "an independent copy");
});

test("colours can be proposed from an image, and are only proposals", async () => {
  const p = store.createProject({ name: "Extract" });
  const tmp = uploadTempPath(store, p.id); mkdirSync(join(tmp, ".."), { recursive: true });
  writeFileSync(tmp, await sharp({ create: { width: 900, height: 900, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer());
  const { yarn } = await importYarn(store, p.id, tmp, "photo.png");
  const before = activeSwatch(store, p.id);
  assert.equal(colorsFromYarn(store, yarn.id)[0], "#0a78c8");
  assert.deepEqual(activeSwatch(store, p.id).colors, before.colors, "nothing changed until the user accepts");
});

test("export then import into ANOTHER project round-trips the brand, logos included", async () => {
  const src = store.createProject({ name: "Export src" });
  const tmp = uploadTempPath(store, src.id); mkdirSync(join(tmp, ".."), { recursive: true });
  writeFileSync(tmp, await sharp({ create: { width: 1200, height: 400, channels: 3, background: { r: 200, g: 0, b: 90 } } }).png().toBuffer());
  const { yarn } = await importYarn(store, src.id, tmp, "wordmark.png", { name: "Wordmark" });
  const sw = updateSwatch(store, activeSwatch(store, src.id).id, { name: "Portable", logos: [{ yarnId: yarn.id, use: "full" }], voice: { summary: "Warm.", do: ["be brief"], dont: [], examples: ["Hi."] } });
  const file = JSON.parse(JSON.stringify(await exportSwatch(store, sw.id)));
  assert.equal(file.format, "knitted-swatch");
  const dest = store.createProject({ name: "Export dest" });
  const imported = await importSwatch(store, dest.id, file);
  assert.equal(imported.name, "Portable");
  assert.equal(imported.voice.summary, "Warm.");
  assert.equal(imported.logos.length, 1);
  assert.notEqual(imported.logos[0].yarnId, yarn.id, "the logo became Yarn in the new project");
  await assert.rejects(importSwatch(store, dest.id, { format: "something-else" }), /not a knitted swatch/);
  await assert.rejects(importSwatch(store, dest.id, { format: "knitted-swatch", version: 9, swatch: {} }), /newer knitted/);
});

test("fonts resolve from slots, falling back to the knitted faces", () => {
  assert.equal(fontFor({ ...FALLBACK_SWATCH, fonts: { display: { family: "Inter" }, body: { family: "Inter" } } }, "mono"), "Geist Mono");
});

test("website import refuses private addresses and never fetches them", async () => {
  await assert.rejects(proposeFromWebsite("http://127.0.0.1:9/"), /your own computer or network/);
  await assert.rejects(proposeFromWebsite("http://169.254.169.254/"), /your own computer or network/);
});
