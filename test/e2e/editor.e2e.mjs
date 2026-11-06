import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { axeProblems, launchBrowser, serverHas, startStudio } from "./harness.mjs";

let studio, browser, page, projectId, patternId, W, H;
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
const getPattern = async () => (await j("GET", `/api/patterns/${patternId}`)).body;
const stitch = async (slot) => (await getPattern()).stitches.find((s) => s.slot === slot);
const url = () => `${studio.url}/projects/${projectId}/patterns/${patternId}`;

/** Where the canvas overlay is on screen, and how big the frame is drawn. */
async function geo() {
  const b = await page.getByTestId("canvas-overlay").boundingBox();
  return { ...b, scale: b.width / W };
}
/** Screen point at the centre of a stitch (fractions of the frame). */
async function at(s, fx = 0.5, fy = 0.5) {
  const g = await geo();
  return { x: g.x + (s.x + s.w * fx) * W * g.scale, y: g.y + (s.y + s.h * fy) * H * g.scale };
}
const frameText = () => page.frameLocator('iframe[title="Pattern canvas"]').locator("body").innerText();
async function openEditor() { await page.goto(url()); await page.getByRole("application", { name: "Pattern canvas" }).waitFor(); await page.frameLocator('iframe[title="Pattern canvas"]').locator("[data-stitch-id]").first().waitFor(); }

before(async () => {
  studio = await startStudio();
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  projectId = (await j("POST", "/api/projects", { name: "Editor e2e", starter: "social" })).body.id;
  const [story] = (await j("GET", `/api/projects/${projectId}/patterns`)).body;
  patternId = story.id; W = story.size.w; H = story.size.h;
  await openEditor();
});
after(async () => { await browser?.close(); await studio?.stop(); });

test("the canvas shows the real pattern, rendered by the same page the engine uses", async () => {
  assert.match(await frameText(), /Make it knitted\./);
  const stitches = (await getPattern()).stitches;
  const f = page.frameLocator('iframe[title="Pattern canvas"]');
  for (const s of stitches) assert.equal(await f.locator(`[data-stitch-id="${s.id}"]`).count(), 1, `${s.slot} is on the canvas`);
  // The headline is drawn at its saved position in the frame, in frame pixels.
  const head = stitches.find((s) => s.slot === "headline");
  const box = await f.locator(`[data-stitch-id="${head.id}"]`).boundingBox();
  assert.ok(Math.abs((box.x - (await page.locator("iframe").boundingBox()).x) / (await geo()).scale - head.x * W) < 2);
});

test("a click selects, and the inspector names the stitch and its slot", async () => {
  const head = await stitch("headline");
  const p = await at(head);
  await page.mouse.click(p.x, p.y);
  await page.getByRole("complementary", { name: "Inspector" }).getByText("headline").first().waitFor();
  assert.equal(await page.getByLabel("Slot name").inputValue(), "headline");
  await page.mouse.click(5, 5); // empty space deselects
});

test("dragging moves a stitch by the right amount, and undo and redo restore it exactly", async () => {
  const before = await stitch("headline");
  const p = await at(before);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(p.x + 30, p.y + 20, { steps: 4 }); await page.mouse.move(p.x + 80, p.y + 50, { steps: 4 });
  await page.mouse.up();
  await page.getByText("Saved").first().waitFor();
  const moved = await stitch("headline");
  assert.ok(moved.x > before.x && moved.y > before.y, "it moved");
  const g = await geo();
  assert.ok(Math.abs((moved.x - before.x) * W * g.scale - 80) < 14, `moved about 80 screen px, got ${(moved.x - before.x) * W * g.scale}`);
  await page.keyboard.press("Control+z");
  await page.getByText("Saved").first().waitFor();
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.stitches.find((s) => s.slot === "headline").x === before.x);
  assert.deepEqual([(await stitch("headline")).x, (await stitch("headline")).y], [before.x, before.y], "undo is exact");
  await page.keyboard.press("Control+Shift+z");
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.stitches.find((s) => s.slot === "headline").x === moved.x);
});

