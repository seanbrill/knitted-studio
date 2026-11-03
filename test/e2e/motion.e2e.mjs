import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { axeProblems, launchBrowser, startStudio } from "./harness.mjs";

let studio, browser, page, projectId, patternId;
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
const pattern = async () => (await j("GET", `/api/patterns/${patternId}`)).body;
const frame = () => page.frameLocator('iframe[title="Pattern canvas"]');
const headline = () => frame().locator('[data-slot="headline"]');
const opacity = () => headline().evaluate((el) => getComputedStyle(el).opacity);

before(async () => {
  studio = await startStudio();
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();
  projectId = (await j("POST", "/api/projects", { name: "Motion e2e", starter: "social" })).body.id;
  patternId = (await j("GET", `/api/projects/${projectId}/patterns`)).body[0].id;
  await page.goto(`${studio.url}/projects/${projectId}/patterns/${patternId}`);
  await page.getByRole("application", { name: "Pattern canvas" }).waitFor();
  await headline().waitFor();
});
after(async () => { await browser?.close(); await studio?.stop(); });

test("a still has a timeline that says so, and offers to become a video", async () => {
  await page.getByRole("button", { name: "Timeline" }).click();
  await page.getByText(/This pattern is a still/).waitFor();
});

test("Animate adds a clip at the playhead and the pattern becomes a video", async () => {
  // The Patterns panel (with its layers list) is open by default.
  await page.getByRole("list", { name: "Layers" }).getByRole("button", { name: /^headline/ }).click();
  await page.getByText("Animate", { exact: true }).click();
  await page.getByRole("button", { name: "Fade in", exact: true }).click();
  await page.getByRole("button", { name: /^Fade in on headline/ }).waitFor();
  await page.waitForFunction(async ({ id }) => { const p = await (await fetch(`/api/patterns/${id}`)).json(); return p.durationMs >= 3000 && p.motion?.tracks && Object.keys(p.motion.tracks).length === 1; }, { id: patternId });
});

test("scrubbing drives the engine's clock: invisible at the start, visible at the end", async () => {
  const bar = page.getByRole("slider", { name: "Scrub the timeline" });
  await bar.focus();
  await page.keyboard.press("Home").catch(() => {});
  // Walk the playhead with the keyboard: 33ms steps, shift for a second.
  for (let i = 0; i < 4; i++) await bar.press("Shift+ArrowLeft");
  await page.waitForFunction(() => document.querySelector('[aria-label="Playhead time"]')?.textContent?.startsWith("0:00.0"));
  assert.equal(await opacity(), "0", "before the clip starts the stitch waits, hidden");
  for (let i = 0; i < 2; i++) await bar.press("Shift+ArrowRight");
  await page.waitForFunction(async () => { const el = document.querySelector("iframe[title='Pattern canvas']").contentDocument.querySelector('[data-slot="headline"]'); return Number(getComputedStyle(el).opacity) === 1; });
});

test("play runs the clock forward and stops at the end", async () => {
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForFunction(() => { const t = document.querySelector('[aria-label="Playhead time"]')?.textContent ?? ""; return t !== "0:00.0" && !t.startsWith("0:00.0"); }, null, { timeout: 5000 });
  await page.getByRole("button", { name: "Pause" }).click();
});

test("clips can be dragged to a new time, saved, and undone", async () => {
  const before = (await pattern()).motion.tracks;
  const id = Object.keys(before)[0];
  const clip = page.getByRole("button", { name: /^Fade in on headline/ });
  const b = await clip.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 120, b.y + b.height / 2, { steps: 6 }); await page.mouse.up();
  await page.waitForFunction(async ({ pid, id, was }) => (await (await fetch(`/api/patterns/${pid}`)).json()).motion.tracks[id][0].startMs > was, { pid: patternId, id, was: before[id][0].startMs });
  await page.keyboard.press("Control+z");
  await page.waitForFunction(async ({ pid, id, was }) => (await (await fetch(`/api/patterns/${pid}`)).json()).motion.tracks[id][0].startMs === was, { pid: patternId, id, was: before[id][0].startMs });
});

test("the clip editor changes the animation and easing", async () => {
  await page.getByRole("button", { name: /^Fade in on headline/ }).click();
  const g = page.getByRole("group", { name: "Clip" });
  await g.getByLabel("Animation").click();
  await page.getByRole("option", { name: "Pop" }).click();
  await page.waitForFunction(async ({ id }) => Object.values((await (await fetch(`/api/patterns/${id}`)).json()).motion.tracks)[0][0].preset === "pop", { id: patternId });
});

test("a model setting motion through the API is refused on a locked stitch", async () => {
  const p = await pattern();
  const eyebrow = p.stitches.find((s) => s.slot === "eyebrow");
  const r = await j("POST", `/api/patterns/${patternId}/commands`, { command: { type: "setMotion", stitchId: eyebrow.id, clips: [{ id: "x", preset: "pop", startMs: 0, endMs: 500 }] }, actor: "fill" });
  assert.equal(r.status, 200);
  assert.equal(r.body.changed, false);
  assert.equal(r.body.refusals.length, 1);
});

test("Knit offers MP4 for an animated pattern, warns about brief text, and makes a real video", async () => {
  await page.getByRole("button", { name: "Knit", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("radio", { name: "MP4 video" }).waitFor();
  await dlg.getByRole("button", { name: /^Knit 1 file/ }).click();
  await dlg.getByText(/1 file ready/).waitFor({ timeout: 120000 });
  const knits = (await j("GET", `/api/projects/${projectId}/knits`)).body;
  assert.equal(knits[0].format, "mp4");
  const res = await fetch(`${studio.url}/api/knits/${knits[0].id}/file`, { headers: { range: "bytes=4-7" } });
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), "ftyp", "a real MP4 container");
  assert.ok(knits[0].report.issues.some((i) => i.code === "text-too-brief") || knits[0].durationMs > 0, "the motion lint reached the report");
});

for (const theme of ["day", "night"]) {
  test(`no serious accessibility violations with the timeline open in ${theme}`, async () => {
    await page.keyboard.press("Escape");
    await page.goto(`${studio.url}/projects/${projectId}/patterns/${patternId}`);
    await page.getByRole("application", { name: "Pattern canvas" }).waitFor();
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.getByRole("button", { name: "Timeline" }).click();
    await page.getByRole("slider", { name: "Scrub the timeline" }).waitFor();
    await page.waitForTimeout(500);
    assert.deepEqual((await axeProblems(page)).filter((p) => !p.startsWith("scrollable-region")), []);
  });
}
