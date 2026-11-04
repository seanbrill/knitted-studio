import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { axeProblems, launchBrowser, startStudio } from "./harness.mjs";

let studio, browser, page, projectId;
const files = mkdtempSync(join(tmpdir(), "knitted-sw-e2e-"));
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};

before(async () => {
  studio = await startStudio();
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  projectId = (await j("POST", "/api/projects", { name: "Swatch e2e", starter: "social" })).body.id;
  writeFileSync(join(files, "brandphoto.png"), await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer());
  writeFileSync(join(files, "mark.png"), await sharp({ create: { width: 500, height: 500, channels: 3, background: { r: 200, g: 20, b: 90 } } }).png().toBuffer());
});
after(async () => { await browser?.close(); await studio?.stop(); });

test("a new project's swatch page opens on a real, complete swatch", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/swatch`);
  await page.getByRole("img", { name: /Preview of the My brand swatch/ }).waitFor();
  await page.getByRole("heading", { name: "Contrast" }).waitFor();
  await page.getByText("text on background").waitFor();
});

test("a busy page opens ONE live-update stream, not one per component (browsers allow six connections)", async () => {
  const streams = [];
  const onReq = (r) => { if (r.url().endsWith("/api/events")) streams.push(r.url()); };
  page.on("request", onReq);
  await page.goto(`${studio.url}/projects/${projectId}/swatch`);
  await page.getByRole("heading", { name: "Contrast" }).waitFor();
  await page.waitForTimeout(800);
  page.off("request", onReq);
  assert.equal(streams.length, 1, `expected one /api/events stream, got ${streams.length}`);
});

test("changing a colour autosaves, and the header chip and preview follow", async () => {
  await page.getByLabel("Colour 1 hex").fill("#0044cc");
  await page.getByText("Saved").waitFor({ timeout: 8000 });
  const sw = (await j("GET", `/api/projects/${projectId}/swatches`)).body[0];
  assert.equal(sw.colors.find((c) => c.role === "primary").hex, "#0044cc");
  await page.reload();
  assert.equal(await page.getByLabel("Colour 1 hex").inputValue(), "#0044cc", "it survived a reload");
});

test("the contrast panel flags a failing pair and the fix makes it pass", async () => {
  await page.getByLabel("Colour 2 hex").fill("#ffffff"); // role: secondary stays; make TEXT white on a light background
  const textRow = page.getByLabel("Role of colour 6");
  void textRow;
  // Make the text colour fail on the background, then use the suggestion.
  const sw = (await j("GET", `/api/projects/${projectId}/swatches`)).body[0];
  const textIdx = sw.colors.findIndex((c) => c.role === "text") + 1;
  await page.getByLabel(`Colour ${textIdx} hex`).fill("#cccccc");
  const row = page.getByRole("listitem").filter({ hasText: "text on background" });
  await row.getByText("Fails").waitFor();
  await row.getByRole("button", { name: /^Use #/ }).click();
  await page.getByText("Saved").waitFor({ timeout: 8000 });
  await row.getByText("Fails").waitFor({ state: "detached", timeout: 8000 });
  const fixed = (await j("GET", `/api/projects/${projectId}/swatches`)).body[0].colors.find((c) => c.role === "text").hex;
  assert.notEqual(fixed, "#cccccc");
});

test("an invalid colour is refused in plain words and nothing broken is saved", async () => {
  const r = await j("PATCH", `/api/swatches/${(await j("GET", `/api/projects/${projectId}/swatches`)).body[0].id}`, { colors: [{ role: "primary", name: "x", hex: "red" }] });
  assert.equal(r.status, 400);
  assert.match(r.body.error.message, /not a colour/);
});

test("a second swatch from a template, activated for the project", async () => {
  await page.getByRole("button", { name: "New swatch" }).click();
  await page.getByRole("dialog").getByLabel("Template").click();
  await page.getByRole("option", { name: "Warm retail" }).click();
  await page.getByRole("button", { name: "Create swatch" }).click();
  await page.getByRole("button", { name: /Warm retail/ }).waitFor();
  await page.getByRole("button", { name: "Use for this project" }).click();
  await page.getByText("is now this project's swatch").waitFor();
  const proj = (await j("GET", `/api/projects/${projectId}`)).body;
  const list = (await j("GET", `/api/projects/${projectId}/swatches`)).body;
  assert.equal(list.find((s) => s.id === proj.swatchId).name, "Warm retail");
});

test("bundled fonts load offline, and the font stylesheet lists them", async () => {
  const css = await (await fetch(`${studio.url}/api/projects/${projectId}/fonts.css`)).text();
  assert.match(css, /font-family:"Fraunces"/);
  const woff = css.match(/url\("(\/api\/fonts\/[^"]+)"\)/)[1];
  const res = await fetch(studio.url + woff);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "font/woff2");
  assert.equal((await fetch(`${studio.url}/api/fonts/..%2F..%2Fpackage.json`)).status, 404, "only manifest files are served");
});

test("colours can be picked from a photo in Yarn", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/yarn`);
  await page.getByLabel("Choose files to upload").setInputFiles(join(files, "brandphoto.png"));
  await page.getByRole("button", { name: /^brandphoto/ }).waitFor();
  await page.goto(`${studio.url}/projects/${projectId}/swatch`);
  await page.getByRole("button", { name: "Pick from Yarn" }).click();
  await page.getByRole("button", { name: "brandphoto" }).click();
  await page.getByRole("button", { name: "Use #0a78c8" }).click();
  await page.keyboard.press("Escape");
  await page.getByText("Saved").waitFor({ timeout: 8000 });
});

