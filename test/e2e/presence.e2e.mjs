// Watching a model work. A person with the studio open sees what a model connected over
// MCP is doing and where: its edits marked on the canvas with its name as they land, a
// list of what it did, Pause to hold its changes, and Follow to go where it works. A
// change of the person's that its edit lands under is carried over, not lost.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { axeProblems, launchBrowser, serverHas, startStudio } from "./harness.mjs";

let studio, browser, page, projectId, story, post, mcpPath;
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
/** A model talking to the studio's own MCP address, as Claude Code does. */
async function mcp(method, params) {
  mcpPath ??= (await j("GET", "/api/agent/mcp")).body.path;
  const res = await fetch(studio.url + mcpPath, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await res.json()).result;
}
const call = (name, args) => mcp("tools/call", { name, arguments: args });
const headline = async (patternId) => (await j("GET", `/api/patterns/${patternId}`)).body.stitches.find((s) => s.slot === "headline");
const frame = () => page.frameLocator('iframe[title="Pattern canvas"]');
async function openEditor(patternId) {
  await page.goto(`${studio.url}/projects/${projectId}/patterns/${patternId}`);
  await page.getByRole("application", { name: "Pattern canvas" }).waitFor();
  await frame().locator("[data-stitch-id]").first().waitFor();
}
const panel = () => page.getByRole("region", { name: "What your model is doing" });
/** Serious accessibility problems once the panel has finished opening: mid-fade, its text is not its colour yet. */
async function problems() {
  await page.locator(".popover").evaluateAll((els) => Promise.all(els.flatMap((e) => e.getAnimations()).map((a) => a.finished)));
  return axeProblems(page);
}

before(async () => {
  studio = await startStudio();
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  projectId = (await j("POST", "/api/projects", { name: "Presence e2e", starter: "social" })).body.id;
  const patterns = (await j("GET", `/api/projects/${projectId}/patterns`)).body;
  story = patterns.find((p) => p.size.name === "Story");
  post = patterns.find((p) => p.size.name === "Post");
  await mcp("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code", version: "2.1.0" } });
  await openEditor(story.id);
});
after(async () => { await browser?.close(); await studio?.stop(); });

test("a model's edit lands on the open canvas marked with its name, and the top bar says what it is doing", async () => {
  assert.equal(await page.getByRole("button", { name: /^Claude Code:/ }).count(), 0, "nothing is shown before a model does anything");
  const r = await call("fill_slots", { patternId: story.id, slots: { headline: "Written while you watch" } });
  assert.deepEqual(JSON.parse(r.content[0].text).filled, ["headline"]);
  await frame().getByText("Written while you watch").waitFor();
  await page.getByRole("button", { name: /^Claude Code: Filling headline on Launch story/ }).waitFor();
  const mark = page.getByTestId(`model-${(await headline(story.id)).id}`);
  await mark.waitFor();
  assert.equal(await mark.innerText(), "Claude Code");
  await page.locator(".model-frame").waitFor();
  assert.deepEqual(await axeProblems(page), []);
  // A moment later the canvas is the person's again.
  await mark.waitFor({ state: "detached", timeout: 15_000 });
});

test("a model working out of sight is a button away: it moves the canvas to what it is changing", async () => {
  const head = await headline(story.id);
  // Zoomed all the way in, and moved to the far side of the frame from the headline.
  for (let i = 0; i < 30; i++) await page.keyboard.press("Control+=");
  const view = await page.getByTestId("canvas-view").boundingBox();
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
  await page.mouse.wheel(head.x + head.w / 2 < 0.5 ? 100000 : -100000, head.y + head.h / 2 < 0.5 ? 100000 : -100000);
  await call("fill_slots", { patternId: story.id, slots: { headline: "Out of sight" } });
  const mark = page.getByTestId(`model-${head.id}`);
  await mark.waitFor({ state: "attached" });
  const meets = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  assert.ok(!meets(await mark.boundingBox(), view), "what it changes is out of sight");
  await page.getByRole("button", { name: "Show where Claude Code is working" }).click();
  await page.waitForFunction((id) => {
    const v = document.querySelector('[data-testid="canvas-view"]').getBoundingClientRect();
    const m = document.querySelector(`[data-testid="model-${id}"]`)?.getBoundingClientRect();
    return m && m.left < v.right && v.left < m.right && m.top < v.bottom && v.top < m.bottom;
  }, head.id);
  assert.equal(await page.getByRole("button", { name: "Show where Claude Code is working" }).count(), 0, "in sight, the way to it goes");
  await page.keyboard.press("Control+0");
  await mark.waitFor({ state: "detached", timeout: 15_000 });
});

