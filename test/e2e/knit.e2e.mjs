import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { crc32 } from "node:zlib";
import { axeProblems, launchBrowser, serverHas, startStudio } from "./harness.mjs";

let studio, browser, page, projectId, patternId;
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
const editor = () => `${studio.url}/projects/${projectId}/patterns/${patternId}`;
async function openKnit() {
  await page.goto(editor());
  await page.getByRole("application", { name: "Pattern canvas" }).waitFor();
  await page.getByRole("button", { name: "Knit", exact: true }).click();
  await page.getByRole("dialog").getByText("Make real files from").waitFor();
}

before(async () => {
  studio = await startStudio();
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  projectId = (await j("POST", "/api/projects", { name: "Knit e2e", starter: "social" })).body.id;
  patternId = (await j("GET", `/api/projects/${projectId}/patterns`)).body[0].id;
  // Warm the dev server: the first call to the knit route compiles the whole engine, which can
  // take longer than a UI assertion is willing to wait. Real users never hit this (production build).
  await j("POST", `/api/patterns/${patternId}/knit`, { params: {}, dryRun: true });
});
after(async () => { await browser?.close(); await studio?.stop(); });

test("Knit opens a dialog that checks the pattern first, and tells the truth about what is missing", async () => {
  await openKnit();
  // A fresh starter has no logo yet. That is a heads-up, not a blocker: you can still knit.
  await page.getByRole("dialog").getByText(/Heads up: The logo slot has no image yet/).waitFor();
  await page.getByRole("button", { name: "Knit 1 file" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Knit 1 file" }).isDisabled(), false);
});

test("pressing Knit makes a real PNG, shows real progress, and the result is in the gallery", async () => {
  await page.getByRole("button", { name: "Knit 1 file" }).click();
  await page.getByRole("dialog").getByText(/1 file ready/).waitFor({ timeout: 60000 });
  await page.getByRole("link", { name: "See your knits" }).click();
  await page.waitForURL(/\/knits$/);
  const card = page.getByRole("button", { name: /^Open Launch story/ });
  await card.waitFor();
  const list = (await j("GET", `/api/projects/${projectId}/knits`)).body;
  assert.equal(list.length, 1);
  const png = await fetch(`${studio.url}/api/knits/${list[0].id}/file`);
  const bytes = Buffer.from(await png.arrayBuffer());
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  assert.equal(bytes.readUInt32BE(16), 1080); assert.equal(bytes.readUInt32BE(20), 1920); // IHDR width and height
});

test("the knit file answers range requests, so video and big images can stream", async () => {
  const k = (await j("GET", `/api/projects/${projectId}/knits`)).body[0];
  const res = await fetch(`${studio.url}/api/knits/${k.id}/file`, { headers: { range: "bytes=0-9" } });
  assert.equal(res.status, 206);
  assert.equal((await res.arrayBuffer()).byteLength, 10);
});

test("Knit many: a pasted table of three rows makes three files in one batch", async () => {
  await openKnit();
  await page.getByRole("switch", { name: "Knit many from a table" }).click();
  await page.getByRole("textbox", { name: "Table" }).fill("headline\nSpring sale\nNew arrivals\nLast chance");
  await page.getByText("3 rows").waitFor();
  await page.getByRole("button", { name: "Knit 3 files" }).click();
  await page.getByRole("dialog").getByText(/3 files ready/).waitFor({ timeout: 90000 });
  await page.keyboard.press("Escape");
  await page.goto(`${studio.url}/projects/${projectId}/knits`);
  await page.getByText("Batch of 3").waitFor();
  const all = (await j("GET", `/api/projects/${projectId}/knits`)).body;
  assert.equal(all.length, 4);
});

test("a knit nobody has opened says New until it is opened, and Mark all seen does the rest", async () => {
  const unseen = (k) => k.filter((x) => !x.seenAt).length;
  await page.getByRole("link", { name: /^Knits.*4 new/ }).waitFor();
  await page.getByRole("button", { name: /, new$/ }).first().click();
  await page.getByRole("dialog").getByRole("link", { name: "Download" }).waitFor();
  await serverHas(studio, `/api/projects/${projectId}/knits`, (k) => unseen(k) === 3);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: /^Knits.*3 new/ }).waitFor();
  await page.getByRole("button", { name: "Mark all seen" }).click();
  await serverHas(studio, `/api/projects/${projectId}/knits`, (k) => unseen(k) === 0);
  await page.getByRole("button", { name: "Mark all seen" }).waitFor({ state: "detached" });
  assert.equal(await page.getByRole("button", { name: /, new$/ }).count(), 0);
});

