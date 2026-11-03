import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { crc32 } from "node:zlib";
import { axeProblems, launchBrowser, startStudio } from "./harness.mjs";

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

test("the gallery opens a knit, offers download and delete, and delete removes the file", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/knits`);
  await page.getByRole("button", { name: /^Open Launch story/ }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("link", { name: "Download" }).waitFor();
  await dlg.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete file" }).click();
  await page.waitForFunction(async ({ id }) => (await (await fetch(`/api/projects/${id}/knits`)).json()).length === 3, { id: projectId });
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
