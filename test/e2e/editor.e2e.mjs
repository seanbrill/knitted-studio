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
  assert.ok(Math.abs((box.x - (await page.locator('iframe[title="Pattern canvas"]').boundingBox()).x) / (await geo()).scale - head.x * W) < 2);
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
  await page.getByRole("button", { name: /^Zoom: fit to screen/ }).waitFor();
  ({ view, frame } = await boxes());
  assert.ok(frame.y >= view.y && frame.y + frame.height <= view.y + view.height && Math.abs(frame.x - view.x - (view.x + view.width - frame.x - frame.width)) < 2);
});

test("with Space held, or the hand on, a drag over a stitch moves the canvas and not the stitch", async () => {
  await openEditor();
  for (let i = 0; i < 6; i++) await page.keyboard.press("Control+=");
  const stitches = JSON.stringify((await getPattern()).stitches);
  let { view, frame } = await boxes();
  const mid = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  const drag = async (dy) => { await page.mouse.move(mid.x, mid.y); await page.mouse.down(); await page.mouse.move(mid.x, mid.y + dy, { steps: 6 }); await page.mouse.up(); };
  await page.keyboard.down("Space");
  await drag(-80);
  await page.keyboard.up("Space");
  let moved = (await boxes()).frame;
  assert.ok(Math.abs(moved.y - (frame.y - 80)) < 3, `Space and a drag moved it ${frame.y - moved.y}px`);
  // The hand stays on until it is put down: H, or the button again.
  const hand = page.getByRole("button", { name: "Hand" });
  await hand.click();
  assert.equal(await hand.getAttribute("aria-pressed"), "true");
  frame = moved;
  await drag(60);
  moved = (await boxes()).frame;
  assert.ok(Math.abs(moved.y - (frame.y + 60)) < 3, `the hand moved it ${moved.y - frame.y}px`);
  await page.keyboard.press("h");
  assert.equal(await hand.getAttribute("aria-pressed"), "false");
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(JSON.stringify((await getPattern()).stitches), stitches, "no stitch moved");
});

test("the zoom menu: a size, fit, and zoom to what is selected, as big as the canvas holds it", async () => {
  await openEditor();
  await page.getByRole("button", { name: /^Zoom: fit to screen/ }).click();
  await page.getByRole("menuitem", { name: /^200%/ }).click();
  await page.getByRole("button", { name: "Zoom: 200%" }).waitFor();
  await page.keyboard.press("Shift+Digit1");
  await page.getByRole("button", { name: /^Zoom: fit to screen/ }).waitFor();
  // Nothing selected: zoom to selection waits for something to be.
  await page.getByRole("button", { name: /^Zoom: fit to screen/ }).click();
  assert.equal(await page.getByRole("menuitem", { name: /select something first/ }).getAttribute("aria-disabled"), "true");
  await page.keyboard.press("Escape");
  await page.getByRole("list", { name: "Layers" }).getByRole("button", { name: /^headline/ }).click();
  await page.getByRole("button", { name: /^Zoom: fit to screen/ }).click();
  await page.getByRole("menuitem", { name: /^Zoom to selection/ }).click();
  await page.waitForFunction(() => !/fit to screen/.test(document.querySelector('[aria-label^="Zoom:"]')?.getAttribute("aria-label") ?? "fit to screen"));
  await page.waitForTimeout(200);
  const view = await page.getByTestId("canvas-view").boundingBox();
  const headline = (await getPattern()).stitches.find((s) => s.slot === "headline");
  const sel = await page.getByTestId(`outline-${headline.id}`).first().boundingBox();
  assert.ok(sel.x >= view.x && sel.y >= view.y && sel.x + sel.width <= view.x + view.width && sel.y + sel.height <= view.y + view.height, "the whole selection is in view");
  assert.ok(Math.abs(sel.width - (view.width - 96)) < 4 || Math.abs(sel.height - (view.height - 96)) < 4, `and as big as the canvas holds it: ${sel.width}x${sel.height} in ${view.width}x${view.height}`);
  // A double-click on the space round the frame fits it again. Zoomed in, the frame may fill the
  // view: out a few steps first, so there is space to click.
  for (let i = 0; i < 8; i++) await page.keyboard.press("Control+-");
  const f = await page.getByTestId("canvas-frame").boundingBox();
  assert.ok(f.x > view.x + 12, "space to the left of the frame");
  await page.mouse.dblclick(view.x + 6, view.y + view.height / 2);
  await page.getByRole("button", { name: /^Zoom: fit to screen/ }).waitFor();
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
  assert.deepEqual(await trail.getByRole("link").allInnerTexts(), ["Projects", "Editor e2e"]);
  await page.getByRole("link", { name: "Back to Editor e2e" }).waitFor();
  const name = page.getByLabel("Pattern name");
  await name.fill("Renamed in the trail");
  await name.press("Enter");
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.name === "Renamed in the trail");
  await trail.getByRole("link", { name: "Editor e2e" }).click();
  await page.waitForURL(`**/projects/${projectId}`);
  await openEditor();
});

