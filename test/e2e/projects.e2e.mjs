import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { axeProblems, launchBrowser, startStudio } from "./harness.mjs";

let studio, browser, page;
const asModel = (patternId, slot, content) => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("./fixtures/model-edit.mjs", import.meta.url)), patternId, slot, content], {
    env: { ...process.env, KNITTED_HOME: studio.home }, encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};

before(async () => {
  studio = await startStudio();
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
});
after(async () => { await browser?.close(); await studio?.stop(); });

test("the library opens with the example project already in it", async () => {
  await page.goto(studio.url + "/projects");
  await page.getByText("Example: launch week").waitFor();
});

test("creating a project in the UI lands on its overview with the five starter patterns", async () => {
  await page.goto(studio.url + "/projects?new=1");
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Spring sale");
  await page.getByRole("button", { name: "Make the project" }).click();
  await page.waitForURL(/\/projects\/pj_/);
  await page.getByRole("heading", { name: "Spring sale" }).waitFor();
  for (const n of ["Launch story", "Launch post", "Launch square", "Launch landscape", "Launch banner"]) {
    await page.getByRole("link", { name: `Open ${n}` }).waitFor();
  }
});

test("an empty name is refused in the product's voice", async () => {
  await page.goto(studio.url + "/projects?new=1");
  await page.getByRole("button", { name: "Make the project" }).click();
  await page.getByText("Give it a name.").waitFor();
});