test("the list says what it did, and Pause refuses its changes until Resume, telling the model why", async () => {
  await page.getByRole("button", { name: /^Claude Code:/ }).click();
  await panel().getByRole("list", { name: "What it did" }).getByText("Filling headline on Launch story").first().waitFor();
  assert.deepEqual(await problems(), []);
  const was = (await headline(story.id)).content;
  await panel().getByRole("button", { name: "Pause" }).click();
  await serverHas(studio, "/api/agent/activity", (s) => s.paused === true);
  await page.getByRole("button", { name: "Claude Code: Paused, its changes wait for you. Show what it is doing." }).waitFor();
  const refused = await call("fill_slots", { patternId: story.id, slots: { headline: "While paused" } });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /paused you in the studio.*press Resume/);
  assert.equal((await headline(story.id)).content, was, "nothing changed");
  assert.equal((await call("describe_pattern", { patternId: story.id })).isError, undefined, "it can still look");
  await panel().getByText("Paused in the studio.").waitFor();
  await panel().getByRole("button", { name: "Resume" }).click();
  await serverHas(studio, "/api/agent/activity", (s) => s.paused === false);
  await page.keyboard.press("Escape");
});

test("a person's change that a model's lands under is kept, and Undo takes back only the person's", async () => {
  // Hold back the change stream, so the editor cannot take the model's change in first:
  // the person's save meets it on the server, as when both land at the same moment.
  await page.route("**/api/events", (r) => r.abort());
  try {
    await openEditor(story.id);
    const before = await headline(story.id);
    await page.getByRole("list", { name: "Layers" }).getByRole("button", { name: /^headline/ }).click();
    await call("fill_slots", { patternId: story.id, slots: { headline: "The model's words" } });
    await page.keyboard.press("Shift+ArrowRight");
    const moved = (p) => p.stitches.find((s) => s.slot === "headline");
    await serverHas(studio, `/api/patterns/${story.id}`, (p) => moved(p).content === "The model's words" && moved(p).x > before.x);
    await page.getByTestId("editor-announcement").filter({ hasText: /changed headline\. Your changes were kept\./ }).waitFor();
    await frame().getByText("The model's words").waitFor();
    await page.keyboard.press("Control+z");
    await serverHas(studio, `/api/patterns/${story.id}`, (p) => moved(p).x === before.x && moved(p).content === "The model's words");
  } finally { await page.unroute("**/api/events"); }
});

test("Follow goes where the model works and keeps up as it moves, until the person goes somewhere else", async () => {
  await page.goto(`${studio.url}/projects/${projectId}`);
  await page.getByRole("button", { name: /^Claude Code:/ }).click();
  await panel().getByRole("button", { name: "Follow" }).click();
  await page.waitForURL(`**/projects/${projectId}/patterns/${story.id}`);
  await call("fill_slots", { patternId: post.id, slots: { headline: "Over here now" } });
  await page.waitForURL(`**/projects/${projectId}/patterns/${post.id}`);
  await frame().getByText("Over here now").waitFor();
  await page.getByRole("navigation", { name: "Breadcrumbs" }).getByRole("link", { name: "Presence e2e" }).click();
  await page.waitForURL(`**/projects/${projectId}`);
  await call("fill_slots", { patternId: story.id, slots: { headline: "Not followed" } });
  await page.getByRole("button", { name: /^Claude Code: Filling headline on Launch story/ }).waitFor();
  assert.ok(page.url().endsWith(`/projects/${projectId}`), "going back by hand ended following");
  await page.getByRole("button", { name: /^Claude Code:/ }).click();
  await panel().getByRole("button", { name: "Follow" }).waitFor();
  assert.deepEqual(await problems(), []);
});
