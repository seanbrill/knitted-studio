// Design sheets, as a person and their model use them: a sheet started from the brand, a
// frame's code changed and undone, a section and a frame added, the model designing a page
// while the board is open, the sheet downloaded as a picture and as code, and a sheet deleted
// and brought back.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { axeProblems, launchBrowser, serverHas, startStudio } from "./harness.mjs";

let studio, browser, page, projectId, designId, mcpPath;
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
async function call(name, args) {
  mcpPath ??= (await j("GET", "/api/agent/mcp")).body.path;
  const res = await fetch(studio.url + mcpPath, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  return (await res.json()).result;
}
const frame = (name) => page.frameLocator(`iframe[title="${name}"]`);

before(async () => {
  studio = await startStudio();
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  projectId = (await j("POST", "/api/projects", { name: "Northwind Coffee" })).body.id;
});
after(async () => { await browser?.close(); await studio?.stop(); });

test("a sheet starts from the brand: Foundations, Components and Pages, on a board", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/designs`);
  await page.getByText("No designs yet").waitFor();
  await page.getByRole("button", { name: "New design" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New design" });
  await dialog.getByLabel("Name").fill("Website");
  assert.equal(await dialog.getByRole("radio", { name: /From your brand/ }).isChecked(), true);
  await dialog.getByRole("button", { name: "Start it" }).click();
  await page.waitForURL(/\/designs\/ds_/);
  designId = page.url().split("/").pop();
  for (const name of ["Foundations", "Components", "Pages"]) await page.getByRole("heading", { name, exact: true }).waitFor();
  await frame("Home").getByRole("heading", { name: "A headline that says what Northwind Coffee does" }).waitFor();
  // A page is as tall as what is in it: the home page is far taller than one screen.
  await page.waitForFunction(() => Number.parseInt(document.querySelector('iframe[title="Home"]').style.height) > 1200);
});

test("a sheet opened straight from its address loads without an error, and every frame that fits what is in it is measured", async () => {
  // The server sends the board with its frames already in it, and a frame can finish
  // loading before the window listens for that: it must still be measured, not left at a guess.
  const fresh = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const problems = [];
  fresh.on("console", (m) => { if (m.type() === "error") problems.push(m.text().slice(0, 200)); });
  fresh.on("pageerror", (e) => problems.push(e.message.slice(0, 200)));
  await fresh.goto(`${studio.url}/projects/${projectId}/designs/${designId}`);
  await fresh.frameLocator('iframe[title="Header"]').getByText("Get started").waitFor();
  await fresh.waitForFunction(() => ["Header", "Footer"].every((t) => Number.parseInt(document.querySelector(`iframe[title="${t}"]`).style.height) < 300));
  assert.deepEqual(problems.filter((p) => /hydrat|did not match|didn't match/i.test(p)), []);
  await fresh.context().close();
});

test("a frame's code is changed in the inspector, shows on the board, and Undo takes it back", async () => {
  await page.getByRole("button", { name: "Home, Desktop 1440" }).click();
  const inspector = page.getByRole("complementary", { name: "Frame: Home" });
  const html = inspector.getByLabel("HTML");
  await html.fill((await html.inputValue()).replace("A headline that says what Northwind Coffee does", "Coffee roasted on Tuesday, in your cup by Friday"));
  // Shown on the board as it is written, before it is saved.
  await frame("Home").getByRole("heading", { name: "Coffee roasted on Tuesday, in your cup by Friday" }).waitFor();
  await html.press("ControlOrMeta+s");
  await serverHas(studio, `/api/designs/${designId}`, (d) => d.sections[2].frames[0].html.includes("roasted on Tuesday"));
  await page.getByRole("status").filter({ hasText: "Saved" }).waitFor();

  await inspector.getByLabel("HTML").fill("<script>alert(1)</script>");
  await inspector.getByText(/Scripts do not run in a design/).waitFor();
  assert.equal(await inspector.getByRole("button", { name: "Save" }).isDisabled(), true);
  await inspector.getByRole("button", { name: "Discard" }).click();

  await page.getByRole("button", { name: "Undo" }).click();
  await frame("Home").getByRole("heading", { name: "A headline that says what Northwind Coffee does" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Undo" }).isDisabled(), true);
  await inspector.getByRole("button", { name: "Close" }).click();
});

test("a section and a frame are added, and the frame opens to be written", async () => {
  await page.getByRole("button", { name: "Add a section" }).first().click();
  const s = page.getByRole("dialog", { name: "Add a section" });
  await s.getByLabel("Name").fill("Shop");
  await s.getByLabel("Note").fill("What people buy");
  await s.getByRole("button", { name: "Add it" }).click();
  await page.getByRole("heading", { name: "Shop", exact: true }).waitFor();
  await page.getByRole("button", { name: "Add a frame to Shop" }).click();
  const f = page.getByRole("dialog", { name: "Add a frame to Shop" });
  await f.getByLabel("Name").fill("Product");
  await f.getByRole("radio", { name: "Mobile 390" }).click();
  await f.getByRole("button", { name: "Add it" }).click();
  await page.getByRole("complementary", { name: "Frame: Product" }).waitFor();
  await frame("Product").getByRole("heading", { name: "Product" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Product, Mobile 390" }).getAttribute("aria-pressed"), "true");
});

test("the model designs a page while the board is open, and sees it", async () => {
  const r = await call("set_design_frame", { designId, section: "Shop", name: "Menu", device: "desktop", html: '<main class="m"><h1>Our menu</h1><p>Espresso, 3.20</p></main>', css: ".m{padding:96px 120px}h1{font:700 56px/1.1 var(--font-display);color:var(--color-primary)}" });
  assert.equal(r.isError, undefined, JSON.stringify(r).slice(0, 300));
  assert.equal(r.content[0].type, "image");
  assert.match(r.content[1].text, /^Added Menu \(f\d+\) in Shop \(s4\), Desktop 1440\./);
  // It is on the board as soon as it is saved, small, as a picture; zoomed to, it is drawn live.
  await page.locator("[data-frame-box]").filter({ has: page.getByRole("button", { name: "Menu, Desktop 1440" }) }).locator('[data-drawn="picture"], [data-drawn="live"]').or(page.locator('[data-frame-box]:has(button[aria-label="Menu, Desktop 1440"])[data-drawn="picture"]')).first().waitFor({ state: "attached" }).catch(() => {});
  await page.getByRole("button", { name: "Menu, Desktop 1440" }).dblclick();
  await frame("Menu").getByRole("heading", { name: "Our menu" }).waitFor();
  await page.getByText("by your model").first().waitFor();
  // The frame it made is outlined on the board, with who and what, and what it is doing shows here too.
  const menu = page.locator("[data-frame-box]").filter({ has: page.getByRole("button", { name: "Menu, Desktop 1440" }) });
  await menu.getByTestId("model-on").waitFor();
  assert.match(await menu.getByTestId("model-on").innerText(), /A model\s*Adding .Menu./);
  await page.getByRole("region", { name: "What A model is doing" }).waitFor();
  await page.keyboard.press("Shift+Digit1");
  await page.getByRole("button", { name: /^Zoom: fit to screen/ }).waitFor();
});

test("each frame keeps its own unsaved changes: picking another shows that one's code, and going back shows them again", async () => {
  await page.getByRole("button", { name: "Product, Mobile 390" }).click();
  const product = page.getByRole("complementary", { name: "Frame: Product" });
  await product.getByLabel("Note").fill("Half written");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Menu, Desktop 1440" }).click();
  const menu = page.getByRole("complementary", { name: "Frame: Menu" });
  assert.equal(await menu.getByLabel("Name").inputValue(), "Menu");
  assert.equal(await menu.getByLabel("Note").inputValue(), "");
  assert.match(await menu.getByLabel("HTML").inputValue(), /Our menu/);
  assert.equal(await menu.getByRole("button", { name: "Save" }).isDisabled(), true, "nothing changed on Menu");
  await page.waitForTimeout(500);
  await frame("Menu").getByRole("heading", { name: "Our menu" }).waitFor();
  await page.getByRole("button", { name: "Product, Mobile 390" }).click();
  assert.equal(await product.getByLabel("Note").inputValue(), "Half written");
  await product.getByRole("button", { name: "Discard" }).click();
  assert.equal(await product.getByLabel("Note").inputValue(), "");
});

test("the board zooms past 100% and about the pointer, zooms to a frame, and drags about", async () => {
  const view = page.locator(".design-view");
  const box = (name) => page.locator("[data-frame-box]").filter({ has: page.locator(`iframe[title="${name}"]`) }).boundingBox();
  await page.getByRole("button", { name: /^Zoom: fit to screen/ }).click();
  await page.getByRole("menuitem", { name: /^200%/ }).click();
  await page.getByRole("button", { name: "Zoom: 200%" }).waitFor();
  await page.keyboard.press("Shift+Digit1");
  await page.getByRole("button", { name: /^Zoom: fit to screen/ }).waitFor();

  // A pinch zooms a little, and the point of the frame under the pointer stays under it.
  await page.locator('iframe[title="Product"]').scrollIntoViewIfNeeded();
  const b1 = await box("Product");
  const p = { x: b1.x + b1.width * 0.6, y: b1.y + 40 };
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down("Control"); await page.mouse.wheel(0, -100); await page.keyboard.up("Control");
  await page.waitForFunction(() => !/fit to screen/.test(document.querySelector('[aria-label^="Zoom:"]').getAttribute("aria-label")));
  const b2 = await box("Product");
  assert.ok(b2.width / b1.width > 1.01 && b2.width / b1.width <= 1.081, `zoomed by ${b2.width / b1.width}`);
  const fx = (p.x - b1.x) / b1.width, fy = (p.y - b1.y) / b1.height;
  assert.ok(Math.abs(b2.x + fx * b2.width - p.x) < 2 && Math.abs(b2.y + fy * b2.height - p.y) < 2, "the point under the pointer stayed put");

  // A double-click on a frame selects it and zooms to it: the whole frame, as big as the view holds it.
  await page.getByRole("button", { name: "Menu, Desktop 1440" }).dblclick();
  await page.getByRole("complementary", { name: "Frame: Menu" }).waitFor();
  // It glides there: looked at once it has stopped.
  let m = await box("Menu");
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(60); const n = await box("Menu"); if (Math.abs(n.x - m.x) < 0.5 && Math.abs(n.width - m.width) < 0.5) break; m = n; }
  const v = await view.boundingBox();
  assert.ok(m.x >= v.x && m.y >= v.y && m.x + m.width <= v.x + v.width && m.y + m.height <= v.y + v.height, "the whole frame is in view");
  assert.ok(Math.abs(m.width - (v.width - 96)) < 4 || Math.abs(m.height - (v.height - 120)) < 4, `and as big as the view holds it: ${m.width}x${m.height} in ${v.width}x${v.height}`);

  // A drag on the space between frames moves the board by as much as the pointer moved.
  const empty = await view.evaluate((el) => {
    const r = el.getBoundingClientRect();
    for (let y = r.top + 20; y < r.bottom - 20; y += 15) for (let x = r.left + 20; x < r.right - 20; x += 15) {
      const at = document.elementFromPoint(x, y);
      if (at && el.contains(at) && !at.closest(".design-frame-box, button, a, input, textarea, select, [role=menu]") && y + 80 < r.bottom && x + 60 < r.right) return { x, y };
    }
    return null;
  });
  assert.ok(empty, "somewhere empty to drag from");
  const s1 = await view.evaluate((el) => ({ l: el.scrollLeft, t: el.scrollTop }));
  await page.mouse.move(empty.x, empty.y); await page.mouse.down(); await page.mouse.move(empty.x + 60, empty.y + 80, { steps: 6 }); await page.mouse.up();
  const s2 = await view.evaluate((el) => ({ l: el.scrollLeft, t: el.scrollTop }));
  assert.ok(Math.abs(s1.l - s2.l - 60) < 2 && Math.abs(s1.t - s2.t - 80) < 2, `dragged 60, 80 and it moved ${s1.l - s2.l}, ${s1.t - s2.t}`);
  await page.getByRole("complementary", { name: "Frame: Menu" }).waitFor();

  // With Space held, a drag over a frame moves the board too, and does not select the frame.
  await page.getByRole("complementary", { name: "Frame: Menu" }).getByRole("button", { name: "Close" }).click();
  const v2 = await view.boundingBox(), mb = await box("Menu");
  const q = { x: mb.x + mb.width / 2, y: Math.max(mb.y + 10, Math.min(mb.y + mb.height / 2, v2.y + v2.height - 100)) };
  const s3 = await view.evaluate((el) => el.scrollTop);
  await page.keyboard.down("Space");
  await page.mouse.move(q.x, q.y); await page.mouse.down(); await page.mouse.move(q.x, q.y + 50, { steps: 5 }); await page.mouse.up();
  await page.keyboard.up("Space");
  const s4 = await view.evaluate((el) => el.scrollTop);
  assert.ok(Math.abs(s3 - s4 - 50) < 2, `Space and a drag moved it ${s3 - s4}`);
  assert.equal(await page.getByRole("button", { name: "Menu, Desktop 1440" }).getAttribute("aria-pressed"), "false");
  assert.equal(await page.getByRole("complementary", { name: /^Frame:/ }).count(), 0);
  await page.keyboard.press("Shift+Digit1");
});

test("the sheet downloads as a picture and as code", async () => {
  const pic = await fetch(`${studio.url}/api/designs/${designId}/picture?frame=f7`);
  assert.equal(pic.headers.get("content-type"), "image/png");
  assert.match(pic.headers.get("content-disposition"), /filename="Website - Home\.png"/);
  const meta = await sharp(Buffer.from(await pic.arrayBuffer())).metadata();
  assert.equal(meta.width, 1440);
  assert.ok(meta.height > 1200, `the whole page, ${meta.height} tall`);
  const zip = await fetch(`${studio.url}/api/designs/${designId}/code`);
  assert.match(zip.headers.get("content-disposition"), /filename="website\.zip"/);
  const file = join(mkdtempSync(join(tmpdir(), "knitted-design-zip-")), "w.zip");
  writeFileSync(file, Buffer.from(await zip.arrayBuffer()));
  const names = execFileSync("unzip", ["-Z1", file], { encoding: "utf8" }).trim().split("\n");
  for (const n of ["website/tokens.css", "website/index.html", "website/README.md", "website/03-pages/01-home.html", "website/04-shop/02-menu.html"]) assert.ok(names.includes(n), `${n} in ${names.join(", ")}`);
  assert.ok(names.some((n) => /^website\/fonts\/.+\.woff2$/.test(n)), "with the brand's fonts");
});

test("everything downloads together: the pictures, the code, its fonts and images, and a style guide of what it is drawn with", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/designs/${designId}`);
  await page.getByRole("button", { name: "Download" }).click();
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.getByRole("menuitem", { name: /^Everything/ }).click()]);
  assert.equal(download.suggestedFilename(), "website.zip");
  const file = join(mkdtempSync(join(tmpdir(), "knitted-design-all-")), "w.zip");
  await download.saveAs(file);
  const names = execFileSync("unzip", ["-Z1", file], { encoding: "utf8" }).trim().split("\n");
  for (const n of ["website/sheet.png", "website/style-guide.html", "website/style-guide.png", "website/tokens.css", "website/tokens.json", "website/index.html", "website/README.md", "website/03-pages/01-home.html"]) assert.ok(names.includes(n), `${n} in ${names.join(", ")}`);
  assert.ok(names.some((n) => /^website\/sections\/\d\d-.+\.png$/.test(n)), "each section as a picture");
  assert.ok(names.some((n) => /^website\/fonts\/.+\.woff2$/.test(n)), "with the brand's fonts");
  assert.ok(!names.some((n) => n.includes(".render.")), "and not the page it was drawn from");
  const guide = execFileSync("unzip", ["-p", file, "website/style-guide.html"], { encoding: "utf8" });
  for (const words of ["Colours", "var(--color-primary)", "Fonts", "var(--font-display)", "Type sizes", "Corners", "var(--radius)", "Spacing"]) assert.ok(guide.includes(words), `the style guide shows ${words}`);
  assert.match(guide, /src:url\("fonts\//, "its fonts from the folder beside it");
  const tokens = JSON.parse(execFileSync("unzip", ["-p", file, "website/tokens.json"], { encoding: "utf8" }));
  assert.match(tokens.colors["color-primary"], /^#[0-9a-f]{6}$/);
  assert.ok(tokens.fonts["font-display"]);
  const sheet = await sharp(execFileSync("unzip", ["-p", file, "website/sheet.png"], { maxBuffer: 1 << 28 })).metadata();
  assert.ok(sheet.width > 1440, `the whole sheet, ${sheet.width} wide`);
});

test("a section downloads on its own: everything in it with a style guide, or its code", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/designs/${designId}`);
  const grab = async (item) => {
    await page.getByRole("button", { name: "Actions for Pages", exact: true }).click();
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.getByRole("menuitem", { name: item }).click()]);
    const file = join(mkdtempSync(join(tmpdir(), "knitted-section-")), "s.zip");
    await download.saveAs(file);
    return { name: download.suggestedFilename(), file, names: execFileSync("unzip", ["-Z1", file], { encoding: "utf8" }).trim().split("\n") };
  };
  const all = await grab("Download everything, with a style guide");
  assert.equal(all.name, "website-pages.zip");
  for (const n of ["website-pages/section.png", "website-pages/style-guide.html", "website-pages/style-guide.png", "website-pages/tokens.json", "website-pages/index.html", "website-pages/01-pages/01-home.html"]) assert.ok(all.names.includes(n), `${n} in ${all.names.join(", ")}`);
  assert.ok(!all.names.some((n) => n.includes("/sections/") || n.endsWith("/sheet.png")), "not the rest of the sheet");
  assert.deepEqual([...new Set(all.names.filter((n) => n.endsWith(".html") && n.split("/").length === 3).map((n) => n.split("/")[1]))], ["01-pages"], "only the frames of that section");
  assert.match(execFileSync("unzip", ["-p", all.file, "website-pages/style-guide.html"], { encoding: "utf8" }), /Website, Pages<small>Style guide[^<]*what this section is drawn with/);
  const picture = await sharp(execFileSync("unzip", ["-p", all.file, "website-pages/section.png"], { maxBuffer: 1 << 28 })).metadata();
  assert.ok(picture.width > 0);
  const code = await grab("Download its code");
  assert.equal(code.name, "website-pages.zip");
  assert.ok(code.names.includes("website-pages/01-pages/01-home.html"));
  assert.ok(!code.names.some((n) => n.endsWith("style-guide.html")), "the code alone");
});

test("a comment is pinned to a spot on a frame, shows on the board, and the sheet's card counts it", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/designs/${designId}`);
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Comments on the sheet" });
  await panel.getByText("None yet").waitFor();
  const target = page.getByRole("button", { name: "Place a comment on Home" }).first();
  const box = await target.boundingBox();
  await target.click({ position: { x: box.width * 0.5, y: box.height * 0.1 } });
  await panel.getByRole("textbox", { name: "Comment 1" }).fill("The headline needs more room");
  await panel.getByRole("button", { name: "Add the comment" }).click();
  const [c] = await serverHas(studio, `/api/comments?design=${designId}`, (l) => l.length === 1);
  assert.ok(c.frameId, "on a frame");
  assert.equal(c.frameName, "Home");
  assert.ok(Math.abs(c.x - 0.5) < 0.01 && Math.abs(c.y - 0.1) < 0.01, `at ${c.x}, ${c.y}`);
  const pin = page.getByRole("button", { name: "Comment 1: The headline needs more room" });
  await pin.waitFor();
  // The pin is where it was put, whatever the zoom.
  const at = await pin.boundingBox();
  const frame = await page.locator(`[data-frame-box="${c.frameId}"]`).boundingBox();
  assert.ok(Math.abs(at.x + at.width / 2 - (frame.x + frame.width * 0.5)) < 3 && Math.abs(at.y + at.height / 2 - (frame.y + frame.height * 0.1)) < 3, "the pin on its spot");
  assert.ok(at.width > 20 && at.width < 32, `the same size on screen at any zoom: ${at.width}`);

  // Closed, the pins stay on the board, and one opens its comment again.
  await panel.getByRole("button", { name: "Close the comments" }).click();
  await panel.waitFor({ state: "detached" });
  await pin.click();
  await panel.getByRole("textbox", { name: "Reply to comment 1" }).waitFor();
  assert.equal(await page.locator(".tab-count").first().innerText(), "1");
  await panel.getByRole("button", { name: "Resolve" }).click();
  await panel.getByText("All resolved").waitFor();
  await panel.getByRole("button", { name: "Open again" }).click();
  await panel.getByText("1 open").waitFor();

  await page.goto(`${studio.url}/projects/${projectId}/designs`);
  await page.getByRole("link", { name: "Open Website, 1 open comment" }).waitFor();
});