test("rename, duplicate, archive and restore work from the card menu", async () => {
  await page.goto(studio.url + "/projects");
  await page.getByRole("button", { name: "Actions for Spring sale" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Autumn sale");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByText("Autumn sale").first().waitFor();

  await page.getByRole("button", { name: "Actions for Autumn sale" }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await page.getByRole("link", { name: "Open Autumn sale copy" }).waitFor();

  await page.getByRole("button", { name: "Actions for Autumn sale copy" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await page.getByRole("link", { name: "Open Autumn sale copy" }).waitFor({ state: "detached" });
  await page.getByRole("radio", { name: "Archived" }).click();
  await page.getByText("Autumn sale copy").waitFor();
});

test("delete shows an Undo that really restores the project", async () => {
  await page.goto(studio.url + "/projects");
  await page.getByRole("button", { name: "Actions for Autumn sale" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Delete / }).click();
  await page.getByRole("button", { name: "Autumn sale" }).waitFor({ state: "detached" }).catch(() => {});
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("link", { name: "Open Autumn sale" }).waitFor();
});

test("a project's picture: uploaded from its card menu, shown on the card, and taken away again", async () => {
  const sharp = (await import("sharp")).default;
  const photo = join(mkdtempSync(join(tmpdir(), "knitted-pic-")), "storefront.png");
  writeFileSync(photo, await sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 223, g: 90, b: 15 } } }).png().toBuffer());
  await page.goto(studio.url + "/projects");
  await page.getByRole("button", { name: "Actions for Example: launch week" }).click();
  await page.getByRole("menuitem", { name: "Choose its picture" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Choose an image").setInputFiles(photo);
  await dialog.getByRole("option", { name: /storefront/, selected: true }).waitFor();
  assert.deepEqual(await axeProblems(page), []);
  await dialog.getByRole("button", { name: "Use picture" }).click();
  await page.getByText("Picture set.").waitFor();

  // The card shows the larger rendition, and it really loads.
  const cover = page.locator('img[src*="size=large"]');
  await cover.waitFor();
  await page.waitForFunction(() => { const i = document.querySelector('img[src*="size=large"]'); return i?.complete && i.naturalWidth > 0; });
  assert.ok(await cover.evaluate((i) => i.naturalWidth <= 960 && i.naturalWidth > 256), "larger than a thumbnail, no larger than it needs to be");
  assert.ok((await j("GET", "/api/projects")).body.find((p) => p.name === "Example: launch week").cover);

  await page.getByRole("button", { name: "Actions for Example: launch week" }).click();
  await page.getByRole("menuitem", { name: "Choose its picture" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Take picture away" }).click();
  await page.getByText("Picture taken away.").waitFor();
  await cover.waitFor({ state: "detached" });
});

test("search filters the list", async () => {
  await page.goto(studio.url + "/projects");
  await page.getByLabel("Search projects").fill("zzzz");
  await page.getByText("No projects match").waitFor();
  await page.getByLabel("Search projects").fill("Example");
  await page.getByRole("link", { name: "Open Example: launch week" }).waitFor();
});

test("a model editing in ANOTHER PROCESS shows up live, including what it was refused", async () => {
  const list = (await j("GET", "/api/projects")).body;
  const ex = list.find((p) => p.example);
  const [story] = (await j("GET", `/api/projects/${ex.id}/patterns`)).body;
  await page.goto(studio.url + `/projects/${ex.id}`);
  await page.getByText("Activity").waitFor();

  const r = asModel(story.id, "logo", "hijack");
  assert.equal(r.changed, false);
  assert.equal(r.refusals.length, 1);
  // No reload: the SSE stream tells the page the library changed.
  await page.getByText(/tried to change locked stitches/).waitFor({ timeout: 8000 });

  const fresh = (await j("GET", `/api/patterns/${story.id}`)).body;
  assert.equal(fresh.version, story.version, "a refused edit does not bump the version");
});

test("the HTTP API refuses to let a caller claim to be a model", async () => {
  const [ex] = (await j("GET", "/api/projects")).body.filter((p) => p.example);
  const [story] = (await j("GET", `/api/projects/${ex.id}/patterns`)).body;
  const r = await j("POST", `/api/patterns/${story.id}/commands`, { command: { type: "fillSlot", slot: "headline", content: "x" }, actor: "model" });
  assert.equal(r.status, 400);
});

test("a stale write is a 409 and changes nothing", async () => {
  const [ex] = (await j("GET", "/api/projects")).body.filter((p) => p.example);
  const [story] = (await j("GET", `/api/projects/${ex.id}/patterns`)).body;
  const ok = await j("POST", `/api/patterns/${story.id}/commands`, { command: { type: "fillSlot", slot: "headline", content: "First" }, expectVersion: story.version });
  assert.equal(ok.status, 200);
  const stale = await j("POST", `/api/patterns/${story.id}/commands`, { command: { type: "fillSlot", slot: "headline", content: "Second" }, expectVersion: story.version });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.kind, "conflict");
  const now = (await j("GET", `/api/patterns/${story.id}`)).body;
  assert.equal(now.stitches.find((s) => s.slot === "headline").content, "First");
});

test("malformed input gets a one-line fix, not a stack trace", async () => {
  const r = await j("POST", "/api/projects", { name: 5 });
  assert.equal(r.status, 400);
  assert.ok(r.body.error.message.length < 160);
  assert.ok(!/at .*\.(js|ts)/.test(r.body.error.message));
  const missing = await j("GET", "/api/patterns/pt_nope");
  assert.equal(missing.status, 404);
});

test("the editor opens the real pattern from the library, and an unknown id is a 404", async () => {
  const [ex] = (await j("GET", "/api/projects")).body.filter((p) => p.example);
  const [story] = (await j("GET", `/api/projects/${ex.id}/patterns`)).body;
  await page.goto(studio.url + `/projects/${ex.id}/patterns/${story.id}`);
  await page.getByText("Launch story").first().waitFor();
  const res = await page.goto(studio.url + `/projects/${ex.id}/patterns/pt_nope`);
  assert.equal(res.status(), 404);
});

for (const path of ["/projects", "/"]) {
  test(`no serious accessibility violations on ${path} with real data`, async () => {
    await page.goto(studio.url + path);
    await page.waitForTimeout(600);
    assert.deepEqual(await axeProblems(page), []);
  });
}

test("no serious accessibility violations on a project overview", async () => {
  const [ex] = (await j("GET", "/api/projects")).body.filter((p) => p.example);
  await page.goto(studio.url + `/projects/${ex.id}`);
  await page.getByRole("link", { name: "Open Launch story" }).waitFor();
  assert.deepEqual(await axeProblems(page), []);
});
