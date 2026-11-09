// Ask without a key: a chat had while there was one is still there to read, and says how to write in it
// again; a new chat says how to start. The model is a fake on this computer; the key goes to the
// test's own secrets folder, never the Keychain.
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createServer } from "node:http";
import { axeProblems, launchBrowser, serverHas, startStudio } from "./harness.mjs";

let studio, browser, page, fake, chatId;
const ANSWER = "The spring sale headline is ready for you to look at.";
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

before(async () => {
  // Every message is answered at once, in words: as a stream when it is asked for one.
  fake = createServer(async (req, res) => {
    let b = ""; for await (const c of req) b += c;
    const body = JSON.parse(b);
    if (!body.stream) return res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: body.model, stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: ANSWER }] }));
    res.setHeader("content-type", "text/event-stream");
    const send = (e) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    send({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } });
    send({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    send({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: ANSWER } });
    send({ type: "content_block_stop", index: 0 });
    send({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } });
    send({ type: "message_stop" });
    res.end();
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  studio = await startStudio({ env: { KNITTED_ANTHROPIC_URL: `http://127.0.0.1:${fake.address().port}`, ANTHROPIC_API_KEY: "" } });
  browser = await launchBrowser();
  page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
});
after(async () => { await browser?.close(); await studio?.stop(); fake?.closeAllConnections(); fake?.close(); });

test("a chat had with a key is kept, and read without one", async () => {
  assert.equal((await j("GET", "/api/agent/model")).body.key.present, false, "it starts with no key");
  await j("PUT", "/api/agent/model", { apiKey: "sk-test-not-real" });
  const started = await j("POST", "/api/chats", { prompt: "Write a headline about the spring sale" });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  chatId = started.body.chat.id;
  await serverHas(studio, `/api/chats/${chatId}`, (c) => c.turns.at(-1)?.status === "done");
  await j("PUT", "/api/agent/model", { clearKey: true });
  assert.equal((await j("GET", "/api/agent/model")).body.key.present, false, "the key is gone");

  await page.goto(`${studio.url}/ask?chat=${chatId}`);
  const talk = page.getByRole("list", { name: "Conversation" });
  await talk.getByText("Write a headline about the spring sale").waitFor();
  await talk.getByText(ANSWER).waitFor();
  const note = page.getByRole("note", { name: "Writing needs a key" });
  await note.getByText(/To write in this chat again, add your Anthropic key/).waitFor();
  assert.equal(await page.getByLabel("Message your model").count(), 0, "nothing to type in that cannot be sent");
  await note.getByRole("link", { name: "Add a key in Settings" }).waitFor();
  assert.deepEqual(await axeProblems(page), []);
});

test("a new chat with no key says what asking is like and the two ways in", async () => {
  // Ask opens the chat being had, which is still there to read.
  await page.goto(`${studio.url}/ask`);
  await page.getByRole("note", { name: "Writing needs a key" }).waitFor();
  await page.getByRole("button", { name: "New chat" }).first().click();
  await page.getByRole("list", { name: "What you could ask" }).waitFor();
  await page.getByRole("link", { name: "Add a key in Settings" }).first().waitFor();
  await page.getByRole("link", { name: "Connect Claude Code" }).waitFor();
  // The chat had before is still in the list, and opens.
  await page.getByRole("link", { name: /Write a headline about the spring sale/ }).first().click();
  await page.getByRole("note", { name: "Writing needs a key" }).waitFor();
});

test("the claims check without a key says how to check them: a key, or Claude Code with check_claims", async () => {
  const projectId = (await j("POST", "/api/projects", { name: "Claims, no key", starter: "social" })).body.id;
  const patternId = (await j("GET", `/api/projects/${projectId}/patterns`)).body[0].id;
  await j("PUT", `/api/projects/${projectId}/brief`, { profile: "# What they offer\nBread, baked daily." });
  await page.goto(`${studio.url}/projects/${projectId}/patterns/${patternId}`);
  const note = page.getByRole("note", { name: "Checking needs a key" });
  await note.waitFor();
  assert.match(await note.innerText(), /check_claims/);
  assert.equal(await note.getByRole("link", { name: "Add a key in Settings" }).getAttribute("href"), "/settings?tab=model");
  assert.equal(await note.getByRole("link", { name: "Connect Claude Code" }).getAttribute("href"), "/settings?tab=model#claude-code");
  assert.equal(await page.getByRole("button", { name: "Check the claims" }).count(), 0, "nothing offered that cannot work");
  assert.equal((await j("POST", `/api/patterns/${patternId}/claims`)).status, 400);
});
