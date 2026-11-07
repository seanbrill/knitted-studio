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
/** A message streamed as the API streams it, an event at a time, `gap` ms apart. */
async function stream(res, model, blocks, stop, gap) {
  res.setHeader("content-type", "text/event-stream");
  const send = (e) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  send({ type: "message_start", message: { id: "msg_live", type: "message", role: "assistant", model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  for (const [index, b] of blocks.entries()) {
    if (b.type === "tool_use") {
      send({ type: "content_block_start", index, content_block: { ...b, input: {} } });
      send({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    } else {
      const key = b.type === "thinking" ? "thinking" : "text";
      send({ type: "content_block_start", index, content_block: { type: b.type, [key]: "" } });
      for (const w of b[key].split(/(?<= )/)) { send({ type: "content_block_delta", index, delta: { type: `${key}_delta`, [key]: w } }); await new Promise((r) => setTimeout(r, gap)); }
      if (b.type === "thinking") send({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: "sig" } });
    }
    send({ type: "content_block_stop", index });
  }
  send({ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } });
  send({ type: "message_stop" });
  res.end();
}
const NOTE = "First I will read the headline as it is now. Then I will make it say what the sale is about, short and warm.";

/** The request that carried a message, found by its words. */
const carrying = (words) => sent.find((b) => { const m = b.messages.at(-1); return m.role === "user" && typeof m.content === "string" && m.content.includes(words); });

before(async () => {
  // A message gets a note and a headline written; the tool's answer gets "Headline written.".
  // A message that says "slowly" is held back, so there is time to press Stop.
  fake = createServer(async (req, res) => {
    let b = ""; for await (const c of req) b += c;
    const body = JSON.parse(b); sent.push(body);
    const last = body.messages.at(-1);
    // "Think out loud" is answered as a stream, slowly: a note a word at a time, the headline, then an answer.
    const asked = [...body.messages].reverse().find((m) => m.role === "user" && typeof m.content === "string");
    if (body.stream && asked?.content.includes("think out loud")) {
      if (last === asked) return stream(res, body.model, [{ type: "thinking", thinking: NOTE }, { type: "tool_use", id: `t${sent.length}`, name: "fill_slots", input: { projectId, patternId, slots: { headline: "Thought out loud" } } }], "tool_use", 350);
      return stream(res, body.model, [{ type: "text", text: "The headline says it now, short and warm." }], "end_turn", 250);
    }
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

test("the Ask page opens the chat from the editor, and a message there goes on with it, about the same pattern", async () => {
  const was = await headline();
  await page.goto(`${studio.url}/`);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Ask" }).click();
  await page.waitForURL(/\/ask\?chat=ch_/);
  await page.getByRole("heading", { name: "write a headline" }).waitFor();
  const convo = page.getByRole("list", { name: "Conversation" });
  await convo.getByText("never mind that").waitFor();
  const name = (await pattern()).name;
  await page.getByText(`About ${name}, in Ask e2e`).waitFor();
  await page.getByLabel("Suggest only (works on a copy)").waitFor();

  const box = page.getByLabel("Message your model");
  await box.fill("once more, from the Ask page");
  await box.press("Enter");
  await convo.getByText("Headline written.").nth(3).waitFor({ timeout: 30000 });
  assert.match(carrying("once more, from the Ask page").messages.at(-1).content, new RegExp(`You are working on this pattern \\(project ${projectId}, pattern ${patternId}\\)`));
  await undoAll(was);
});

test("a project's Ask your model goes on with the chat about it, and New chat starts another there, kept and listed", async () => {
  const was = await headline();
  await page.goto(`${studio.url}/projects/${projectId}`);
  await page.getByRole("link", { name: "Ask your model" }).click();
  await page.waitForURL(/\/ask\?chat=ch_/);
  await page.getByRole("heading", { name: "write a headline" }).waitFor();
  const chats = page.getByRole("complementary", { name: "Chats" });
  await chats.getByRole("button", { name: "New chat" }).click();
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
  await chats.getByRole("link", { name: /Make the post headline/ }).waitFor();
  assert.match(carrying("Make the post headline").messages[0].content, /\(Project pj_\w+\. No pattern is open\.\)/);
  assert.match(carrying("Make the post headline").system[0].text, /about the project "Ask e2e"/);
  assert.deepEqual(await axeProblems(page), []);

  await page.reload();
  await convo.getByText("Headline written.").waitFor();
  await undoAll(was);
});

test("the editor's panel opens the chat from the Ask page, and a message from it is about the pattern open there", async () => {
  const was = await headline();
  await page.goto(`${studio.url}/projects/${projectId}/patterns/${patternId}`);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const convo = page.getByRole("list", { name: "Conversation" });
  await convo.getByText("Make the post headline").waitFor();
  const box = page.getByLabel("Message your model");
  await box.fill("now from the editor");
  await box.press("Enter");
  await convo.getByText("Headline written.").nth(1).waitFor({ timeout: 30000 });
  const asked = carrying("now from the editor");
  const before = sent.find((b) => b.messages.length === 3 && b.messages[0].content.startsWith("Make the post headline"));
  assert.match(asked.messages.at(-1).content, new RegExp(`^now from the editor[\\s\\S]*You are working on this pattern \\(project ${projectId}, pattern ${patternId}\\)`));
  assert.deepEqual(asked.messages.slice(0, 3), before.messages, "the conversation from the Ask page goes back as it was");
  assert.deepEqual(asked.system, before.system);
  await undoAll(was);

  // Its other chats here, to open one instead; and New chat, a new one on this pattern.
  await page.getByRole("button", { name: "Chats" }).click();
  const panel = page.getByRole("complementary", { name: "ask panel" });
  await panel.getByRole("button", { name: /^write a headline/ }).waitFor();
  assert.deepEqual(await axeProblems(page), []);
  await panel.getByRole("button", { name: /^write a headline/ }).click();
  await convo.getByText("never mind that").waitFor();
  await page.getByRole("button", { name: "New chat" }).click();
  await page.getByText("It works on this pattern with you").waitFor();
});

test("a message from a pattern in another project is turned down, as the chat is about this one", async () => {
  const other = (await j("POST", "/api/projects", { name: "Elsewhere", starter: "social" })).body.id;
  const there = (await j("GET", `/api/projects/${other}/patterns`)).body[0].id;
  const chat = (await j("GET", "/api/chats")).body.find((c) => c.title === "Make the post headline");
  const r = await j("POST", `/api/chats/${chat.id}/messages`, { prompt: "over there", patternId: there });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.kind, "elsewhere");
  assert.equal((await j("GET", `/api/chats/${chat.id}`)).body.turns.length, 2, "nothing was sent");
});

test("deleting the chat being had leaves a new one, and the work alone", async () => {
  const was = await headline();
  const chat = (await j("GET", "/api/chats")).body.find((c) => c.title === "Make the post headline");
  await page.goto(`${studio.url}/ask?chat=${chat.id}`);
  const chats = page.getByRole("complementary", { name: "Chats" });
  await chats.getByRole("button", { name: 'Delete the chat "Make the post headline"' }).click();
  await page.getByRole("button", { name: "Delete chat", exact: true }).click();
  await page.waitForURL(/\/ask$/);
  await page.getByRole("heading", { name: "New chat" }).waitFor();
  assert.ok(!(await j("GET", "/api/chats")).body.some((c) => c.title === "Make the post headline"));
  assert.equal(await headline(), was, "deleting the chat leaves the work alone");
});

test("the Ask page is in the main navigation", async () => {
  await page.goto(`${studio.url}/`);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Ask" }).click();
  await page.waitForURL(/\/ask$/);
  await page.getByLabel("Message your model").waitFor();
});

test("with the chat closed, the canvas shows what your model thinks as it thinks it, and it can be made small or closed", async () => {
  await page.goto(`${studio.url}/projects/${projectId}/patterns/${patternId}`);
  await page.getByRole("application", { name: "Pattern canvas" }).waitFor();
  assert.equal(await page.getByRole("complementary", { name: "ask panel" }).count(), 0, "the chat is closed");
  assert.equal((await j("POST", "/api/chats", { patternId, prompt: "think out loud about the headline" })).status, 202);
  const bubble = page.getByRole("group", { name: "What your model is thinking" });
  await bubble.getByText("First I will read").waitFor({ timeout: 15000 });
  assert.ok(!(await bubble.innerText()).includes("short and warm"), "the note shows as it is written, before it is finished");
  assert.match(await bubble.innerText(), /Thinking/);
  assert.deepEqual((await axeProblems(page)).filter((p) => !p.startsWith("scrollable-region")), []);

  // Small, it is a dot, and stays one after a reload; the dot opens it again.
  await bubble.getByRole("button", { name: "Make it small" }).click();
  await page.getByTestId("model-bubble-dot").waitFor();
  assert.equal(await bubble.count(), 0);
  await page.reload();
  await page.getByTestId("model-bubble-dot").click();
  await bubble.getByText(/short and warm\./).waitFor({ timeout: 15000 });
  await page.locator('[aria-live="polite"]').filter({ hasText: "Your model thought: First I will read" }).waitFor();

  // The stitch it changes is outlined with its name, and the answer comes in, then it says it is finished.
  const head = (await pattern()).stitches.find((s) => s.slot === "headline");
  await page.getByTestId(`model-${head.id}`).waitFor({ timeout: 15000 });
  assert.equal(await page.getByTestId(`model-${head.id}`).innerText(), "Your model");
  await bubble.getByText("Finished").waitFor({ timeout: 15000 });
  assert.match(await bubble.innerText(), /The headline says it now, short and warm\./);
  assert.equal(await headline(), "Thought out loud");
  await bubble.waitFor({ state: "detached", timeout: 10000 });

  // Closed, it stays closed for the rest of that run.
  assert.equal((await j("POST", "/api/chats", { patternId, prompt: "think out loud once more" })).status, 202);
  await bubble.getByText("First I will read").waitFor({ timeout: 15000 });
  await bubble.getByRole("button", { name: "Close" }).click();
  assert.equal(await bubble.count(), 0);
  await page.getByTestId(`model-${head.id}`).waitFor({ timeout: 20000 });
  assert.equal(await bubble.count() + await page.getByTestId("model-bubble-dot").count(), 0, "it is still working, and still closed");
});

test("Ask your model on a pattern starts a chat about it, and the person keeps working", async () => {
  const p = await pattern();
  await page.goto(`${studio.url}/projects/${projectId}`);
  await page.getByRole("button", { name: `Actions for ${p.name}` }).first().click();
  await page.getByRole("menuitem", { name: "Ask your model..." }).click();
  const dialog = page.getByRole("dialog", { name: "Ask your model to change this pattern" });
  await dialog.getByLabel("What should change?").fill("make the headline shorter");
  await dialog.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByText(`Your model is on it: ${p.name}`).waitFor();
  await dialog.waitFor({ state: "detached" });
  await serverHas(studio, `/api/patterns/${patternId}`, () => !!carrying("make the headline shorter"));
  const asked = carrying("make the headline shorter").messages.at(-1).content;
  assert.match(asked, new RegExp(p.name), "the model is told which pattern");
  assert.match(asked, /What I want: make the headline shorter/);
  await page.getByRole("button", { name: "Open the chat" }).click();
  await page.waitForURL(/\/ask\?chat=/);
  await page.getByRole("list", { name: "Conversation" }).getByText("Headline written.").waitFor({ timeout: 30000 });
});

test("Spending shows what the answers cost, and a monthly limit stops the next one with a way to raise it", async () => {
  const u = (await j("GET", "/api/agent/usage")).body;
  assert.ok(u.month > 0 && u.models.length > 0, "the answers so far were priced and kept");
  await page.goto(`${studio.url}/settings?tab=spending`);
  await page.getByRole("heading", { name: "Spending" }).waitFor();
  await page.getByText("No monthly limit", { exact: false }).waitFor();
  await page.getByRole("table", { name: "This month, by model" }).waitFor();
  assert.deepEqual(await axeProblems(page), []);

  await page.getByLabel("Monthly limit, in dollars").fill("0");
  await page.getByRole("button", { name: "Save limits" }).click();
  await page.getByText("Limits saved.").waitFor();
  await page.getByText("The limit is reached", { exact: false }).waitFor();
  assert.equal((await j("GET", "/api/agent/usage")).body.limits.monthly, 0);

  const before = sent.length;
  await page.goto(`${studio.url}/ask?project=${projectId}`);
  const box = page.getByLabel("Message your model");
  await box.fill("one more headline, please");
  await box.press("Enter");
  await page.getByText(/Your key has spent \$[\d.]+ this month, and your limit is \$0\.00/).waitFor({ timeout: 30000 });
  await page.getByRole("link", { name: "Open Spending" }).click();
  await page.waitForURL(/tab=spending/);
  assert.equal(sent.length, before, "nothing was sent to the model");
  assert.equal((await j("PUT", "/api/agent/usage", { monthly: null })).status, 200);
});

test("a message sent while the model answers waits its turn, and goes when the answer is in", async () => {
  // Last in the file: it adds answers to the chat, and the tests before count them.
  const was = await headline();
  await page.goto(`${studio.url}/ask?project=${projectId}`);
  const box = page.getByLabel("Message your model");
  await box.waitFor();
  await box.fill("slowly, the first one");
  await box.press("Enter");
  await page.getByRole("button", { name: "Stop" }).waitFor();
  await box.fill("then the second one");
  await page.getByRole("button", { name: "Queue it" }).click();
  await box.fill("and a third, taken out");
  await box.press("Enter");
  const waiting = page.getByRole("list", { name: "Waiting to send" });
  assert.deepEqual(await waiting.locator(".chat-queue-text").allInnerTexts(), ["then the second one", "and a third, taken out"]);
  assert.equal(await box.inputValue(), "", "queued, the box is free for the next thing");
  await page.getByRole("button", { name: /^Take "and a third, taken out" out of the queue/ }).click();
  assert.equal(carrying("then the second one"), undefined, "nothing goes before the answer is in");
  await waiting.waitFor({ state: "detached", timeout: 30000 });
  const convo = page.getByRole("list", { name: "Conversation" });
  await convo.getByText("then the second one").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Stop" }).waitFor({ state: "detached", timeout: 30000 });
  assert.ok(carrying("then the second one"), "it went once the first was answered");
  assert.equal(carrying("and a third, taken out"), undefined, "one taken out of the queue never goes");
  // Both wrote the same headline, so the last changed nothing and has no Undo all: put it back as it was.
  await j("POST", `/api/patterns/${patternId}/commands`, { command: { type: "fillSlot", slot: "headline", content: was } });
  await serverHas(studio, `/api/patterns/${patternId}`, (p) => p.stitches.find((s) => s.slot === "headline").content === was);
});