test("dragging a resize handle grows the stitch, anchored on the opposite corner", async () => {
  const before = await stitch("headline");
  await page.mouse.click(...Object.values(await at(before)));
  const handle = page.locator('[data-handle="se"]');
  await handle.waitFor();
  const hb = await handle.boundingBox();
  const sx = hb.x + hb.width / 2, sy = hb.y + hb.height / 2;
  await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 40, sy + 20, { steps: 5 }); await page.mouse.up();
  await page.getByText("Saved").first().waitFor();
  const after = await stitch("headline");
  assert.ok(after.w > before.w && after.h > before.h);
  assert.equal(after.x, before.x, "the top-left corner is the anchor");
  assert.equal(after.y, before.y);
});

test("double-clicking text edits it in place, and Escape cancels", async () => {
  const head = await stitch("headline");
  const p = await at(head);
  await page.mouse.dblclick(p.x, p.y);
  const ta = page.getByLabel("Edit text");
  await ta.fill("Spring *sale*");
  await ta.press("Control+Enter");
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.stitches.find((s) => s.slot === "headline").content === "Spring *sale*");
  assert.match(await frameText(), /Spring sale/);
  assert.equal(await page.frameLocator('iframe[title="Pattern canvas"]').locator("em.accent").innerText(), "sale", "the starred word is the serif accent");
  await page.mouse.dblclick(p.x, p.y);
  await page.getByLabel("Edit text").fill("never saved");
  await page.getByLabel("Edit text").press("Escape");
  assert.equal((await stitch("headline")).content, "Spring *sale*");
});

test("the position fields in the inspector change the stitch, in frame pixels", async () => {
  const head = await stitch("headline");
  await page.mouse.click(...Object.values(await at(head)));
  await page.getByLabel("X position").fill("100");
  await page.getByLabel("X position").press("Enter");
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => Math.abs(p.stitches.find((s) => s.slot === "headline").x * W - 100) < 0.5);
});

test("keyboard: arrows nudge, Delete removes, duplicate adds, and undo brings the deleted one back", async () => {
  const eyebrow = await stitch("eyebrow");
  await page.mouse.click(...Object.values(await at(eyebrow)));
  await page.keyboard.press("ArrowRight");
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.stitches.find((s) => s.slot === "eyebrow").x > eyebrow.x);
  const count = (await getPattern()).stitches.length;
  await page.keyboard.press("Control+d");
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.stitches.length === count + 1);
  await page.keyboard.press("Delete");
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.stitches.length === count);
  await page.keyboard.press("Control+z");
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.stitches.length === count + 1);
});

test("Fill mode: locked stitches are inert, free slots are a form, and what is typed is saved", async () => {
  await page.getByRole("radio", { name: "Fill" }).click();
  const form = page.getByRole("complementary", { name: "Fill" });
  await form.getByText("What changes each time").waitFor();
  assert.equal(await form.getByLabel("eyebrow").count(), 0, "a locked slot is not on offer");
  const eyebrow = await stitch("eyebrow");
  await page.mouse.click(...Object.values(await at(eyebrow)));
  // The free full-bleed backdrop is underneath, so something may be selected; the locked eyebrow must not be.
  const selected = await page.locator("output.sr-only").innerText();
  assert.doesNotMatch(selected, /eyebrow/, `a locked stitch must be inert in Fill mode, got: ${selected}`);
  await form.getByLabel("headline").fill("Filled by a person");
  await form.getByLabel("headline").blur();
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.stitches.find((s) => s.slot === "headline").content === "Filled by a person");
  assert.match(await frameText(), /Filled by a person/);
});

test("back in Pattern mode the locked stitch is selectable again", async () => {
  // Fill mode first: even the layers list must not let a locked stitch be selected.
  await page.getByRole("radio", { name: "Fill" }).click();
  const layers = page.getByRole("list", { name: "Layers" });
  await layers.getByRole("button", { name: /^eyebrow/ }).click();
  assert.doesNotMatch(await page.locator("output.sr-only").innerText(), /eyebrow/, "locked stitches cannot be selected from the layers list in Fill mode");
  await page.getByRole("radio", { name: "Pattern" }).click();
  await layers.getByRole("button", { name: /^eyebrow/ }).click();
  await page.waitForFunction(() => /eyebrow/.test(document.querySelector("output.sr-only")?.textContent ?? ""));
});

