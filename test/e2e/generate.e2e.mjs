// Making photos and video, through the studio as a person and their model use it: a Google
// key added and tested in Settings, Generate; two photos made from the Make dialog, with the
// price shown first; the details of one; a video made by the model over MCP, priced first.
// Google and OpenAI here are stand-ins on this computer (KNITTED_GENERATE_API) that check what
// they are sent; nothing reaches a real provider, and the key goes to the test's own folder.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { axeProblems, launchBrowser, serverHas, startStudio } from "./harness.mjs";

let studio, browser, page, fake, projectId, mcpPath;
const KEY = "AIza-e2e-test-key-777";
const asked = [];
let made = 0;
const dir = mkdtempSync(join(tmpdir(), "knitted-gen-e2e-"));
const mp4 = join(dir, "clip.mp4");
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

/** The stand-in for Google: every address is /<host>/<path>, as KNITTED_GENERATE_API sends it. */
function fakeGoogle() {
  return createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const u = new URL(req.url, "http://x");
    const body = raw ? JSON.parse(raw) : null;
    asked.push({ path: u.pathname, key: req.headers["x-goog-api-key"] ?? "", search: u.search, body });
    const send = (status, b) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
    if (req.headers["x-goog-api-key"] !== KEY) return send(400, { error: { code: 400, message: "API key not valid.", status: "INVALID_ARGUMENT" } });
    if (u.pathname === "/generativelanguage.googleapis.com/v1beta/models") return send(200, { models: [] });
    if (u.pathname === "/generativelanguage.googleapis.com/v1beta/interactions") {
      if (body.response_format.type === "video") return send(200, { steps: [{ type: "model_output", content: [{ type: "video", mime_type: "video/mp4", data: readFileSync(mp4).toString("base64") }] }] });
      made++;
      const img = await sharp({ create: { width: 96, height: 120, channels: 3, background: { r: (made * 60) % 255, g: 140, b: 90 } } }).png().toBuffer();
      return send(200, { steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: img.toString("base64") }] }] });
    }
    send(404, { error: { message: u.pathname } });
  });
}

before(async () => {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=180x320:rate=24:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", mp4]);
  fake = fakeGoogle();
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  studio = await startStudio({ env: { KNITTED_GENERATE_API: `http://127.0.0.1:${fake.address().port}` } });
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  projectId = (await j("POST", "/api/projects", { name: "Make e2e" })).body.id;
});
after(async () => { await browser?.close(); await studio?.stop(); fake?.close(); });

const dialog = () => page.getByRole("dialog", { name: "Make a photo or video" });

test("with no key, Make says which key to add, and where", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/yarn`);
  await page.getByRole("button", { name: "Make", exact: true }).click();
  await dialog().getByText(/Making photos needs an OpenAI or Google Gemini key/).waitFor();
  assert.equal(await dialog().getByRole("button", { name: /^Make it/ }).isDisabled(), true);
  await dialog().getByRole("link", { name: "Open Settings" }).click();
  await page.waitForURL(/settings\?tab=generate/);
});

test("Settings, Generate: a Google key is saved and tested, and never comes back", async () => {
  await page.getByRole("heading", { name: "Make photos and video" }).waitFor();
  const g = page.getByRole("region", { name: /^Google Gemini/ });
  await g.getByText(/no free tier/).waitFor();
  await g.getByLabel("Google Gemini key").fill(KEY);
  await g.getByRole("button", { name: "Save" }).click();
  await g.getByText(/A key is saved/).waitFor();
  await g.getByRole("button", { name: "Test" }).click();
  await g.getByText("Google Gemini took the key.").waitFor();
  assert.ok(asked.some((a) => a.path.endsWith("/v1beta/models")), "tested by listing models");
  const cfg = await j("GET", "/api/generate/config");
  assert.doesNotMatch(JSON.stringify(cfg.body), new RegExp(KEY));
  assert.equal(cfg.body.sources.find((s) => s.provider === "google").key.present, true);
});

test("two photos are made from the Make dialog, priced before, and kept in Yarn with how they were made", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/yarn`);
  await page.getByRole("button", { name: "Make", exact: true }).click();
  await dialog().getByText("A square photo, good quality, with Nano Banana 2.1, for about $0.05.").waitFor();
  await dialog().getByLabel("What to make").fill("A latte on a marble counter, morning light");
  await dialog().getByRole("radio", { name: "Feed 4:5" }).click();
  await dialog().getByRole("combobox", { name: "How many" }).click();
  await page.getByRole("option", { name: "2", exact: true }).click();
  await dialog().getByRole("button", { name: "Make it, about $0.10" }).click();
  await page.getByText(/^Making two 4:5 photos, good quality, with Nano Banana 2\.1, for about \$0\.10\./).waitFor();
  await page.getByText("2 new files are in Yarn. It cost $0.10.").waitFor({ timeout: 20_000 });
  const yarn = await serverHas(studio, `/api/projects/${projectId}/yarn`, (l) => l.filter((y) => y.meta.made?.by === "provider").length === 2);
  const one = yarn.find((y) => y.name === "A latte on a marble counter, morning light 1");
  assert.equal(one.meta.made.model, "gemini-nano-banana-2.1");
  const sent = asked.filter((a) => a.path.endsWith("/interactions"));
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].body.response_format, { type: "image", aspect_ratio: "4:5", image_size: "2K" });
  assert.ok(asked.every((a) => !a.search.includes(KEY)), "the key never in an address");

  await page.getByRole("button", { name: /^A latte on a marble counter, morning light 1/ }).first().click();
  const how = page.getByRole("dialog", { name: "A latte on a marble counter, morning light 1" }).getByRole("region", { name: "How it was made" });
  await how.getByText(/^Made by Google Gemini, Nano Banana 2\.1,/).waitFor();
  await how.getByText("It cost $0.05.").waitFor();
  await how.getByText(/invisible mark saying it was made with AI/).waitFor();
});

