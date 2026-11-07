// The Brief, in the studio: a new project set up from its website, the sync's steps as they
// go, the profile when it is written, PDFs in the reference read a page at a time and cut
// from into Yarn, and the trail and the tabs that say where the person is.
//
// Nothing here reaches the internet or the person's Keychain: the sync and its job are
// answered in the browser (the server's own sync is tested in packages/agent), and the key
// is a fake one in the environment, which is read before any keychain.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { axeProblems, launchBrowser, startStudio } from "./harness.mjs";
import { makePdf } from "../../packages/core/test/fixtures/pdf.mjs";

let studio, browser, page;
const files = mkdtempSync(join(tmpdir(), "knitted-brief-e2e-"));
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};

// A sync job as the server reports it, step by step.
const steps = (o) => ({ read: { status: "waiting" }, swatch: { status: "waiting" }, profile: { status: "waiting" }, pictures: { status: "waiting" }, ...o });
const job = (projectId, status, progress, extra = {}) => ({ id: "jb_fake", kind: "sync", status, projectId, error: null, createdAt: new Date().toISOString(), finishedAt: null, result: null, progress: { current: "read", pages: [], shots: { done: 0, total: 0 }, live: "", chars: 0, ...progress }, ...extra });

before(async () => {
  studio = await startStudio({ env: { ANTHROPIC_API_KEY: "sk-test-not-real", KNITTED_ANTHROPIC_URL: "http://127.0.0.1:9" } });
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  writeFileSync(join(files, "Menu.pdf"), makePdf(["Our menu", "Cakes to order"]));
});
after(async () => { await browser?.close(); await studio?.stop(); });

test("a new project made with a website syncs it, and the Brief shows each step as it goes", async () => {
  let asked, phase = 0, projectId;
  await page.route("**/api/projects/*/brief/sync", async (route) => {
    asked = JSON.parse(route.request().postData());
    projectId = route.request().url().split("/projects/")[1].split("/")[0];
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify(job(projectId, "running", { steps: steps({ read: { status: "running" } }) })) });
  });
  await page.route("**/api/jobs/jb_fake", async (route) => {
    const at = [
      job(projectId, "running", { current: "read", steps: steps({ read: { status: "running" } }), pages: [{ url: "https://hollowoak.example/", title: "Home" }, { url: "https://hollowoak.example/menu", title: "Menu" }] }),
      job(projectId, "running", { current: "profile", steps: steps({ read: { status: "done", note: "2 pages read." }, swatch: { status: "done", note: "The project uses Hollow Oak now." }, profile: { status: "running" } }), live: "# Name\nHollow Oak Bakery", chars: 24 }),
      job(projectId, "done", { current: "done", steps: steps({ read: { status: "done", note: "2 pages read." }, swatch: { status: "done", note: "The project uses Hollow Oak now." }, profile: { status: "done", note: "Written." }, pictures: { status: "failed", note: "Pictures need knitted's browser." } }) }, { result: { brief: null, swatchId: null, pictures: 0, skipped: 0, notes: [] } }),
    ][Math.min(phase, 2)];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(at) });
  });

  await page.goto(`${studio.url}/projects?new=1`);
  await page.getByLabel("Name").fill("Hollow Oak");
  await page.getByLabel("The business's website (optional)").fill("https://hollowoak.example");
  // With a website, the sync's choices show: the swatch read and used, the profile, the pictures.
  await page.getByRole("switch", { name: "Read a swatch from it" }).waitFor();
  assert.equal(await page.getByRole("switch", { name: "Use it for this project" }).getAttribute("aria-checked"), "true");
  await page.getByRole("button", { name: "Create and sync" }).click();

  await page.waitForURL(/\/brief\?sync=jb_fake/);
  assert.deepEqual([asked.url, asked.swatch, asked.activateSwatch, asked.profile, asked.pictures, asked.mode], ["https://hollowoak.example", true, true, true, true, "replace"]);
  await page.getByText("Syncing with the website").waitFor();
  await page.getByText(/2 pages so far: Menu/).waitFor();

  phase = 1;
  await page.getByText("24 characters written").waitFor();
  await page.getByText("The project uses Hollow Oak now.").waitFor();

  // The profile is written: the server has it when the job says done.
  await j("PUT", `/api/projects/${projectId}/brief`, { profile: "# Name\nHollow Oak Bakery\n\n# What they offer\n- Sourdough, baked daily\n- **Cakes** to order" });
  phase = 2;
  await page.getByRole("heading", { name: "Synced" }).waitFor();
  await page.getByText("Pictures need knitted's browser.").waitFor();
  await page.getByRole("listitem").filter({ hasText: "Sourdough, baked daily" }).waitFor();
  assert.equal(await page.locator(".brief-profile strong").first().textContent(), "Cakes", "the profile is drawn as markdown");

  // Where the person is, said once: Projects > Hollow Oak > Brief, with the tab's line under the tabs.
  const trail = page.getByRole("navigation", { name: "Breadcrumbs" });
  assert.deepEqual(await trail.locator("li").allInnerTexts(), ["Projects", "Hollow Oak", "Brief"]);
  await page.getByText(/What your model knows about the business: a profile from its website/).first().waitFor();
  await page.getByRole("button", { name: "Done" }).click();
  await page.unroute("**/api/projects/*/brief/sync");
  await page.unroute("**/api/jobs/jb_fake");
  assert.deepEqual(await axeProblems(page), []);
});

