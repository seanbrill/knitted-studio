import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { axeProblems, launchBrowser, startStudio } from "./harness.mjs";
import { ROOT } from "../lib/scan.mjs";

let studio, browser, page, projectId;
const files = mkdtempSync(join(tmpdir(), "knitted-yarn-e2e-"));
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
const f = (n) => join(files, n);

before(async () => {
  studio = await startStudio();
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  projectId = (await j("POST", "/api/projects", { name: "Yarn e2e", starter: "social" })).body.id;
  const png = (w, h, c) => sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();
  writeFileSync(f("photo.png"), await png(1400, 900, { r: 223, g: 90, b: 15 }));
  writeFileSync(f("brand-logo.png"), await png(300, 300, { r: 20, g: 20, b: 200 }));
  await sharp(await png(1000, 700, { r: 200, g: 30, b: 30 })).jpeg().toFile(f("shot.jpg"));
  writeFileSync(f("fake.png"), "I am not an image");
  writeFileSync(f("hostile.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" onload="alert(1)"><script>alert(1)</script><circle cx="60" cy="60" r="50" fill="#df5a0f"/></svg>`);
  writeFileSync(f("serif.woff"), readFileSync(join(ROOT, "node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff")));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=2", "-pix_fmt", "yuv420p", f("clip.mp4")]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5", f("tone.wav")]);
});
after(async () => { await browser?.close(); await studio?.stop(); });

test("an empty library invites the first upload", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/yarn`);
  await page.getByText("Add your first Yarn").waitFor();
});

test("uploading several kinds at once adds each, with progress and an honest end state", async () => {
  await page.getByLabel("Choose files to upload").setInputFiles(["photo.png", "shot.jpg", "hostile.svg", "serif.woff", "clip.mp4", "tone.wav", "fake.png"].map(f));
  for (const name of ["photo", "shot", "hostile", "serif", "clip", "tone"]) await page.getByRole("button", { name: new RegExp(`^${name}`) }).waitFor({ timeout: 20000 });
  await page.getByRole("region", { name: "Uploads" }).waitFor();
  await page.getByText(/not a real PNG/).waitFor();
  assert.equal(((await j("GET", `/api/projects/${projectId}/yarn`)).body).length, 6, "the fake PNG was refused");
});

test("the hostile SVG was stored clean and is served sandboxed", async () => {
  const svg = (await j("GET", `/api/projects/${projectId}/yarn`)).body.find((y) => y.name === "hostile");
  const res = await fetch(`${studio.url}/api/yarn/${svg.id}/file`);
  const text = await res.text();
  assert.doesNotMatch(text, /script|onload/);
  assert.match(res.headers.get("content-security-policy"), /sandbox/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});

test("uploading the same photo again says it is already there instead of duplicating", async () => {
  await page.getByLabel("Choose files to upload").setInputFiles(f("photo.png"));
  await page.getByText(/Already in Yarn/).waitFor();
  assert.equal(((await j("GET", `/api/projects/${projectId}/yarn`)).body).length, 6);
});

test("video can be scrubbed: the file route answers byte ranges", async () => {
  const v = (await j("GET", `/api/projects/${projectId}/yarn`)).body.find((y) => y.kind === "video");
  const res = await fetch(`${studio.url}/api/yarn/${v.id}/file`, { headers: { range: "bytes=0-99" } });
  assert.equal(res.status, 206);
  assert.match(res.headers.get("content-range"), /^bytes 0-99\/\d+$/);
  assert.equal((await res.arrayBuffer()).byteLength, 100);
  const bad = await fetch(`${studio.url}/api/yarn/${v.id}/file`, { headers: { range: "bytes=999999999-" } });
  assert.equal(bad.status, 416);
});

test("kind filters and search narrow the library, and a late answer never undoes a search", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/yarn`);
  await page.getByRole("radio", { name: "Video" }).click();
  await page.getByRole("button", { name: /^photo/ }).waitFor({ state: "detached" });
  await page.getByRole("button", { name: /^clip/ }).waitFor();
  // The whole library answers after the search does, as a busy server can: what the
  // search found has to stand. (Under load this put the clip back, and the test hung.)
  const whole = (u) => u.pathname === `/api/projects/${projectId}/yarn` && !u.search;
  await page.route(whole, async (r) => { await new Promise((ok) => setTimeout(ok, 1200)); await r.continue().catch(() => {}); });
  try {
    const late = page.waitForResponse((res) => whole(new URL(res.url())));
    await page.getByRole("radio", { name: "All" }).click();
    await page.getByLabel("Search yarn").fill("ton");
    await page.getByRole("button", { name: /^tone/ }).waitFor();
    await page.getByRole("button", { name: /^clip/ }).waitFor({ state: "detached" });
    await late;
    await page.waitForTimeout(300);
    assert.equal(await page.getByRole("button", { name: /^clip/ }).count(), 0, "the late answer put the clip back");
  } finally { await page.unroute(whole); }
  await page.getByLabel("Search yarn").fill("");
});

test("the detail drawer renames, tags, and shows the facts", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/yarn`);
  await page.getByRole("button", { name: /^photo/ }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByText("1400 x 900").waitFor();
  await drawer.getByLabel("Name", { exact: true }).fill("Hero photo");
  await drawer.getByLabel("Name", { exact: true }).blur();
  await drawer.getByLabel("Add a tag").fill("Product");
  await drawer.getByLabel("Add a tag").press("Enter");
  await drawer.getByText("product").waitFor();
  const y = (await j("GET", `/api/projects/${projectId}/yarn`)).body.find((x) => x.name === "Hero photo");
  assert.ok(y, "renamed on the server");
  assert.deepEqual(y.tags, ["product"]);
  await page.keyboard.press("Escape");
});

test("a small logo carries the theme's own warning", async () => {
  await page.getByLabel("Choose files to upload").setInputFiles(f("brand-logo.png"));
  await page.getByRole("button", { name: /^brand-logo/ }).click();
  await page.getByRole("dialog").getByText(/That logo is 300px wide\. Upload one at least 1000px wide to print sharp\./).waitFor();
  await page.keyboard.press("Escape");
});

test("deleting shows Undo, and Undo brings it back", async () => {
  await page.getByRole("button", { name: /^tone/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: /^tone/ }).waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: /^tone/ }).waitFor();
});