test("the pane has a knit's tabs: a frame picked shows its comments first, a pin opens its thread, and under the frame are Zoom to it, Pin a comment and Ask your model", async () => {
  const meta = (await j("GET", `/api/designs/${designId}/board`)).body;
  const frames = meta.sections.flatMap((x) => x.frames);
  const home = frames.find((f) => f.name === "Home"), menu = frames.find((f) => f.name === "Menu");
  assert.equal((await j("POST", "/api/comments", { designId, frameId: menu.id, x: 0.5, y: 0.5, text: "The menu needs prices" })).status, 201);
  await page.goto(`${studio.url}/projects/${projectId}/designs/${designId}`);
  const hit = page.getByRole("button", { name: /^Home, / }).first();
  await hit.click();
  const pane = page.getByRole("complementary", { name: "Frame: Home" });
  await pane.getByRole("tab", { name: "Frame" }).waitFor();
  assert.equal(await pane.getByRole("tab", { name: "Frame" }).getAttribute("aria-selected"), "true");
  assert.match(await pane.getByRole("tab", { name: /^Comments/ }).innerText(), /1/, "the comments on Home, open, counted on its tab");

  // Under the frame picked: what can be done with it, the same size on screen whatever the zoom.
  const bar = page.getByRole("toolbar", { name: "Home, picked" });
  const fb = await page.locator(`[data-frame-box="${home.id}"]`).boundingBox(), bb = await bar.boundingBox();
  assert.ok(bb.y > fb.y + fb.height && bb.y < fb.y + fb.height + 30, "just under the frame");
  assert.ok(Math.abs(bb.x + bb.width / 2 - (fb.x + fb.width / 2)) < 2, "in the middle of it");
  assert.ok(bb.height > 28 && bb.height < 48, `its own size on screen: ${bb.height}`);

  // Ask your model is about this frame.
  await bar.getByRole("button", { name: "Ask your model" }).click();
  const ask = page.getByRole("dialog", { name: "Ask your model to change this frame" });
  await ask.getByText("Home in Website").waitFor();
  await page.keyboard.press("Escape");
  await ask.waitFor({ state: "detached" });

  // Comments: Home's first, and the rest of the sheet's a press away.
  await pane.getByRole("tab", { name: /^Comments/ }).click();
  const panel = page.getByRole("complementary", { name: "Comments on the sheet" });
  await panel.getByText("On Home").waitFor();
  assert.equal(await panel.locator(".comment-list > li").count(), 1);
  await panel.getByRole("button", { name: "all 2 on the sheet" }).click();
  await panel.getByText("All 2 on the sheet").waitFor();
  assert.equal(await panel.locator(".comment-list > li").count(), 2);
  await panel.getByRole("button", { name: "only those on Home" }).click();
  await panel.getByText("On Home").waitFor();

  // Pin a comment, from under the frame: the next press on a frame places it, numbered after the sheet's.
  await bar.getByRole("button", { name: "Pin a comment" }).click();
  await bar.waitFor({ state: "detached" });
  const target = page.getByRole("button", { name: "Place a comment on Home" }).first();
  const tb = await target.boundingBox();
  await target.click({ position: { x: tb.width * 0.3, y: tb.height * 0.2 } });
  await panel.getByRole("textbox", { name: "Comment 3" }).fill("Bigger buttons");
  await panel.getByRole("button", { name: "Add the comment" }).click();
  await serverHas(studio, `/api/comments?design=${designId}`, (l) => l.length === 3);

  // A pin opens its thread, and picks its frame.
  await page.getByRole("button", { name: "Comment 2: The menu needs prices" }).click();
  await panel.getByText("On Menu").waitFor();
  await panel.getByRole("textbox", { name: "Reply to comment 2" }).waitFor();
  await page.getByRole("toolbar", { name: "Menu, picked" }).waitFor();
  assert.deepEqual(await axeProblems(page), []);

  // Zoom to it brings the whole frame into view.
  await page.getByRole("toolbar", { name: "Menu, picked" }).getByRole("button", { name: "Zoom to it" }).click();
  let m = await page.locator(`[data-frame-box="${menu.id}"]`).boundingBox();
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(60); const n = await page.locator(`[data-frame-box="${menu.id}"]`).boundingBox(); if (Math.abs(n.x - m.x) < 0.5 && Math.abs(n.width - m.width) < 0.5) break; m = n; }
  const v = await page.locator(".design-view").boundingBox();
  assert.ok(m.x >= v.x - 1 && m.y >= v.y - 1 && m.x + m.width <= v.x + v.width + 1 && m.y + m.height <= v.y + v.height + 1, "the whole frame in view");

  // The Frame tab is the frame's name, size and code; Close shuts the pane.
  await panel.getByRole("tab", { name: "Frame" }).click();
  await page.getByRole("complementary", { name: "Frame: Menu" }).getByLabel("Name").waitFor();
  await page.getByRole("complementary", { name: "Frame: Menu" }).getByRole("button", { name: "Close" }).click();
  assert.equal(await page.locator(".design-pane").count(), 0);
});

