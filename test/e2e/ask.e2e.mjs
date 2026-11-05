// Ask your model, end to end: the real studio talking to a scripted fake of the Anthropic API.
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createServer } from "node:http";
import { axeProblems, launchBrowser, serverHas, startStudio } from "./harness.mjs";

let studio, browser, page, projectId, patternId, fake, sent = [];
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const pattern = async () => (await j("GET", `/api/patterns/${patternId}`)).body;
const headline = async () => (await pattern()).stitches.find((s) => s.slot === "headline").content;
/** Undo all on the newest answer, and the server has the headline back as it was. */
const undoAll = async (was) => {
  await page.getByRole("button", { name: "Undo all" }).click();
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.stitches.find((s) => s.slot === "headline").content === was);
};
/** The request that carried a message, found by its words. */
const carrying = (words) => sent.find((b) => { const m = b.messages.at(-1); return m.role === "user" && typeof m.content === "string" && m.content.includes(words); });

before(async () => {
  // A message gets a note and a headline written; the tool's answer gets "Headline written.".
  // A message that says "slowly" is held back, so there is time to press Stop.
  fake = createServer(async (req, res) => {
    let b = ""; for await (const c of req) b += c;
    const body = JSON.parse(b); sent.push(body);
    const last = body.messages.at(-1);
    res.setHeader("content-type", "application/json");
    if (last.role === "user" && typeof last.content === "string") {
      if (last.content.includes("slowly")) await new Promise((r) => setTimeout(r, 8000));
      return res.end(JSON.stringify({ stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 }, content: [
        { type: "thinking", thinking: "Writing the headline.", signature: "sig" },
        { type: "tool_use", id: `t${sent.length}`, name: "fill_slots", input: { projectId, patternId, slots: { headline: "Written by the model" } } },
      ] }));
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

test("Settings, Model gives Claude Code a command with an address that works, and a new address shuts the old", async () => {
  await page.goto(`${studio.url}/settings`);
  await page.getByRole("tab", { name: "Model" }).click();
  const address = page.getByLabel("The address, for other MCP apps");
  await page.waitForFunction(() => document.querySelector("#mcp-url")?.value);
  const url = await address.inputValue();
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/api\/mcp\/[\w-]{32}$/);
  assert.equal(await page.getByLabel("For Claude Code").inputValue(), `claude mcp add --scope user --transport http knitted ${url}`);
  assert.deepEqual(await axeProblems(page), []);

  const list = (u) => fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.ok((await (await list(url)).json()).result.tools.some((t) => t.name === "fill_slots"), "an MCP client at the address gets the tools");
  await page.getByRole("button", { name: "Make a new address" }).click();
  await page.getByText("New address made.").waitFor();
  await page.waitForFunction((old) => document.querySelector("#mcp-url")?.value !== old, url);
  assert.equal((await list(url)).status, 404, "the old address is shut");
  assert.equal((await list(await address.inputValue())).status, 200);
});

test("Settings opens on the tab the address names, where Add a key leads", async () => {
  await page.goto(`${studio.url}/settings?tab=model`);
  await page.getByLabel("The address, for other MCP apps").waitFor();
  assert.equal(await page.getByRole("tab", { name: "Model" }).getAttribute("aria-selected"), "true");
});

test("asking from the editor edits the pattern, and Undo all puts it back", async () => {
  const was = await headline();
  await page.goto(`${studio.url}/projects/${projectId}/patterns/${patternId}`);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByLabel("Message your model").fill("write a headline");
  await page.getByRole("button", { name: "Send" }).click();
  const convo = page.getByRole("list", { name: "Conversation" });
  await convo.getByText("Headline written.").waitFor({ timeout: 30000 });
  assert.equal(await headline(), "Written by the model");
  assert.equal(await convo.getByText("write a headline").count(), 1, "what was asked stays in the conversation");
  await undoAll(was);
  await page.getByText("Put back the way it was.").first().waitFor();
  assert.ok(sent.every((b) => b.model && b.tools.length > 20));
});

test("a reply in the editor goes with the whole conversation before it, as it was", async () => {
  const was = await headline();
  const box = page.getByLabel("Message your model");
  await box.fill("now a shorter one");
  await box.press("Enter");
  const convo = page.getByRole("list", { name: "Conversation" });
  await convo.getByText("Headline written.").nth(1).waitFor({ timeout: 30000 });
  const first = sent.find((b) => b.messages.length === 3 && b.messages[0].content.startsWith("write a headline"));
  const reply = carrying("now a shorter one");
  assert.ok(first && reply);
  assert.deepEqual(reply.messages.slice(0, 3), first.messages, "the first exchange goes back byte for byte");
  assert.equal(reply.messages.length, 5);
  assert.match(reply.messages[4].content, /^now a shorter one/);
  assert.deepEqual(reply.system, first.system);
  await undoAll(was);
});

test("Stop ends a run, and the next message tells the model it was stopped", async () => {
  const was = await headline();
  const box = page.getByLabel("Message your model");
  await box.fill("slowly, please");
  await box.press("Enter");
  await page.getByRole("button", { name: "Stop" }).click();
  const convo = page.getByRole("list", { name: "Conversation" });
  await convo.getByText("Stopped.", { exact: true }).waitFor({ timeout: 15000 });
  await box.fill("never mind that");
  await box.press("Enter");
  await convo.getByText("Headline written.").nth(2).waitFor({ timeout: 30000 });
  assert.match(carrying("never mind that").messages.at(-1).content, /^\(The person stopped you before you finished the last request\./);
  await undoAll(was);
});

test("the Ask panel has no accessibility violations", async () => {
  assert.deepEqual(await axeProblems(page), []);
});

test("the Ask page: a chat about a project is kept, listed, undone and deleted", async () => {
  const was = await headline();
  await page.goto(`${studio.url}/projects/${projectId}`);
  await page.getByRole("link", { name: "Ask your model" }).click();
  await page.waitForURL(/\/ask\?project=/);
  await page.getByRole("heading", { name: "New chat" }).waitFor();
  assert.equal((await page.getByRole("combobox", { name: "Where your model works" }).textContent()).trim(), "Ask e2e");

  const box = page.getByLabel("Message your model");
  await box.fill("Make the post headline");
  await box.press("Enter");
  await page.waitForURL(/\/ask\?chat=ch_/);
  const convo = page.getByRole("list", { name: "Conversation" });
  await convo.getByText("Headline written.").waitFor({ timeout: 30000 });
  assert.equal(await headline(), "Written by the model");
  const name = (await pattern()).name;
  await convo.getByRole("link", { name }).waitFor();
  const chats = page.getByRole("complementary", { name: "Chats" });
  await chats.getByRole("link", { name: /Make the post headline/ }).waitFor();
  assert.match(carrying("Make the post headline").messages[0].content, /\(Project pj_\w+\. No pattern is open\.\)/);
  assert.match(carrying("Make the post headline").system[0].text, /about the project "Ask e2e"/);
  assert.deepEqual(await axeProblems(page), []);

  await page.reload();
  await convo.getByText("Headline written.").waitFor();
  await undoAll(was);

  await chats.getByRole("button", { name: 'Delete the chat "Make the post headline"' }).click();
  await page.getByRole("button", { name: "Delete chat", exact: true }).click();
  await page.waitForURL(/\/ask$/);
  assert.ok(!(await j("GET", "/api/chats")).body.some((c) => c.title === "Make the post headline"));
  assert.equal(await headline(), was, "deleting the chat leaves the work alone");
});

test("the Ask page is in the main navigation", async () => {
  await page.goto(`${studio.url}/`);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Ask" }).click();
  await page.waitForURL(/\/ask$/);
  await page.getByLabel("Message your model").waitFor();
});
