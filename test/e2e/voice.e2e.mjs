import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { execFileSync } from "node:child_process";
import { axeProblems, launchBrowser, serverHas, startStudio } from "./harness.mjs";

const mac = process.platform === "darwin"; // the built-in voice is real speech here; elsewhere it depends on espeak
let studio, browser, page, projectId, patternId;
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const pattern = async () => (await j("GET", `/api/patterns/${patternId}`)).body;

before(async () => {
  studio = await startStudio();
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();
  projectId = (await j("POST", "/api/projects", { name: "Voice e2e", starter: "social" })).body.id;
  patternId = (await j("GET", `/api/projects/${projectId}/patterns`)).body[0].id;
  await j("GET", "/api/voice/voices"); // warm
});
after(async () => { await browser?.close(); await studio?.stop(); });

test("settings: the default voice is the built-in one, and the key is never returned", async () => {
  const c = (await j("GET", "/api/voice/config")).body;
  assert.equal(c.provider, "system");
  assert.ok(!("apiKey" in c));
  assert.equal(typeof c.key.present, "boolean");
});

test("settings: a bad server address is refused in plain words", async () => {
  const r = await j("PUT", "/api/voice/config", { baseUrl: "not a url" });
  assert.equal(r.status, 400);
  assert.match(r.body.error.message, /has to start with http/);
});

test("settings: an unreachable voice server gives a one-line fix, not a stack trace", async () => {
  await j("PUT", "/api/voice/config", { provider: "openai", baseUrl: "http://127.0.0.1:1" });
  const res = await fetch(`${studio.url}/api/voice/test`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hi" }) });
  await j("PUT", "/api/voice/config", { provider: "system" });
  assert.equal(res.status, 502, "the voice's own problem, not something broken in knitted");
  assert.match((await res.json()).error.message, /Could not reach 127\.0\.0\.1:1\. Is your voice server running\?/);
});

test("the Settings Voice tab speaks a test sentence", { skip: !mac }, async () => {
  await page.goto(`${studio.url}/settings`);
  await page.getByRole("tab", { name: "Voice" }).click();
  await page.getByRole("button", { name: "Hear it" }).click();
  await page.getByText(/Worked, \d\.\ds/).waitFor({ timeout: 30000 });
});

test("the Voice panel turns a script into clips on the timeline, with captions", { skip: !mac }, async () => {
  await page.goto(`${studio.url}/projects/${projectId}/patterns/${patternId}`);
  await page.getByRole("application", { name: "Pattern canvas" }).waitFor();
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await page.getByLabel("What should it say?").fill("Make it knitted.\nPattern once. Knit forever.");
  await page.getByRole("button", { name: /Make voiceover \(2 lines\)/ }).click();
  await page.getByText("Voiceover added to the timeline.").waitFor({ timeout: 60000 });
  const p = await pattern();
  assert.equal(p.motion.audio.length, 2);
  assert.equal(p.motion.audio[0].kind, "voice");
  assert.equal(p.motion.audio[0].label, "Make it knitted.");
  assert.ok(p.motion.audio[1].startMs > p.motion.audio[0].startMs, "the second line starts after the first");
  assert.ok(p.durationMs > p.motion.audio[1].startMs, "the video grew to fit the speech");
  assert.deepEqual(p.stitches.filter((s) => /^caption_/.test(s.slot ?? "")).map((s) => s.slot), ["caption_1", "caption_2"]);
  const yarn = (await j("GET", `/api/projects/${projectId}/yarn`)).body.filter((y) => y.tags.includes("voiceover"));
  assert.equal(yarn.length, 2, "each line is audio Yarn, reusable like any file");
});

test("subtitles download as a real .srt with the spoken text", { skip: !mac }, async () => {
  const res = await fetch(`${studio.url}/api/patterns/${patternId}/captions.srt`);
  assert.match(res.headers.get("content-type"), /subrip/);
  const srt = await res.text();
  assert.match(srt, /^1\n00:00:00,\d{3} --> 00:00:0\d,\d{3}\nMake it knitted\.\n/);
  assert.match(srt, /\n2\n.* --> .*\nPattern once\. Knit forever\.\n/);
});

test("knitting that pattern makes an MP4 with sound at a sensible loudness, and every frame intact", { skip: !mac }, async () => {
  const p = await pattern();
  const job = (await j("POST", `/api/patterns/${patternId}/knit`, { params: { reuse: false } })).body;
  let jj;
  for (let i = 0; i < 240; i++) { jj = (await j("GET", `/api/jobs/${job.id}`)).body; if (["done", "failed", "cancelled"].includes(jj.status)) break; await new Promise((r) => setTimeout(r, 500)); }
  assert.equal(jj.status, "done", JSON.stringify([jj.error, jj.progress?.units?.[0]?.issues]));
  const k = (await j("GET", `/api/projects/${projectId}/knits`)).body[0];
  assert.ok(Math.abs(k.report.lufs - -14) < 1.5, `loudness ${k.report.lufs}`);
  const file = `${studio.home}/projects/${projectId}/knits/${k.file}`;
  const streams = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file]).toString().trim().split("\n").sort();
  assert.deepEqual(streams, ["audio", "video"]);
  const frames = Number(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file]).toString().trim());
  assert.equal(frames, Math.round((p.durationMs / 1000) * 30));
});

test("removing a spoken line from the panel removes its clip", { skip: !mac }, async () => {
  await page.goto(`${studio.url}/projects/${projectId}/patterns/${patternId}`);
  await page.getByRole("application", { name: "Pattern canvas" }).waitFor();
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await page.getByRole("button", { name: "Remove Make it knitted." }).click();
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.motion.audio.length === 1);
});

for (const theme of ["day", "night"]) {
  test(`no serious accessibility violations on the Voice panel and the Voice settings in ${theme}`, async () => {
    await page.goto(`${studio.url}/settings`);
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.getByRole("tab", { name: "Voice" }).click();
    await page.getByRole("button", { name: "Hear it" }).waitFor();
    await page.waitForTimeout(400);
    assert.deepEqual(await axeProblems(page), []);
    await page.goto(`${studio.url}/projects/${projectId}/patterns/${patternId}`);
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.getByRole("button", { name: "Voice", exact: true }).click();
    await page.getByLabel("What should it say?").waitFor();
    await page.waitForTimeout(400);
    assert.deepEqual((await axeProblems(page)).filter((p) => !p.startsWith("scrollable-region")), []);
  });
}