test("the batch downloads as a valid zip: every entry's CRC matches its bytes", async () => {
  const all = (await j("GET", `/api/projects/${projectId}/knits`)).body;
  const batch = all.find((k) => k.batchId).batchId;
  const res = await fetch(`${studio.url}/api/projects/${projectId}/knits/zip?batch=${batch}`);
  assert.equal(res.headers.get("content-type"), "application/zip");
  const zip = Buffer.from(await res.arrayBuffer());
  // End of central directory.
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0, "has an end-of-central-directory record");
  const count = zip.readUInt16LE(eocd + 10);
  assert.equal(count, 3);
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(p), 0x02014b50);
    const crc = zip.readUInt32LE(p + 16), size = zip.readUInt32LE(p + 24), nameLen = zip.readUInt16LE(p + 28), extra = zip.readUInt16LE(p + 30), cmt = zip.readUInt16LE(p + 32), off = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString();
    const localName = zip.readUInt16LE(off + 26), localExtra = zip.readUInt16LE(off + 28);
    const data = zip.subarray(off + 30 + localName + localExtra, off + 30 + localName + localExtra + size);
    assert.equal(crc32(data), crc, `${name}: the stored CRC matches the bytes`);
    assert.equal(data.subarray(1, 4).toString(), "PNG", `${name} is a PNG`);
    p += 46 + nameLen + extra + cmt;
  }
});

test("a modifier click picks knits without opening them, and the picked ones are tagged and downloaded together", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/knits`);
  const open = page.getByRole("button", { name: /^Open / });
  await open.nth(0).click({ modifiers: ["ControlOrMeta"] });
  await open.nth(1).click({ modifiers: ["ControlOrMeta"] });
  const bar = page.getByRole("toolbar", { name: "Selection" });
  await bar.getByText("2 selected").waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0, "picking opens nothing");

  await bar.getByRole("button", { name: "Add tag" }).click();
  await page.getByRole("dialog").getByLabel("Tag").fill("launch");
  await page.getByRole("dialog").getByRole("button", { name: "Add tag" }).click();
  await serverHas(studio, `/api/projects/${projectId}/knits`, (k) => k.filter((x) => (x.tags ?? []).includes("launch")).length === 2);

  const href = await bar.getByRole("link", { name: "Download" }).getAttribute("href");
  const zip = Buffer.from(await (await fetch(studio.url + href)).arrayBuffer());
  assert.equal(zip.readUInt16LE(zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) + 10), 2, "the zip has the two picked");

  await page.keyboard.press("Escape");
  await bar.waitFor({ state: "detached" });
});

test("the gallery opens a knit, offers download and delete, and delete removes the file", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/knits`);
  await page.getByRole("button", { name: /^Open Launch story/ }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("link", { name: "Download" }).waitFor();
  await dlg.getByRole("button", { name: "More for this knit" }).click();
  await page.getByRole("menuitem", { name: "Delete this knit" }).click();
  await page.getByRole("dialog", { name: /^Delete Launch story/ }).getByRole("button", { name: "Delete the file" }).click();
  await serverHas(studio, `/api/projects/${projectId}/knits`, (k) => k.length === 3);
  await page.getByRole("dialog").waitFor({ state: "detached" });
});