test("a PDF in the reference is read a page at a time, and a part of it cut out into Yarn", async () => {
  const projectId = (await j("POST", "/api/projects", { name: "Reference", starter: "blank" })).body.id;
  await page.goto(`${studio.url}/projects/${projectId}/brief`);
  await page.getByText("Add reference").waitFor();
  await page.getByLabel("Choose files to upload").setInputFiles(join(files, "Menu.pdf"));
  await page.getByRole("button", { name: /^Menu PDF · 612x792 · 2 pages/ }).click();

  const drawer = page.getByRole("dialog", { name: "Menu" });
  await drawer.getByText("PDF, in the reference").waitFor();
  await drawer.getByText("Page 1 of 2").waitFor();
  await drawer.getByRole("button", { name: "Next page" }).click();
  await drawer.getByText("Page 2 of 2").waitFor();
  await drawer.getByRole("button", { name: "Read its words" }).click();
  await drawer.getByText("Cakes to order").waitFor();

  await drawer.getByRole("button", { name: "Cut out a part" }).click();
  const crop = page.getByRole("dialog", { name: "Cut out a part of Menu" });
  await crop.locator("img").first().waitFor();
  await crop.getByLabel("From the left").fill("10");
  await crop.getByLabel("From the top").fill("25");
  await crop.getByLabel("Width").fill("50");
  await crop.getByLabel("Height").fill("25");
  await crop.getByRole("button", { name: "Cut it out" }).click();
  await page.getByText(/Cut out Menu, page 1, in Yarn/).waitFor();

  const yarn = (await j("GET", `/api/projects/${projectId}/yarn`)).body;
  assert.deepEqual(yarn.map((y) => [y.name, y.kind, y.shelf]), [["Menu, page 1", "image", "yarn"]], "the cut is in Yarn, ready for a pattern; the PDF stays in the reference");
  assert.equal((await j("GET", `/api/projects/${projectId}/yarn?shelf=reference`)).body.length, 1);
});

test("each section can be a grid or a list, sorted, and remembers which", async () => {
  const projectId = (await j("POST", "/api/projects", { name: "Views", starter: "social" })).body.id;
  await page.goto(`${studio.url}/projects/${projectId}`);
  await page.getByRole("radio", { name: "List" }).click();
  await page.getByText(/Story · 1080x1920/).waitFor();
  await page.reload();
  assert.equal(await page.getByRole("radio", { name: "List" }).getAttribute("aria-checked"), "true", "kept on this computer");
  await page.getByLabel("Search patterns").fill("ban");
  await page.getByRole("link", { name: "Open Launch banner" }).waitFor();
  assert.equal(await page.getByRole("link", { name: /^Open / }).count(), 1);

  // Every tab says what it is for.
  await page.getByRole("link", { name: "Yarn", exact: true }).hover();
  await page.getByRole("tooltip").filter({ hasText: /Your files to put in patterns/ }).waitFor();
});