test("Make a photo from this starts from the picture", async () => {
  await page.getByRole("button", { name: "Make a photo from this" }).click();
  await dialog().getByText("Working from").waitFor();
  await dialog().getByRole("button", { name: "Do not work from A latte on a marble counter, morning light 1" }).waitFor();
  await dialog().getByRole("button", { name: "Cancel" }).click();
});

test("the model prices a video first, then makes it, and sees frames of it", async () => {
  const est = await call("generate_video", { projectId, prompt: "The latte steams, the camera pushes in slowly", seconds: 4, estimate: true });
  const said = JSON.parse(est.content[0].text);
  assert.equal(said.costUsd, 0.28);
  assert.match(said.would, /^a 4-second 9:16 video at 720p, with Gemini Omni 1\.2 Flash/);
  const r = await call("generate_video", { projectId, prompt: "The latte steams, the camera pushes in slowly", seconds: 4, name: "Steam" });
  assert.equal(r.isError, undefined, JSON.stringify(r).slice(0, 400));
  assert.equal(r.content[0].type, "image");
  assert.match(r.content[1].text, /^Made a 4-second 9:16 video at 720p, with Gemini Omni 1\.2 Flash: Steam \(yn_.*It cost \$0\.28\. Six frames/);
  const video = asked.find((a) => a.body?.response_format?.type === "video");
  assert.deepEqual(video.body.response_format, { type: "video", duration: "4s", aspect_ratio: "9:16", resolution: "720p" });
  await serverHas(studio, `/api/projects/${projectId}/yarn`, (l) => l.some((y) => y.name === "Steam" && y.kind === "video"));
  const spend = (await j("GET", "/api/agent/usage")).body;
  assert.ok(spend.kinds.some((k) => k.kind === "generate" && Math.abs(k.cost - 0.38) < 0.001), JSON.stringify(spend.kinds));
});

for (const theme of ["day", "night"]) {
  test(`no serious accessibility problems on Settings, Generate and the Make dialog in ${theme}`, async () => {
    await page.goto(`${studio.url}/settings?tab=generate`);
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.getByRole("region", { name: /^Google Gemini/ }).waitFor();
    await page.waitForTimeout(300);
    assert.deepEqual(await axeProblems(page), []);
    await page.goto(`${studio.url}/projects/${projectId}/yarn`);
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.getByRole("button", { name: "Make", exact: true }).click();
    await dialog().getByText(/with Nano Banana 2\.1, for about/).waitFor();
    await page.waitForTimeout(400);
    assert.deepEqual(await axeProblems(page), []);
    await page.keyboard.press("Escape");
  });
}