test("a knit made before its pattern was last changed says so, so an out-of-date file is not posted by mistake", async () => {
  await j("POST", `/api/patterns/${patternId}/commands`, { command: { type: "addStitch", stitch: { id: "late", kind: "shape", x: 0.9, y: 0.9, w: 0.05, h: 0.05, locked: false, style: { background: "#ff0000" } } } });
  await page.goto(`${studio.url}/projects/${projectId}/knits`);
  await page.getByRole("button", { name: /^Open Launch story.*its pattern changed since/ }).first().waitFor();
  await page.getByText("pattern changed since").first().waitFor();
});

test("a pattern with missing Yarn cannot be knitted, and the dialog says what to fix", async () => {
  const p = (await j("POST", `/api/projects/${projectId}/patterns`, { name: "Needs a photo" })).body;
  await j("POST", `/api/patterns/${p.id}/commands`, { command: { type: "addStitch", stitch: { id: "im", kind: "image", slot: "photo", x: 0, y: 0, w: 1, h: 1, locked: false, yarnId: "yn_gone" } } });
  await page.goto(`${studio.url}/projects/${projectId}/patterns/${p.id}`);
  await page.getByRole("application", { name: "Pattern canvas" }).waitFor();
  await page.getByRole("button", { name: "Knit", exact: true }).click();
  await page.getByRole("dialog").getByText(/Fix this first/).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Knit \d+ file/ }).isDisabled(), true);
});