test("knits under way are one panel: the one knitting with a bar that moves, the rest waiting under it", async () => {
  const projectId = (await j("POST", "/api/projects", { name: "Queue", starter: "social" })).body.id;
  const at = new Date().toISOString();
  const knitJob = (id, status, progress, name) => ({ id, kind: "knit", status, projectId, error: null, createdAt: at, finishedAt: null, result: null, input: { patternName: name }, progress });
  const active = (url) => url.pathname === "/api/jobs" && url.searchParams.get("project") === projectId;
  await page.route(active, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
    knitJob("jb_1", "running", { total: 2, done: 1, current: "Launch banner · Story", units: [], step: "Drawing the frames", frames: { done: 75, total: 150 } }, "Launch banner"),
    knitJob("jb_2", "queued", null, "VO reel"),
    knitJob("jb_3", "queued", null, "Weekend post"),
  ]) }));
  await page.goto(`${studio.url}/projects/${projectId}/knits`);
  const panel = page.getByRole("region", { name: "Knitting" });
  await panel.getByText("2 waiting").waitFor();
  assert.equal(await page.getByRole("region", { name: "Knitting" }).count(), 1, "one panel, not a row each");
  // One file done of two, and half the frames of the second: (1 + 0.5 x 0.9) / 2.
  assert.equal(await panel.getByRole("progressbar").getAttribute("aria-valuenow"), "73");
  await panel.getByText("File 2 of 2 · Drawing the frames · frame 75 of 150").waitFor();
  assert.deepEqual(await panel.getByRole("list", { name: "Waiting to knit" }).getByRole("listitem").allInnerTexts().then((t) => t.map((x) => x.split("\n")[1])), ["VO reel", "Weekend post"]);
  assert.equal(await panel.getByRole("button", { name: /^Cancel knitting/ }).count(), 3);
  await panel.getByRole("button", { name: "Cancel all" }).waitFor();
  assert.deepEqual(await axeProblems(page), []);
  await page.unroute(active);
});

test("knits under way show on every tab of their project, and on the projects page for all of them at once", async () => {
  const a = (await j("POST", "/api/projects", { name: "Knitting here", starter: "social" })).body.id;
  const b = (await j("POST", "/api/projects", { name: "Knitting there", starter: "blank" })).body.id;
  const at = new Date().toISOString();
  const knitJob = (id, projectId, status, progress, name) => ({ id, kind: "knit", status, projectId, error: null, createdAt: at, finishedAt: null, result: null, input: { patternName: name }, progress });
  const all = [
    knitJob("jb_a1", a, "running", { total: 2, done: 1, current: "Launch banner · Story", units: [], step: "Drawing the frames", frames: { done: 75, total: 150 } }, "Launch banner"),
    knitJob("jb_a2", a, "queued", null, "VO reel"),
    knitJob("jb_b1", b, "running", { total: 1, done: 0, current: "Sale post", units: [], frames: null }, "Sale post"),
  ];
  const active = (url) => url.pathname === "/api/jobs";
  await page.route(active, (route) => {
    const project = new URL(route.request().url()).searchParams.get("project");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(all.filter((x) => !project || x.projectId === project)) });
  });

  await page.goto(`${studio.url}/projects/${a}`);
  const panel = page.getByRole("region", { name: "Knitting" });
  await panel.getByText("1 waiting").waitFor();
  assert.equal(await panel.getByRole("progressbar").getAttribute("aria-valuenow"), "73");
  assert.equal(await panel.getByText("Sale post").count(), 0, "only this project's");
  assert.equal(await panel.getByRole("list", { name: "Waiting to knit" }).count(), 0, "the waiting ones are a count here");
  await page.getByRole("link", { name: "Yarn", exact: true }).click();
  await page.waitForURL(`**/projects/${a}/yarn`);
  await panel.getByRole("link", { name: "See knits" }).click();
  await page.waitForURL(`**/projects/${a}/knits`);
  await page.getByRole("list", { name: "Waiting to knit" }).waitFor();
  assert.equal(await page.getByRole("region", { name: "Knitting" }).count(), 1, "the Knits tab keeps its own panel, with the waiting ones listed, not a second one");

  await page.goto(studio.url);
  const every = page.getByRole("region", { name: "Knitting" });
  await every.getByRole("link", { name: "Knitting there" }).waitFor();
  await every.getByRole("link", { name: "Knitting here" }).first().waitFor();
  assert.equal(await every.getByRole("progressbar").count(), 2, "a bar for each knit under way, in any project");
  await page.getByRole("link", { name: "Knitting, 73%, 1 waiting" }).waitFor();
  await page.getByRole("link", { name: "Knitting, 0%" }).waitFor();
  assert.deepEqual(await axeProblems(page), []);
  await page.unroute(active);
});
