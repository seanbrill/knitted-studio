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
