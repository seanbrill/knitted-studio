// A chat with the model: one conversation over many runs, against a scripted fake of the
// Anthropic API. What matters is that each run sends the conversation back exactly as it
// was and only adds to the end, and that a run ending early leaves it fit to go on.

import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addChatRun, getChat, openStore } from "@knitted/core/node";
import { cancelAgent, runAgent, startAgentJob, startChat } from "../src/index.mjs";

const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-chat-")), "k.db"));
const project = store.createProject({ name: "Chats", starter: "social" });
const [story, post] = store.listPatterns(project.id);

/** A fake /v1/messages: `script(n, seen)` answers the nth request, `{ status, body }` for an error. Records what it was sent. */
function fake(script, { delay = 0 } = {}) {
  const seen = [];
  const server = createServer(async (req, res) => {
    let b = ""; for await (const c of req) b += c;
    seen.push({ headers: req.headers, body: JSON.parse(b) });
    const out = script(seen.length, seen);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    res.statusCode = out.status ?? 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(out.status ? out.body : out));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ baseUrl: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() })));
}
const use = (id, name, input) => ({ type: "tool_use", id, name, input });
const said = (text, stop = "end_turn") => ({ content: [{ type: "text", text }], stop_reason: stop, usage: { input_tokens: 10, output_tokens: 5 } });
const turn = (content, stop = "tool_use") => ({ content, stop_reason: stop, usage: { input_tokens: 10, output_tokens: 5 } });
const ended = async (id) => {
  for (let i = 0; i < 200; i++) { const j = store.getJob(id); if (!["queued", "running"].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error("the run did not end");
};

test("each message sends the conversation back as it was, thinking and all, and adds to the end", async () => {
  const f = await fake((n) => turn([{ type: "thinking", thinking: `Working out answer ${n}.`, signature: `sig${n}` }, { type: "text", text: `Answer ${n}.` }], "end_turn"));
  const chat = startChat(store, { projectId: project.id, prompt: "What can you do?" });
  const one = await ended(startAgentJob(store, { chatId: chat.id, prompt: "What can you do?", apiKey: "k", baseUrl: f.baseUrl, model: "claude-opus-5-5" }).id);
  const two = await ended(startAgentJob(store, { chatId: chat.id, prompt: "And then?", apiKey: "k", baseUrl: f.baseUrl, model: "claude-opus-5-5" }).id);
  assert.equal(one.status, "done"); assert.equal(two.status, "done");
  assert.equal(two.result.text, "Answer 2.");

  const [a, b] = f.seen.map((s) => s.body);
  assert.match(a.messages[0].content, /^What can you do\?\n\n\(Project pj_\w+\. No pattern is open\.\)$/);
  assert.deepEqual(b.messages.slice(0, 2), [...a.messages, { role: "assistant", content: [{ type: "thinking", thinking: "Working out answer 1.", signature: "sig1" }, { type: "text", text: "Answer 1." }] }], "the first exchange goes back byte for byte");
  assert.deepEqual(b.messages[2], { role: "user", content: "And then?" }, "a later message is only what was asked");
  assert.deepEqual(b.system, a.system, "the instructions never change in a chat, so the cache and the thinking hold");
  assert.equal(a.system[0].cache_control.type, "ephemeral");
  assert.equal(a.cache_control.type, "ephemeral", "the conversation so far is cached too");
  assert.match(a.system[0].text, /about the project "Chats"/);
  assert.equal(getChat(store, chat.id).messages.length, 4);
  assert.ok(one.progress.events.some((e) => e.type === "note" && e.text === "Working out answer 1."), "what it wrote while it worked is shown");
  f.close();
});

test("a run that was stopped is said to have been, and the next message goes on from what it did", async () => {
  const f = await fake((n) => (n === 1 ? said("never seen") : said("Here now.")), { delay: 300 });
  const chat = startChat(store, { projectId: project.id, prompt: "Slow one" });
  const first = startAgentJob(store, { chatId: chat.id, prompt: "Slow one", apiKey: "k", baseUrl: f.baseUrl });
  assert.equal(first.status, "running", "running from the start: an app that closes now marks it interrupted");
  await new Promise((r) => setTimeout(r, 50));
  cancelAgent(first.id);
  assert.equal((await ended(first.id)).status, "cancelled");
  const next = await ended(startAgentJob(store, { chatId: chat.id, prompt: "Try this instead", apiKey: "k", baseUrl: f.baseUrl }).id);
  assert.equal(next.status, "done");
  const sent = f.seen.at(-1).body.messages;
  assert.match(sent[0].content, /^Slow one/, "what was asked before is still there");
  assert.match(sent[1].content, /^\(The person stopped you before you finished the last request\. Leave it unless they ask for it again\.\)\n\nTry this instead$/);
  f.close();
});

test("a run the app closed on is lost from the conversation, so the next message says what it was", async () => {
  const f = await fake(() => said("Picking it up."));
  const chat = startChat(store, { projectId: project.id, prompt: "Lost one" });
  const lost = store.createJob("agent", project.id, { prompt: "Lost one", chatId: chat.id });
  addChatRun(store, chat.id, lost.id);
  store.updateJob(lost.id, { status: "running" });
  assert.equal(store.interruptStaleJobs(), 1);
  await ended(startAgentJob(store, { chatId: chat.id, prompt: "Where were we?", apiKey: "k", baseUrl: f.baseUrl }).id);
  assert.match(f.seen[0].body.messages[0].content, /^\(The app closed while you were answering their last message, and your answer was lost\. It was: "Lost one"\. Some of it may be done already\.\)\n\nWhere were we\?/);
  f.close();
});

test("a request that fails before anything comes back is taken out of the chat", async () => {
  const f = await fake((n) => (n === 1 ? { status: 401, body: { error: { message: "bad key" } } } : said("Hello.")));
  const chat = startChat(store, { projectId: null, prompt: "Hi" });
  const failed = await ended(startAgentJob(store, { chatId: chat.id, prompt: "Hi", apiKey: "k", baseUrl: f.baseUrl }).id);
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /That key was rejected/);
  assert.deepEqual(getChat(store, chat.id).messages, []);
  await ended(startAgentJob(store, { chatId: chat.id, prompt: "Hi again", apiKey: "k", baseUrl: f.baseUrl }).id);
  const sent = f.seen.at(-1).body.messages;
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /^Hi again\n\n\(No project is open\. The projects are: .*Chats \(pj_\w+\)/, "a chat about the whole studio is told what there is");
  f.close();
});

test("stopped part way through its tools: the ones that did not run are answered, so the chat can go on", async () => {
  const f = await fake(() => turn([use("a", "list_projects", {}), use("b", "list_projects", {})]));
  const history = [];
  const ctl = new AbortController();
  await assert.rejects(runAgent({ store, projectId: project.id, prompt: "Look twice", apiKey: "k", baseUrl: f.baseUrl, history, signal: ctl.signal, onEvent: (e) => { if (e.type === "tool_call") ctl.abort(); } }), (e) => e.kind === "cancelled");
  const results = history.at(-1).content;
  assert.deepEqual(results.map((r) => [r.tool_use_id, !!r.is_error]), [["a", false], ["b", true]]);
  assert.equal(results[1].content, "Not run: the person stopped you.");
  f.close();
});

test("a turn cut off with tools unanswered gets their answers before the next message", async () => {
  const f = await fake(() => said("Carrying on."));
  const history = [{ role: "user", content: "Do it" }, { role: "assistant", content: [{ type: "thinking", thinking: "This part of the response was interrupted before it finished.", signature: "s" }, use("t9", "list_projects", {})] }];
  const events = [];
  await runAgent({ store, projectId: project.id, prompt: "Go on", apiKey: "k", baseUrl: f.baseUrl, history, onEvent: (e) => events.push(e) });
  const sent = f.seen[0].body.messages;
  assert.deepEqual(sent[2], { role: "user", content: [{ type: "tool_result", tool_use_id: "t9", is_error: true, content: "Not run: that turn ended before it could be." }] });
  assert.deepEqual(sent[3], { role: "user", content: "Go on" });
  assert.equal(sent[1].content[0].thinking, "This part of the response was interrupted before it finished.", "the cut-off note goes back unchanged");
  f.close();
});

test("a declined answer is not kept: the request is taken back, the person is told, nothing is done", async () => {
  const f = await fake(() => ({ content: [{ type: "text", text: "Half an ans" }], stop_reason: "refusal", stop_details: { category: "cyber" }, usage: { input_tokens: 10, output_tokens: 0 } }));
  const history = [{ role: "user", content: "Earlier" }, { role: "assistant", content: [{ type: "text", text: "Earlier answer." }] }];
  const events = [];
  const r = await runAgent({ store, projectId: project.id, prompt: "Something it declines", apiKey: "k", baseUrl: f.baseUrl, history, onEvent: (e) => events.push(e) });
  assert.deepEqual(r.declined, { category: "cyber" });
  assert.equal(r.text, "", "a partial answer it declined is not passed off as the answer");
  assert.equal(r.stopped, "refusal");
  assert.equal(history.length, 2, "the chat is as it was before the message");
  assert.ok(events.some((e) => e.type === "stopped" && /declined to answer this, so nothing was done/.test(e.why)));
  assert.ok(!events.some((e) => e.type === "text"));
  f.close();
});

test("after a fallback, only the text from before the last switch goes back, and the switch marker stays", async () => {
  const fb = { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" } };
  const f = await fake((n) => (n === 1 ? turn([{ type: "thinking", thinking: "Hmm", signature: "s1" }, { type: "text", text: "Starting." }, use("x", "list_projects", {}), fb, { type: "text", text: "Done, on the other model." }], "end_turn") : said("ok")));
  const history = [];
  const r = await runAgent({ store, projectId: project.id, prompt: "Go", apiKey: "k", baseUrl: f.baseUrl, history });
  assert.equal(r.text, "Done, on the other model.");
  assert.deepEqual(history[1].content.map((b) => b.type), ["text", "fallback", "text"]);
  f.close();
});

test("what each model is asked for: progress notes and fallbacks where Anthropic offers them", async () => {
  const f = await fake(() => said("ok"));
  const ask = async (model, extra = {}) => { await runAgent({ store, projectId: project.id, prompt: "x", apiKey: "k", baseUrl: f.baseUrl, model, ...extra }); return f.seen.at(-1); };

  const opus = await ask("claude-opus-5-5");
  assert.deepEqual(opus.headers["anthropic-beta"].split(","), ["thinking-binding-controls-2026-08-01", "thinking-display-updates-2026-08-18"]);
  assert.deepEqual(opus.body.thinking, { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" }, display: "updates" });
  assert.equal(opus.body.fallbacks, undefined, "fallbacks are only asked of Anthropic's own API");
  assert.equal(opus.body.max_tokens, 16000, "room for the thinking and the answer");

  const haiku = await ask("claude-haiku-5-5");
  assert.equal(haiku.headers["anthropic-beta"], "thinking-binding-controls-2026-08-01");
  assert.equal(haiku.body.thinking.display, undefined);

  // At Anthropic's own address: no network, the request is caught on its way out.
  const out = [];
  const fetchImpl = async (url, init) => { out.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return new Response(JSON.stringify(said("ok")), { status: 200, headers: { "content-type": "application/json" } }); };
  for (const model of ["claude-sonnet-5-5", "claude-fable-5-1", "claude-haiku-5-5"]) await runAgent({ store, projectId: project.id, prompt: "x", apiKey: "k", model, fetchImpl });
  assert.equal(out[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(out[0].body.fallbacks, "default");
  assert.match(out[0].headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
  assert.equal(out[1].body.fallbacks, "default");
  assert.equal(out[2].body.fallbacks, undefined, "Haiku has no fallback");
  assert.doesNotMatch(out[2].headers["anthropic-beta"], /server-side-fallback/);
  f.close();
});

test("an address that turns the betas down is asked plainly, then and from then on", async () => {
  const f = await fake((n, seen) => (seen.at(-1).headers["anthropic-beta"] ? { status: 400, body: { error: { message: "unknown field: block_binding" } } } : said("Plain is fine.")));
  const r = await runAgent({ store, projectId: project.id, prompt: "x", apiKey: "k", baseUrl: f.baseUrl, model: "claude-sonnet-5-5" });
  assert.equal(r.text, "Plain is fine.");
  assert.equal(f.seen.length, 2);
  assert.equal(f.seen[1].headers["anthropic-beta"], undefined);
  assert.equal(f.seen[1].body.thinking, undefined);
  await runAgent({ store, projectId: project.id, prompt: "again", apiKey: "k", baseUrl: f.baseUrl, model: "claude-sonnet-5-5" });
  assert.equal(f.seen.length, 3, "remembered: one request, not two");
  assert.equal(f.seen[2].headers["anthropic-beta"], undefined);
  f.close();

  // When asking plainly fails too, the first answer is the one that says why.
  const g = await fake(() => ({ status: 400, body: { error: { message: "messages: bad" } } }));
  await assert.rejects(runAgent({ store, projectId: project.id, prompt: "x", apiKey: "k", baseUrl: g.baseUrl, model: "claude-opus-5-5" }), /The model could not be reached: messages: bad/);
  assert.equal(g.seen.length, 2);
  g.close();
});

test("a run that changes two patterns lists both, each with the revision Undo all puts back", async () => {
  const before = { story: store.revisions(story.id, 1)[0].id, post: store.revisions(post.id, 1)[0].id };
  const f = await fake((n) => (n === 1
    ? turn([use("a", "fill_slots", { projectId: project.id, patternId: story.id, slots: { headline: "Story line" } }), use("b", "fill_slots", { projectId: project.id, patternId: post.id, slots: { headline: "Post line" } })])
    : said("Both done.")));
  const r = await runAgent({ store, projectId: project.id, prompt: "Headlines on both", apiKey: "k", baseUrl: f.baseUrl });
  const byId = Object.fromEntries(r.changed.map((c) => [c.patternId, c]));
  assert.equal(byId[story.id].baselineRevisionId, before.story);
  assert.equal(byId[post.id].baselineRevisionId, before.post);
  assert.equal(byId[story.id].count, 1);
  assert.equal(byId[story.id].made, false);
  assert.equal(byId[post.id].projectId, project.id);
  for (const c of r.changed) store.restoreRevision(c.patternId, c.baselineRevisionId);
  assert.notEqual(store.getPattern(story.id).stitches.find((s) => s.slot === "headline").content, "Story line");
  assert.notEqual(store.getPattern(post.id).stitches.find((s) => s.slot === "headline").content, "Post line");
  f.close();
});

test("a pattern it makes is listed as made, with nothing to put back", async () => {
  const f = await fake((n) => (n === 1 ? turn([use("d", "duplicate_pattern", { patternId: story.id })]) : said("Copied it.")));
  const r = await runAgent({ store, projectId: project.id, prompt: "Copy the story", apiKey: "k", baseUrl: f.baseUrl });
  const made = r.changed.find((c) => c.made);
  assert.ok(made, "the copy is in the list");
  assert.equal(made.baselineRevisionId, null);
  assert.notEqual(made.patternId, story.id);
  assert.ok(!r.changed.some((c) => c.patternId === story.id), "copying a pattern does not change it");
  f.close();
});