test("deleting yarn that a pattern uses names the pattern and leaves the stitch intact", async () => {
  const yarn = (await j("GET", `/api/projects/${projectId}/yarn`)).body.find((y) => y.name === "Hero photo");
  const [story] = (await j("GET", `/api/projects/${projectId}/patterns`)).body;
  const backdrop = story.stitches.find((s) => s.slot === "backdrop");
  await j("POST", `/api/patterns/${story.id}/commands`, { command: { type: "updateStitch", id: backdrop.id, patch: { yarnId: yarn.id } } });
  await page.goto(`${studio.url}/projects/${projectId}/yarn`);
  await page.getByRole("button", { name: /^Hero photo/ }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Launch story" }).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await page.getByText(/It is used in 1 pattern: Launch story/).waitFor();
  await page.getByRole("button", { name: "Delete yarn" }).click();
  await page.getByRole("button", { name: /^Hero photo/ }).waitFor({ state: "detached" });
  const after = (await j("GET", `/api/patterns/${story.id}`)).body;
  assert.equal(after.stitches.find((s) => s.slot === "backdrop").yarnId, yarn.id, "the stitch keeps its reference, so Undo restores everything");
});

test("new copy and a link import", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/yarn`);
  await page.getByRole("button", { name: "New copy" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Launch headlines");
  await page.getByRole("dialog").getByLabel("Text").fill("Make it knitted.\nPattern once.");
  await page.getByRole("button", { name: "Save copy" }).click();
  await page.getByRole("button", { name: /^Launch headlines/ }).waitFor();

  await page.getByRole("button", { name: "From a link" }).click();
  await page.getByRole("dialog").getByLabel("Link").fill("http://127.0.0.1:1/x.png");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText(/your own computer or network/).waitFor();
  await page.keyboard.press("Escape");
});

test("cancelling an upload leaves no partial file behind", async () => {
  // A 150MB body through a throttled route would be slow; use the API and abort mid-stream instead.
  const ctrl = new AbortController();
  const big = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(2_000_000)); setTimeout(() => ctrl.abort(), 150); } });
  await fetch(`${studio.url}/api/projects/${projectId}/yarn?filename=big.mp4`, { method: "POST", body: big, duplex: "half", signal: ctrl.signal }).catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  const { readdirSync, existsSync } = await import("node:fs");
  const tmpDir = join(studio.home, "projects", projectId, "yarn", ".tmp");
  assert.deepEqual(existsSync(tmpDir) ? readdirSync(tmpDir) : [], [], "no .part file left");
});

for (const theme of ["day", "night"]) {
  test(`no serious accessibility violations on the Yarn library in ${theme}`, async () => {
    await page.goto(`${studio.url}/projects/${projectId}/yarn`);
    await page.getByRole("button", { name: /^photo/ }).waitFor().catch(() => {});
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(400);
    assert.deepEqual(await axeProblems(page), []);
  });
}
