// Ask your model, end to end: the real studio talking to a scripted fake of the Anthropic API.
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createServer } from "node:http";
import { axeProblems, launchBrowser, startStudio } from "./harness.mjs";

let studio, browser, page, projectId, patternId, fake, sent = [];
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const pattern = async () => (await j("GET", `/api/patterns/${patternId}`)).body;

before(async () => {
  fake = createServer(async (req, res) => {
    let b = ""; for await (const c of req) b += c;
    const body = JSON.parse(b); sent.push(body);
    const last = body.messages.at(-1);
    res.setHeader("content-type", "application/json");
    if (last.role === "user" && typeof last.content === "string") {
      return res.end(JSON.stringify({ stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "tool_use", id: "t1", name: "fill_slots", input: { projectId, patternId, slots: { headline: "Written by the model" } } }] }));
    }
    res.end(JSON.stringify({ stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: "Headline written." }] }));
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  process.env.KNITTED_ANTHROPIC_URL = `http://127.0.0.1:${fake.address().port}`;
  process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
  studio = await startStudio();
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();
  projectId = (await j("POST", "/api/projects", { name: "Ask e2e", starter: "social" })).body.id;
  patternId = (await j("GET", `/api/projects/${projectId}/patterns`)).body[0].id;
});
after(async () => { await browser?.close(); await studio?.stop(); fake?.closeAllConnections(); fake?.close(); });

test("settings: the key is reported as present but never returned", async () => {
  const c = (await j("GET", "/api/agent/model")).body;
  assert.equal(c.key.present, true);
  assert.ok(!JSON.stringify(c).includes("sk-test-not-real"));
});

test("asking from the editor edits the pattern, and Undo all puts it back", async () => {
  const before = (await pattern()).stitches.find((s) => s.slot === "headline").content;
  await page.goto(`${studio.url}/projects/${projectId}/patterns/${patternId}`);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByLabel("What should your model do?").fill("write a headline");
  await page.getByRole("button", { name: "Ask", exact: true }).nth(1).click();
  await page.getByRole("status").getByText("Headline written.").waitFor({ timeout: 30000 });
  assert.equal((await pattern()).stitches.find((s) => s.slot === "headline").content, "Written by the model");
  await page.getByRole("button", { name: "Undo all" }).click();
  await page.getByText("Put back the way it was.").waitFor();
  assert.equal((await pattern()).stitches.find((s) => s.slot === "headline").content, before);
  assert.ok(sent.every((b) => b.model && b.tools.length > 20));
});

test("the Ask panel has no accessibility violations", async () => {
  assert.deepEqual(await axeProblems(page), []);
});