test("a model editing from another process shows up on the open canvas without a reload", async () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("./fixtures/model-edit.mjs", import.meta.url)), patternId, "headline", "Written by your model"], { env: { ...process.env, KNITTED_HOME: studio.home }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  await page.frameLocator('iframe[title="Pattern canvas"]').getByText("Written by your model").waitFor({ timeout: 10000 });
});

test("layers: hide, lock, and select from the list", async () => {
  const layers = page.getByRole("list", { name: "Layers" });
  await layers.waitFor();
  await layers.getByRole("button", { name: "Hide logo" }).click();
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => !!p.stitches.find((s) => s.slot === "logo").style?.hidden);
  await layers.getByRole("button", { name: "Show logo" }).click();
  await layers.getByRole("button", { name: /^headline/ }).click();
  await page.getByLabel("Slot name").waitFor();
});

test("yarn: upload from the panel, click to place it, and the heat grade changes the render", async () => {
  const f = join(mkdtempSync(join(tmpdir(), "knitted-ed-")), "photo.png");
  writeFileSync(f, await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 30, g: 120, b: 200 } } }).png().toBuffer());
  await page.getByRole("button", { name: "Yarn", exact: true }).click();
  await page.getByLabel("Upload Yarn").setInputFiles(f);
  const use = page.getByRole("button", { name: "Use photo" });
  await use.waitFor();
  await use.click();
  const frame = page.frameLocator('iframe[title="Pattern canvas"]');
  await frame.locator("img").first().waitFor();
  // The canvas shows it before autosave lands, so wait for the saved pattern rather than racing it.
  let placed;
  for (let i = 0; i < 40 && !placed; i++) { placed = (await getPattern()).stitches.find((s) => s.yarnId); if (!placed) await new Promise((r) => setTimeout(r, 250)); }
  assert.ok(placed, "an image stitch was added with that yarn");
  await page.getByText("Heat grade").waitFor();
  await page.getByRole("radio", { name: "Ember" }).click();
  await frame.locator(".heat").first().waitFor();
});