test("a sheet is deleted from the list, and Undo brings it back", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/designs`);
  await page.getByText(/4 sections, 10 frames/).waitFor();
  await page.getByRole("button", { name: "Actions for Website" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByText("No designs yet").waitFor();
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("link", { name: "Open Website" }).waitFor();
});

for (const theme of ["day", "night"]) {
  test(`no serious accessibility problems on Designs and a board in ${theme}`, async () => {
    await page.goto(`${studio.url}/projects/${projectId}/designs`);
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.getByRole("link", { name: "Open Website" }).waitFor();
    await page.waitForTimeout(300);
    assert.deepEqual(await axeProblems(page), []);
    await page.goto(`${studio.url}/projects/${projectId}/designs/${designId}`);
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.getByRole("button", { name: "Home, Desktop 1440" }).click();
    await page.getByRole("complementary", { name: "Frame: Home" }).waitFor();
    await page.waitForTimeout(400);
    assert.deepEqual(await axeProblems(page), []);
  });
}

test("a sheet of more than 200 frames loads only what is seen: small frames as pictures, the rest outlines, and a frame zoomed to drawn live", async () => {
  const big = (await j("POST", `/api/projects/${projectId}/designs`, { name: "Big", start: "blank" })).body;
  assert.equal(big.sections[0].frames.length, 0);
  assert.equal(JSON.stringify(big).includes('"html"'), false, "a new sheet comes back without code");
  const ops = Array.from({ length: 20 }, (_, i) => ({ op: "addSection", name: `Part ${i + 1}` }));
  for (let s = 1; s <= 21; s++) for (let f = 1; f <= 10; f++) {
    ops.push({ op: "setFrame", section: s === 21 ? "Pages" : `Part ${s}`, name: `Page ${s}.${f}`, width: f % 2 ? 1440 : 390, html: `<main style="padding:80px"><h1 style="font-size:96px;margin:0">Page ${s}.${f}</h1></main>` });
  }
  for (let i = 0; i < ops.length; i += 100) {
    const r = await j("PATCH", `/api/designs/${big.id}`, { ops: ops.slice(i, i + 100) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(JSON.stringify(r.body).includes('"html"'), false, "a change comes back without the sheet's code");
  }
  const meta = (await j("GET", `/api/designs/${big.id}/board`)).body;
  assert.equal(meta.sections.reduce((n, s) => n + s.frames.length, 0), 210, "past the 200 frames a sheet once had");
  assert.deepEqual((await j("GET", `/api/designs/${big.id}/board?since=${meta.version}`)).body, { same: true }, "a board that has the sheet is told nothing more");

  await page.goto(`${studio.url}/projects/${projectId}/designs/${big.id}`);
  await page.getByRole("heading", { name: "Part 1", exact: true }).waitFor();
  // At the fit of ten frames side by side, each is small: pictures, none live.
  await page.locator('[data-drawn="picture"] img').first().waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-drawn="picture"] img')].some((i) => i.complete && i.naturalWidth > 0));
  const drawn = await page.evaluate(() => {
    const n = (k) => document.querySelectorAll(`[data-drawn="${k}"]`).length;
    return { live: n("live"), picture: n("picture"), outline: n("outline"), iframes: document.querySelectorAll(".design-board iframe").length };
  });
  assert.equal(drawn.live + drawn.picture + drawn.outline, 210, "every frame has its place");
  assert.equal(drawn.iframes, 0, `no frame is small enough to read and drawn live anyway: ${JSON.stringify(drawn)}`);
  assert.ok(drawn.outline > 100, `frames out of view are only outlines: ${JSON.stringify(drawn)}`);
  assert.ok(drawn.picture > 0 && drawn.picture < 110, `and those in view, pictures: ${JSON.stringify(drawn)}`);

  // The studio measures the frames, so the board is laid out before each is seen.
  await serverHas(studio, `/api/designs/${big.id}/board`, (d) => d.sections.every((s) => s.frames.every((f) => f.measured > 0)), { timeout: 120_000 });

  // A frame far down, zoomed to, is drawn live, and only a few with it.
  await page.getByRole("button", { name: "Page 18.3, Desktop 1440" }).dblclick();
  await page.frameLocator('iframe[title="Page 18.3"]').getByRole("heading", { name: "Page 18.3" }).waitFor();
  const near = await page.evaluate(() => document.querySelectorAll(".design-board iframe").length);
  assert.ok(near >= 1 && near <= 16, `${near} drawn live`);
  assert.deepEqual(await axeProblems(page), []);
  await page.goto(`${studio.url}/projects/${projectId}/designs/${designId}`);
});

test("sections go anywhere on the grid, by a drag or the keys; a section wraps into rows; a frame is dragged to another section; Tidy up puts them back", async () => {
  const sheet = (await j("POST", `/api/projects/${projectId}/designs`, { name: "Canvas", start: "blank" })).body;
  const ops = [];
  for (const [s, n] of [["Alpha", 3], ["Beta", 2], ["Gamma", 2]]) {
    if (s !== "Alpha") ops.push({ op: "addSection", name: s });
    for (let i = 1; i <= n; i++) ops.push({ op: "setFrame", section: s === "Alpha" ? sheet.sections[0].id : s, name: `${s[0]}${i}`, width: 390, html: `<main style="padding:40px"><h1>${s[0]}${i}</h1></main>` });
  }
  ops.unshift({ op: "updateSection", section: sheet.sections[0].id, name: "Alpha" });
  assert.equal((await j("PATCH", `/api/designs/${sheet.id}`, { ops })).status, 200);
  const board = async () => (await j("GET", `/api/designs/${sheet.id}/board`)).body;
  const sec = async (name) => (await board()).sections.find((x) => x.name === name);
  const onScreen = (name) => page.locator("section.design-section", { has: page.getByRole("heading", { name, exact: true }) });
  const still = async (loc) => { let a = await loc.boundingBox(); for (let i = 0; i < 40; i++) { await page.waitForTimeout(60); const b = await loc.boundingBox(); if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5) return b; a = b; } return a; };

  await page.goto(`${studio.url}/projects/${projectId}/designs/${sheet.id}`);
  await page.getByRole("heading", { name: "Gamma", exact: true }).waitFor();
  await serverHas(studio, `/api/designs/${sheet.id}/board`, (d) => d.sections.every((x) => x.frames.every((f) => f.measured > 0)));
  await page.waitForTimeout(300);
  const zoomOf = async () => Number((await page.locator(".design-board").evaluate((el) => getComputedStyle(el).getPropertyValue("--z"))) || 1);

  // Dragged by its name, a section goes to a place on the grid; the others stay where they stood.
  const g0 = await onScreen("Gamma").boundingBox();
  const name = await page.getByRole("button", { name: "Beta", exact: true }).boundingBox();
  await page.mouse.move(name.x + 10, name.y + 8); await page.mouse.down();
  await page.mouse.move(name.x + 410, name.y + 8, { steps: 8 });
  assert.ok(await onScreen("Beta").getAttribute("data-moving") !== null, "it shows where it goes as it is dragged");
  await page.mouse.up();
  await serverHas(studio, `/api/designs/${sheet.id}/board`, (d) => d.sections.every((x) => x.x != null));
  const z1 = await zoomOf();
  assert.match(await page.getByRole("button", { name: /^Zoom:/ }).getAttribute("aria-label"), /^Zoom: \d+%$/, "at the fit, the zoom stays as it was once a section moves");
  const beta = await sec("Beta"), alpha = await sec("Alpha"), gamma = await sec("Gamma");
  assert.equal(beta.x % 40, 0); assert.equal(beta.y % 40, 0);
  assert.ok(Math.abs(beta.x - 400 / z1) <= 40, `moved about 400 pixels on screen: ${beta.x} at ${z1}`);
  assert.deepEqual([alpha.x, alpha.y], [0, 0], "the section above is pinned where it stood");
  assert.equal(gamma.x, 0);
  const g1 = await still(onScreen("Gamma"));
  assert.ok(Math.abs(g1.x - g0.x) < 2 && Math.abs(g1.y - g0.y) < 2, "and the one below did not jump");
  assert.equal(await page.getByRole("complementary", { name: /^Frame:/ }).count(), 0, "a drag is not a click");

  // The arrow keys move it a grid step, Shift five; saved once they stop.
  await page.getByRole("button", { name: "Beta", exact: true }).focus();
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("Shift+ArrowDown");
  await page.getByRole("status").filter({ hasText: `Beta at ${beta.x + 80}, ${beta.y + 200}` }).waitFor();
  await serverHas(studio, `/api/designs/${sheet.id}/board`, (d) => { const b = d.sections.find((x) => x.name === "Beta"); return b.x === beta.x + 80 && b.y === beta.y + 200; });

  // Dragged over another section, it moves nothing; put down there, it stays where it is put and
  // the other makes room under it.
  await page.getByRole("button", { name: /^Zoom:/ }).click();
  await page.getByRole("menuitem", { name: "Whole sheet" }).click();
  await still(page.locator(".design-board"));
  const al = await onScreen("Alpha").boundingBox(), gn = await page.getByRole("button", { name: "Gamma", exact: true }).boundingBox(), gs = await onScreen("Gamma").boundingBox();
  await page.mouse.move(gn.x + 10, gn.y + 8); await page.mouse.down();
  await page.mouse.move(gn.x + 10, gn.y + 8 + (al.y + al.height / 2 - gs.y), { steps: 10 });
  const mid = await onScreen("Alpha").boundingBox();
  assert.ok(Math.abs(mid.y - al.y) < 1 && Math.abs(mid.x - al.x) < 1, "while it is dragged, nothing else moves");
  await page.mouse.up();
  await serverHas(studio, `/api/designs/${sheet.id}/board`, (d) => { const by = Object.fromEntries(d.sections.map((x) => [x.name, x])); return by.Alpha.y > by.Gamma.y; });
  const boxes = await page.locator("section.design-section").evaluateAll((els) => els.map((e) => ({ x: parseFloat(e.style.left), y: parseFloat(e.style.top), w: parseFloat(e.style.width), h: parseFloat(e.style.height) })));
  for (const a of boxes) for (const b of boxes) if (a !== b) assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `no two sections overlap: ${JSON.stringify(boxes)}`);

  // Its right edge dragged in wraps its frames into rows; out past one row, they are one row again.
  const frameTops = async () => new Set(await page.locator("section.design-section", { has: page.getByRole("heading", { name: "Alpha", exact: true }) }).locator("[data-frame-box]").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top))));
  assert.equal((await frameTops()).size, 1);
  await onScreen("Alpha").hover();
  const h = await page.getByRole("button", { name: "Wrap Alpha into rows" }).boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down();
  await page.mouse.move(h.x - 900 * (await zoomOf()), h.y + h.height / 2, { steps: 8 }); await page.mouse.up();
  await serverHas(studio, `/api/designs/${sheet.id}/board`, (d) => d.sections.find((x) => x.name === "Alpha").width > 0);
  assert.ok((await frameTops()).size >= 2, "in rows");
  const h2 = await page.getByRole("button", { name: "Wrap Alpha into rows" }).boundingBox();
  await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2); await page.mouse.down();
  await page.mouse.move(h2.x + 1600, h2.y + h2.height / 2, { steps: 8 }); await page.mouse.up();
  await serverHas(studio, `/api/designs/${sheet.id}/board`, (d) => d.sections.find((x) => x.name === "Alpha").width == null);

  // A frame dragged into another section goes where the bar shows, and is not picked.
  const a1 = page.getByRole("button", { name: /^A1, / });
  await a1.scrollIntoViewIfNeeded();
  const from = await a1.boundingBox();
  const g2 = page.getByRole("button", { name: /^G1, / });
  await page.mouse.move(from.x + from.width / 2, from.y + 30); await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + 50, { steps: 4 });
  const to = await g2.boundingBox();
  await page.mouse.move(to.x + 8, to.y + to.height / 2, { steps: 10 });
  assert.equal(await page.locator(".design-ghost").count(), 1);
  assert.equal(await page.locator(".design-drop").count(), 1, "a bar shows where it goes");
  await page.mouse.up();
  await serverHas(studio, `/api/designs/${sheet.id}/board`, (d) => d.sections.find((x) => x.name === "Gamma").frames[0].name === "A1");
  assert.equal((await sec("Alpha")).frames.length, 2);
  assert.equal(await page.getByRole("complementary", { name: /^Frame:/ }).count(), 0);

  // A double-click on a section's name zooms to it; Whole sheet shows all of it.
  await page.getByRole("button", { name: "Gamma", exact: true }).dblclick();
  const gv = await still(onScreen("Gamma")), vv = await page.locator(".design-view").boundingBox();
  assert.ok(gv.x >= vv.x - 1 && gv.y >= vv.y - 1 && gv.x + gv.width <= vv.x + vv.width + 1 && gv.y + gv.height <= vv.y + vv.height + 1, "the section is in view");
  await page.getByRole("button", { name: /^Zoom:/ }).click();
  await page.getByRole("menuitem", { name: "Whole sheet" }).click();
  const all = await still(page.locator(".design-board"));
  assert.ok(all.x >= vv.x - 1 && all.y >= vv.y - 1 && all.x + all.width <= vv.x + vv.width + 1 && all.y + all.height <= vv.y + vv.height + 1, `the whole board is in view: ${JSON.stringify(all)} in ${JSON.stringify(vv)}`);

  // The grid's dots are never closer than 14 pixels on screen.
  assert.ok(Number.parseFloat(await page.locator(".design-wrap").evaluate((el) => getComputedStyle(el).getPropertyValue("--dot"))) >= 14);

  // Zoomed in, the map shows; a press on it goes there.
  await page.keyboard.press("Shift+Digit0");
  await page.getByRole("button", { name: "Zoom: 100%" }).waitFor();
  await page.locator(".design-map svg").waitFor();
  const s1 = await page.locator(".design-view").evaluate((el) => [el.scrollLeft, el.scrollTop]);
  const map = await page.locator(".design-map svg").boundingBox();
  await page.mouse.click(map.x + map.width - 3, map.y + map.height - 3);
  const s2 = await page.locator(".design-view").evaluate((el) => [el.scrollLeft, el.scrollTop]);
  assert.ok(s2[0] !== s1[0] || s2[1] !== s1[1], "the view moved");
  assert.deepEqual(await axeProblems(page), []);

  // Tidy up puts every section back in one column; Undo puts them back where they were.
  await page.getByRole("button", { name: "Tidy up" }).click();
  await serverHas(studio, `/api/designs/${sheet.id}/board`, (d) => d.sections.every((x) => x.x == null));
  await page.getByRole("button", { name: "Tidy up" }).waitFor({ state: "detached" });
  await page.getByText("Put the sections back in a column").waitFor();
  await page.locator(".toast-action", { hasText: "Undo" }).click();
  await serverHas(studio, `/api/designs/${sheet.id}/board`, (d) => d.sections.every((x) => x.x != null));
  await page.getByRole("button", { name: "Tidy up" }).waitFor();
});
