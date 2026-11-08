// Drawing, as a person meets it: their model draws an SVG through the studio's own MCP
// endpoint (as the in-app chat or Claude Code would), and the person sees it in Yarn, marked
// as drawn by their model with what they asked for. Draw with your model opens the ask.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { axeProblems, launchBrowser, serverHas, startStudio } from "./harness.mjs";

let studio, browser, page, projectId, mcpPath;
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
const CUP = '<svg viewBox="0 0 24 24" fill="none" stroke="#2b2118" stroke-width="2" stroke-linecap="round"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 3v3M12 3v3"/></svg>';

before(async () => {
  studio = await startStudio();
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  projectId = (await j("POST", "/api/projects", { name: "Draw e2e" })).body.id;
});
after(async () => { await browser?.close(); await studio?.stop(); });

test("a model draws an icon: it sees it drawn, and it is in Yarn, marked as drawn, with what was asked", async () => {
  const r = await call("draw_svg", { projectId, svg: CUP, name: "Cup, steaming", prompt: "icons for our cafe's website", folder: "Icons" });
  assert.equal(r.isError, undefined, JSON.stringify(r).slice(0, 300));
  assert.equal(r.content[0].type, "image");
  assert.match(r.content[1].text, /^Cup, steaming \(yn_/);
  await serverHas(studio, `/api/projects/${projectId}/yarn`, (l) => l.some((y) => y.name === "Cup, steaming" && y.meta.made?.by === "model"));

  await page.goto(`${studio.url}/projects/${projectId}/yarn`);
  await page.getByRole("link", { name: /^Icons, folder/ }).click();
  await page.getByRole("button", { name: /^Cup, steaming/ }).first().click();
  const made = page.getByRole("dialog", { name: "Cup, steaming" }).getByRole("region", { name: "How it was made" });
  await made.getByText(/^Drawn by your model/).waitFor();
  await made.getByText("“icons for our cafe's website”").waitFor();
  await page.getByRole("dialog", { name: "Cup, steaming" }).getByText("drawn", { exact: true }).waitFor(); // its tag
});

test("Draw with your model asks what to draw, with ideas to start from", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/yarn`);
  await page.getByRole("button", { name: "Draw with your model" }).click();
  const d = page.getByRole("dialog", { name: "Ask your model to draw" });
  await d.getByLabel("What should it draw?").waitFor();
  await d.getByRole("button", { name: /Icons for our website/ }).click();
  assert.match(await d.getByLabel("What should it draw?").inputValue(), /^Icons for our website/);
  await d.getByRole("button", { name: "Cancel" }).click();
  await page.goto(`${studio.url}/library`);
  await page.getByRole("heading", { name: "What every project shares" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Draw with your model" }).count(), 0, "a drawing is asked for in a project");
});

for (const theme of ["day", "night"]) {
  test(`no serious accessibility problems on a drawing's details, or the ask, in ${theme}`, async () => {
    await page.goto(`${studio.url}/projects/${projectId}/yarn`);
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.getByRole("link", { name: /^Icons, folder/ }).click();
    await page.getByRole("button", { name: /^Cup, steaming/ }).first().click();
    await page.getByRole("dialog", { name: "Cup, steaming" }).getByRole("region", { name: "How it was made" }).waitFor();
    await page.waitForTimeout(400);
    assert.deepEqual(await axeProblems(page), []);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Draw with your model" }).click();
    await page.getByRole("dialog", { name: "Ask your model to draw" }).waitFor();
    await page.waitForTimeout(400);
    assert.deepEqual(await axeProblems(page), []);
    await page.keyboard.press("Escape");
  });
}