test("history lists the changes and restores an earlier one", async () => {
  await page.getByRole("button", { name: "History" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByText("Current").waitFor();
  await drawer.getByRole("button", { name: "Restore" }).last().click();
  await page.getByText(/Restored/).first().waitFor();
});

test("reload keeps everything: the editor autosaves, nothing is lost", async () => {
  await openEditor();
  assert.ok((await getPattern()).stitches.length >= 4);
});

/** The canvas and the frame on it, on screen. */
const boxes = async () => ({ view: await page.getByTestId("canvas-view").boundingBox(), frame: await page.getByTestId("canvas-frame").boundingBox() });

test("scrolling moves the canvas but never loses the frame, and a pinch zooms gently about the pointer", async () => {
  await openEditor();
  for (let i = 0; i < 6; i++) await page.keyboard.press("Control+=");
  let { view, frame } = await boxes();
  assert.ok(frame.height > view.height, "zoomed in, the frame is bigger than the canvas");
  const mid = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  await page.mouse.move(mid.x, mid.y);
  // However far it is scrolled, an edge of the frame comes no more than 48px in from the canvas's edge.
  await page.mouse.wheel(0, 100000);
  ({ view, frame } = await boxes());
  assert.ok(frame.y + frame.height >= view.y + view.height - 49 && frame.y + frame.height <= view.y + view.height, "the bottom of the frame stays in reach");
  await page.mouse.wheel(0, -100000);
  ({ view, frame } = await boxes());
  assert.ok(frame.y <= view.y + 49 && frame.y >= view.y, "and so does the top");
  // Dragging with the middle button moves it by as much as the pointer moved.
  const before = frame.y;
  await page.mouse.down({ button: "middle" }); await page.mouse.move(mid.x, mid.y - 120, { steps: 6 }); await page.mouse.up({ button: "middle" });
  ({ view, frame } = await boxes());
  assert.ok(Math.abs(frame.y - (before - 120)) < 3, `dragged up 120px, moved ${before - frame.y}px`);
  // One step of a pinch zooms a little, and the point under the pointer stays where it is.
  // The drag left the pointer 120px up: back to the middle, where the point is measured.
  await page.mouse.move(mid.x, mid.y);
  const g1 = await geo();
  const u1 = { x: (mid.x - g1.x) / g1.scale, y: (mid.y - g1.y) / g1.scale };
  await page.keyboard.down("Control"); await page.mouse.wheel(0, -100); await page.keyboard.up("Control");
  await page.waitForFunction((w) => document.querySelector('[data-testid="canvas-overlay"]').getBoundingClientRect().width !== w, g1.width);
  const g2 = await geo();
  assert.ok(g2.scale / g1.scale > 1 && g2.scale / g1.scale <= 1.081, `zoomed by ${g2.scale / g1.scale}`);
  assert.ok(Math.abs((mid.x - g2.x) / g2.scale - u1.x) * g2.scale < 2 && Math.abs((mid.y - g2.y) / g2.scale - u1.y) * g2.scale < 2, "the point under the pointer stayed put");
  // Fit puts the whole frame back in view, in the middle.
  await page.keyboard.press("Control+0");
  await page.getByRole("button", { name: "Fit to screen" }).filter({ hasText: "Fit" }).waitFor();
  ({ view, frame } = await boxes());
  assert.ok(frame.y >= view.y && frame.y + frame.height <= view.y + view.height && Math.abs(frame.x - view.x - (view.x + view.width - frame.x - frame.width)) < 2);
});

test("both side bars fold away, stay folded after a reload, and come back with Ctrl+\\", async () => {
  await openEditor();
  const wide = (await page.getByTestId("canvas-view").boundingBox()).width;
  await page.getByRole("button", { name: "Hide the panel" }).click();
  await page.getByRole("button", { name: "Hide the Inspector" }).click();
  assert.equal(await page.getByRole("complementary", { name: "patterns panel" }).count(), 0);
  assert.equal(await page.getByRole("complementary", { name: "Inspector" }).count(), 0);
  assert.ok((await page.getByTestId("canvas-view").boundingBox()).width > wide + 400, "the canvas has the room");
  await openEditor();
  await page.getByRole("button", { name: "Show the panel" }).waitFor();
  await page.getByRole("button", { name: "Show the Inspector" }).waitFor();
  assert.equal(await page.getByRole("complementary", { name: "Inspector" }).count(), 0, "remembered");
  await page.keyboard.press("Control+\\");
  await page.getByRole("complementary", { name: "patterns panel" }).waitFor();
  await page.getByRole("complementary", { name: "Inspector" }).waitFor();
  await openEditor();
  await page.getByRole("complementary", { name: "Inspector" }).waitFor();
  // A tool pressed again folds its panel; pressed once more, it opens it.
  await page.getByRole("button", { name: "Patterns", exact: true }).click();
  assert.equal(await page.getByRole("complementary", { name: "patterns panel" }).count(), 0);
  await page.getByRole("button", { name: "Patterns", exact: true }).click();
  await page.getByRole("complementary", { name: "patterns panel" }).waitFor();
});

test("the trail says where the pattern is, renames it in place, and goes back up", async () => {
  await openEditor();
  const trail = page.getByRole("navigation", { name: "Breadcrumbs" });
  await trail.getByRole("link", { name: "Editor e2e" }).waitFor();
  assert.deepEqual(await trail.getByRole("link").allInnerTexts(), ["Projects", "Editor e2e", "Patterns"]);
  const name = trail.getByLabel("Pattern name");
  await name.fill("Renamed in the trail");
  await name.press("Enter");
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.name === "Renamed in the trail");
  await trail.getByRole("link", { name: "Editor e2e" }).click();
  await page.waitForURL(`**/projects/${projectId}`);
  await openEditor();
});

for (const theme of ["day", "night"]) {
  test(`no serious accessibility violations in the editor in ${theme}`, async () => {
    await openEditor();
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(500);
    const problems = (await axeProblems(page)).filter((p) => !p.startsWith("scrollable-region-focusable"));
    assert.deepEqual(problems, []);
  });
}
