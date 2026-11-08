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
  await frame("Menu").getByRole("heading", { name: "Our menu" }).waitFor();
  await page.getByText("by your model").first().waitFor();
  // The frame it made is outlined on the board, with who and what, and what it is doing shows here too.
  const menu = page.locator("[data-frame-box]").filter({ has: page.locator('iframe[title="Menu"]') });
  await menu.getByTestId("model-on").waitFor();
  assert.match(await menu.getByTestId("model-on").innerText(), /A model\s*Adding .Menu./);
  await page.getByRole("region", { name: "What A model is doing" }).waitFor();
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
  await page.waitForTimeout(300);
  const v = await view.boundingBox(), m = await box("Menu");
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