test("the pattern list shows each pattern drawn small, and the one open is drawn in it", async () => {
  await openEditor();
  const rail = page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: "Patterns", exact: true });
  if ((await rail.getAttribute("aria-pressed")) !== "true") await rail.click();
  const open = page.locator('a[aria-current="page"].panel-pattern');
  await open.locator(".panel-pattern-thumb iframe").waitFor({ state: "attached" });
  // Drawn by the real renderer, from this pattern: its headline is in the picture.
  const head = await stitch("headline");
  await open.frameLocator(".panel-pattern-thumb iframe").locator(`[data-stitch-id="${head.id}"]`).waitFor({ state: "attached" });
});

test("with nothing selected, the inspector checks it before it knits, and a problem picks its stitch", async () => {
  await openEditor();
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await inspector.getByText("Before it knits").waitFor();
  // A model empties the headline from another process: the check is run again on what was saved.
  const was = (await stitch("headline")).content;
  const edit = (text) => spawnSync(process.execPath, [fileURLToPath(new URL("./fixtures/model-edit.mjs", import.meta.url)), patternId, "headline", text], { env: { ...process.env, KNITTED_HOME: studio.home }, encoding: "utf8" });
  assert.equal(edit("").status, 0);
  const problem = inspector.getByRole("list", { name: "Before it knits" }).getByRole("button", { name: /The headline text is empty/ });
  await problem.waitFor({ timeout: 10000 });
  assert.match(await inspector.getByRole("status").filter({ hasText: /to look at|to fix/ }).innerText(), /\d+ to look at/);
  await problem.click();
  assert.equal(await page.getByLabel("Slot name").inputValue(), "headline", "the problem picks the stitch it is about");
  assert.equal(edit(was).status, 0);
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.stitches.find((s) => s.slot === "headline").content === was);
});

test("Custom size: any width and height, the shape kept on request, sizes worth starting from, and undo puts it back", async () => {
  await openEditor();
  const was = (await getPattern()).size;
  await page.getByRole("combobox", { name: "Size" }).click();
  await page.getByRole("option", { name: /^Custom/ }).click();
  const dlg = page.getByRole("dialog", { name: "Custom size" });
  await dlg.getByText(new RegExp(`, from Story ${was.w} × ${was.h}$`)).waitFor();
  assert.equal(await dlg.getByRole("button", { name: `Make it ${was.w} × ${was.h}` }).isDisabled(), true, "the size it is already");

  // Linked, the height follows the width in the shape it has.
  await dlg.getByRole("button", { name: "Keep the shape" }).click();
  assert.equal(await dlg.getByRole("button", { name: "Keep the shape" }).getAttribute("aria-pressed"), "true");
  await dlg.getByLabel("Width").fill(String(was.w / 2));
  assert.equal(await dlg.getByLabel("Height").inputValue(), String(was.h / 2));
  await dlg.getByRole("button", { name: "Keep the shape" }).click();

  await dlg.getByLabel("Width").fill("9000");
  await dlg.getByRole("alert").filter({ hasText: "Use pixels between 16 and 8000." }).waitFor();
  assert.equal(await dlg.getByRole("button", { name: "Make it this size" }).isDisabled(), true);

  await dlg.getByRole("button", { name: /^Link preview/ }).click();
  assert.deepEqual([await dlg.getByLabel("Width").inputValue(), await dlg.getByLabel("Height").inputValue()], ["1200", "628"]);
  await dlg.getByText(/^1\.91:1, the shape of a link preview on LinkedIn, X and Facebook\./).waitFor();
  await dlg.getByRole("figure", { name: /The new size, 1200 by 628, over the old one/ }).waitFor();
  await dlg.getByRole("button", { name: "Make it 1200 × 628" }).click();
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.size.w === 1200 && p.size.h === 628 && p.size.name === "Custom");
  await page.getByRole("combobox", { name: "Size" }).getByText("1200x628").waitFor();

  await page.keyboard.press("Control+z");
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.size.w === was.w && p.size.h === was.h);
});

test("the editor's keys are in the shortcuts list, from ? or the menu's key, and its buttons show this computer's keys", async () => {
  await openEditor();
  await page.keyboard.press("?");
  const keys = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await keys.getByRole("region", { name: "The editor" }).getByText("Duplicate").waitFor();
  await page.keyboard.press("Escape");
  await keys.waitFor({ state: "detached" });
  await page.keyboard.press("Control+/");
  await keys.waitFor();
  await page.keyboard.press("Escape");
  await keys.waitFor({ state: "detached" });
  const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
  await page.getByRole("button", { name: "Zoom in" }).hover();
  await page.getByRole("tooltip").getByText(mac ? "⌘+" : "Ctrl++").waitFor();
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