test("a star marks a favourite, and Knits shows only the favourites, or only one size", async () => {
  const knits = () => j("GET", `/api/projects/${projectId}/knits`).then((r) => r.body);
  const had = (await knits()).length;
  const post = (await j("GET", `/api/projects/${projectId}/patterns`)).body.find((p) => p.size.name === "Post");
  await j("POST", `/api/patterns/${post.id}/knit`, { params: {} });
  await serverHas(studio, `/api/projects/${projectId}/knits`, (k) => k.length === had + 1, { timeout: 90000 });
  await page.goto(`${studio.url}/projects/${projectId}/knits`);
  const cards = page.getByRole("button", { name: /^Open / });
  await cards.first().waitFor();

  // By size: a Post is 4:5, whatever its pixels.
  await page.getByRole("combobox", { name: "Size" }).click();
  await page.getByRole("option", { name: /^Story 9:16 \(Stories, Reels/ }).waitFor();
  await page.getByRole("option", { name: "Post 4:5" }).click();
  await page.getByRole("button", { name: /^Open Launch post/ }).waitFor();
  assert.equal(await cards.count(), 1);
  await page.getByRole("combobox", { name: "Size" }).click();
  await page.getByRole("option", { name: "Every size" }).click();
  await page.waitForFunction((n) => document.querySelectorAll('button[aria-label^="Open "]').length === n, had + 1);

  // The star: a favourite, found with Only favourites, and taken off again in the knit's own view.
  const star = page.getByRole("button", { name: /^Favourite Launch post/ });
  await star.click();
  await serverHas(studio, `/api/projects/${projectId}/knits`, (k) => k.filter((x) => x.favorite).length === 1 && k.find((x) => x.favorite).patternId === post.id);
  assert.equal(await star.getAttribute("aria-pressed"), "true");
  await page.getByRole("checkbox", { name: "Only favourites (1)" }).check();
  assert.equal(await cards.count(), 1);
  await cards.first().click();
  const fav = page.getByRole("dialog").getByRole("button", { name: "Favourite" });
  assert.equal(await fav.getAttribute("aria-pressed"), "true");
  await fav.click();
  await serverHas(studio, `/api/projects/${projectId}/knits`, (k) => k.every((x) => !x.favorite));
  await page.keyboard.press("Escape");
  await page.getByText("No favourites yet").waitFor();
});

test("a pattern knitted again after a change is one knit with two versions; Formats knits a 2x of it, and Versions brings the old one back", async () => {
  const every = () => j("GET", `/api/projects/${projectId}/knits?every=1`).then((r) => r.body);
  const shown = () => j("GET", `/api/projects/${projectId}/knits`).then((r) => r.body);
  const post = (await j("GET", `/api/projects/${projectId}/patterns`)).body.find((p) => p.size.name === "Post");
  const had = (await shown()).length, files = (await every()).length;
  await j("POST", `/api/patterns/${post.id}/commands`, { command: { type: "addStitch", stitch: { id: "v2dot", kind: "shape", x: 0.05, y: 0.05, w: 0.1, h: 0.1, locked: false, style: { background: "#00aa55" } } } });
  await j("POST", `/api/patterns/${post.id}/knit`, { params: {} });
  await serverHas(studio, `/api/projects/${projectId}/knits?every=1`, (k) => k.length === files + 1, { timeout: 90000 });
  assert.equal((await shown()).length, had, "still one knit, at its new version");

  await page.goto(`${studio.url}/projects/${projectId}/knits`);
  await page.getByRole("button", { name: /^Open Launch post.*, a new version, 2 versions/ }).click();
  const dlg = page.getByRole("dialog");

  // Another format of the version shown: the same picture at twice the size.
  await dlg.getByRole("tab", { name: "Formats" }).click();
  await dlg.getByRole("radiogroup", { name: "Type" }).getByRole("radio", { name: "PNG" }).click();
  await dlg.getByRole("radio", { name: "2x" }).click();
  await dlg.getByText("2160 × 2700, sharp on big screens.").waitFor();
  await dlg.getByRole("button", { name: "Knit it" }).click();
  const v2files = dlg.getByRole("list", { name: "The files of version 2" });
  await v2files.getByText("PNG 2x").waitFor({ timeout: 90000 });
  assert.equal((await shown()).length, had, "a format is not another knit");
  assert.deepEqual((await shown()).find((k) => k.patternId === post.id).formats.map((f) => f.scale), [1, 2]);
  await dlg.getByRole("button", { name: "Use this one" }).click();
  await serverHas(studio, `/api/projects/${projectId}/knits`, (k) => k.find((x) => x.patternId === post.id)?.width === 2160);

  // The version before, looked at, then picked again.
  await dlg.getByRole("tab", { name: /^Versions/ }).click();
  const list = dlg.getByRole("list", { name: "Versions, newest first" });
  assert.equal(await list.getByRole("listitem").count(), 2);
  await list.getByRole("button", { name: /^Version 1/ }).click();
  await dlg.getByText(/^Version 1 of 2, knitted .* Knits shows version 2\.$/).waitFor();
  assert.deepEqual(await axeProblems(page), []);
  await dlg.getByRole("status").getByRole("button", { name: "Use this one" }).click();
  await serverHas(studio, `/api/projects/${projectId}/knits`, (k) => k.find((x) => x.patternId === post.id)?.versionNo === 1);

  // Version 2 and both its files go; version 1 stays, and is the knit.
  await dlg.getByRole("button", { name: "Delete the other versions" }).click();
  await page.getByRole("dialog", { name: "Delete the other version?" }).getByRole("button", { name: "Delete them" }).click();
  await serverHas(studio, `/api/projects/${projectId}/knits?every=1`, (k) => k.length === files);
  await dlg.getByText("Ask your model for a change, or change the pattern and knit it again", { exact: false }).waitFor();
  assert.equal((await shown()).length, had);
  await page.keyboard.press("Escape");
});

for (const theme of ["day", "night"]) {
  test(`no serious accessibility violations in the Knit dialog and the gallery in ${theme}`, async () => {
    await openKnit();
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(400);
    assert.deepEqual(await axeProblems(page), []);
    await page.keyboard.press("Escape");
    await page.goto(`${studio.url}/projects/${projectId}/knits`);
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.getByRole("heading", { name: "Knits" }).waitFor();
    await page.waitForTimeout(400);
    assert.deepEqual(await axeProblems(page), []);
  });
}