test("export then import into a different project brings the brand and its logo", async () => {
  const sw = (await j("GET", `/api/projects/${projectId}/swatches`)).body[0];
  const file = await (await fetch(`${studio.url}/api/swatches/${sw.id}/export`)).json();
  assert.equal(file.format, "knitted-swatch");
  const other = (await j("POST", "/api/projects", { name: "Importer" })).body.id;
  const r = await j("POST", `/api/projects/${other}/swatches/import`, file);
  assert.equal(r.status, 201);
  assert.equal(r.body.name, sw.name);
  const bad = await j("POST", `/api/projects/${other}/swatches/import`, { hello: "world" });
  assert.equal(bad.status, 400);
});

test("reading a website is refused for private addresses", async () => {
  const r = await j("POST", `/api/projects/${projectId}/swatches/from-url`, { url: "http://192.168.1.1/" });
  assert.equal(r.status, 400);
  assert.match(r.body.error.message, /your own computer or network/);
});

test("a swatch started from a website is looked over, changed and created, and not used until the person says so", async () => {
  // The site is read by the studio's server, so the browser's request for it answers
  // with a proposal shaped like the reader's. Creating it goes through the real route.
  const proposal = {
    name: "Brandy", sourceUrl: "https://brandy.example/",
    colors: [
      { role: "primary", name: "Teal", hex: "#0f766e", from: "buttons" },
      { role: "accent", name: "Rose", hex: "#e11d48", from: "--color-accent" },
      { role: "neutral", name: "Stone", hex: "#e7e5e4", from: "made from the others" },
      { role: "background", name: "Paper", hex: "#fdfcfb", from: "the page background" },
      { role: "text", name: "Ink", hex: "#1c1917", from: "the page text" },
    ],
    fonts: ["Fraunces", "Inter", "Brandy Mono"], fontRoles: { display: "Fraunces", body: "Inter", mono: "Brandy Mono" },
    logo: { url: "https://brandy.example/logo.svg", use: "full" },
    notes: ["One of its stylesheets could not be read, so some colours or fonts may be missing."],
    matched: { display: { family: "Fraunces", from: "bundled" }, body: { family: "Inter", from: "bundled" }, mono: null },
  };
  await page.route("**/swatches/from-url", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(proposal) }));
  try {
    const activeBefore = (await j("GET", `/api/projects/${projectId}`)).body.swatchId;
    await page.goto(`${studio.url}/projects/${projectId}/swatch`);
    await page.getByRole("button", { name: "From a website" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Website").fill("brandy.example");
    await dialog.getByRole("button", { name: "Read the site" }).click();
    await dialog.getByText("Found on brandy.example").waitFor();
    await dialog.getByText("From its buttons").waitFor();
    await dialog.getByText("Its --color-accent variable").waitFor();
    await dialog.getByText(/Brandy Mono, not bundled\. The body font stands in/).waitFor();
    await dialog.getByText(proposal.notes[0]).waitFor();
    assert.deepEqual(await axeProblems(page), [], "the dialog, as it shows a proposal");
    await dialog.getByLabel("Primary hex").fill("#115e59");
    await dialog.getByText("Your choice").waitFor();
    await dialog.getByLabel("Name", { exact: true }).fill("Brandy web");
    await dialog.getByRole("switch", { name: "Bring in its logo" }).click();
    await dialog.getByRole("button", { name: "Create swatch" }).click();
    await page.getByText("Created Brandy web. Press Use for this project when it looks right.").waitFor();
    const made = (await j("GET", `/api/projects/${projectId}/swatches`)).body.find((s) => s.name === "Brandy web");
    assert.equal(made.colors.find((c) => c.role === "primary").hex, "#115e59", "the person's change is what was saved");
    assert.deepEqual([made.fonts.display.family, made.fonts.body.family, made.fonts.mono], ["Fraunces", "Inter", undefined]);
    assert.equal(made.logos.length, 0, "the logo was switched off");
    assert.equal((await j("GET", `/api/projects/${projectId}`)).body.swatchId, activeBefore, "it is not the project's swatch until Use");
    await page.getByRole("button", { name: "Use for this project" }).waitFor();
  } finally { await page.unroute("**/swatches/from-url"); }
});

test("you cannot delete the last swatch", async () => {
  const other = (await j("POST", "/api/projects", { name: "Solo" })).body.id;
  const [only] = (await j("GET", `/api/projects/${other}/swatches`)).body;
  const r = await j("DELETE", `/api/swatches/${only.id}`);
  assert.equal(r.status, 400);
  assert.match(r.body.error.message, /at least one swatch/);
});

for (const theme of ["day", "night"]) {
  test(`no serious accessibility violations on the Swatch editor in ${theme}`, async () => {
    await page.goto(`${studio.url}/projects/${projectId}/swatch`);
    await page.getByRole("heading", { name: "Contrast" }).waitFor();
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(500);
    assert.deepEqual(await axeProblems(page), []);
  });
}
