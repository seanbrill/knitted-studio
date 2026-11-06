// An answer streamed as server-sent events is put together as the message a plain request
// returns, and what the model writes is shown as it writes it, without the library changing.

import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentLive, agentState, openStore } from "@knitted/core/node";
import { AgentError, runAgent, startAgentJob } from "../src/index.mjs";
import { readMessage, StreamError } from "../src/stream.mjs";

const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-stream-")), "k.db"));
const project = store.createProject({ name: "Streams", starter: "social" });
const [story] = store.listPatterns(project.id);

/** The events of one streamed message, as the API sends them. */
const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const start = (usage = { input_tokens: 12, output_tokens: 1 }) => ({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, usage } });
const block = (index, content_block) => ({ type: "content_block_start", index, content_block });
const delta = (index, d) => ({ type: "content_block_delta", index, delta: d });
const stop = (index) => ({ type: "content_block_stop", index });
const end = (stop_reason, output_tokens = 9) => [{ type: "message_delta", delta: { stop_reason, stop_sequence: null }, usage: { output_tokens } }, { type: "message_stop" }];
/** A stream as a Response, cut into pieces that do not fall on the edges of events. */
const streamed = (text, piece = 7) => new Response(new ReadableStream({
  start(c) { const b = Buffer.from(text); for (let i = 0; i < b.length; i += piece) c.enqueue(b.subarray(i, i + piece)); c.close(); },
}), { headers: { "content-type": "text/event-stream" } });

test("text comes in pieces, each shown with all of it so far, and the message is whole at the end", async () => {
  const seen = [];
  const msg = await readMessage(streamed(sse([start(), block(0, { type: "text", text: "" }), delta(0, { type: "text_delta", text: "Spring " }), delta(0, { type: "text_delta", text: "sale." }), stop(0), ...end("end_turn")])), { onDelta: (d) => seen.push(d) });
  assert.deepEqual(msg.content, [{ type: "text", text: "Spring sale." }]);
  assert.equal(msg.stop_reason, "end_turn");
  assert.deepEqual(msg.usage, { input_tokens: 12, output_tokens: 9 }, "the counts at the end are added to those at the start");
  assert.deepEqual(seen.map((d) => d.text), ["Spring ", "Spring sale."]);
  assert.ok(seen.every((d) => d.type === "text" && d.index === 0));
});

test("thinking keeps its signature, a tool's input is put together, and lines may end in CRLF", async () => {
  const text = sse([
    start(),
    block(0, { type: "thinking", thinking: "" }), delta(0, { type: "thinking_delta", thinking: "Looking at " }), delta(0, { type: "thinking_delta", thinking: "the headline." }), delta(0, { type: "signature_delta", signature: "c2ln" }), stop(0),
    block(1, { type: "tool_use", id: "t1", name: "fill_slots", input: {} }), delta(1, { type: "input_json_delta", partial_json: "{\"slots\": {\"head" }), delta(1, { type: "input_json_delta", partial_json: "line\": \"Hi\"}}" }), stop(1),
    ...end("tool_use"),
  ]).replace(/\n/g, "\r\n");
  const notes = [];
  const msg = await readMessage(streamed(text, 5), { onDelta: (d) => notes.push(d) });
  assert.deepEqual(msg.content, [{ type: "thinking", thinking: "Looking at the headline.", signature: "c2ln" }, { type: "tool_use", id: "t1", name: "fill_slots", input: { slots: { headline: "Hi" } } }]);
  assert.equal(msg.stop_reason, "tool_use");
  assert.deepEqual(notes.map((d) => [d.type, d.text]), [["thinking", "Looking at "], ["thinking", "Looking at the headline."]], "a tool's input is not shown as it comes");
});

test("an error part way is thrown with the API's name for it", async () => {
  const text = sse([start(), block(0, { type: "text", text: "" }), delta(0, { type: "text_delta", text: "Half" }), { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]);
  await assert.rejects(readMessage(streamed(text)), (e) => e instanceof StreamError && e.type === "overloaded_error" && e.message === "Overloaded");
});

test("a server that answers all at once is read whole, as before", async () => {
  const body = { content: [{ type: "text", text: "All at once." }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 2 } };
  const msg = await readMessage(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }), { onDelta: () => assert.fail("nothing streams") });
  assert.deepEqual(msg, body);
});

test("a stream cut off in a tool's input leaves that input empty, never half of it", async () => {
  const text = sse([start(), block(0, { type: "tool_use", id: "t1", name: "fill_slots", input: {} }), delta(0, { type: "input_json_delta", partial_json: "{\"slots\": {\"head" })]);
  const msg = await readMessage(streamed(text));
  assert.deepEqual(msg.content, [{ type: "tool_use", id: "t1", name: "fill_slots", input: {} }]);
});

/** A fake /v1/messages that streams `script(n)`, a list of events, or answers `{ status, body }`. */
function fake(script, { gap = 0 } = {}) {
  const seen = [];
  const server = createServer(async (req, res) => {
    let b = ""; for await (const c of req) b += c;
    seen.push(JSON.parse(b));
    const out = script(seen.length);
    if (out.status) { res.statusCode = out.status; res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(out.body)); }
    res.setHeader("content-type", "text/event-stream");
    for (const e of out) { res.write(sse([e])); if (gap) await new Promise((r) => setTimeout(r, gap)); }
    res.end();
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ baseUrl: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() })));
}
const CUT_OFF = "This part of the response was interrupted before it finished.";
/** A note, written a word at a time, then a call to fill the headline. */
const noteThenFill = (note) => [
  start(), block(0, { type: "thinking", thinking: "" }), ...note.split(/(?<= )/).map((w) => delta(0, { type: "thinking_delta", thinking: w })), delta(0, { type: "signature_delta", signature: "sig" }), stop(0),
  block(1, { type: "tool_use", id: "t1", name: "fill_slots", input: {} }), delta(1, { type: "input_json_delta", partial_json: JSON.stringify({ patternId: story.id, slots: { headline: "Streamed in" } }) }), stop(1), ...end("tool_use"),
];
const answer = (text) => [start(), block(0, { type: "text", text: "" }), ...text.split(/(?<= )/).map((w) => delta(0, { type: "text_delta", text: w })), stop(0), ...end("end_turn")];

test("the run asks for a stream, shows the note as it is written, and the sentinel for cut-off work never", async () => {
  const f = await fake((n) => (n === 1 ? noteThenFill("I will write the headline now.") : n === 2
    ? [start(), block(0, { type: "thinking", thinking: "" }), delta(0, { type: "thinking_delta", thinking: CUT_OFF.slice(0, 20) }), delta(0, { type: "thinking_delta", thinking: CUT_OFF.slice(20) }), stop(0), block(1, { type: "text", text: "" }), delta(1, { type: "text_delta", text: "Done." }), stop(1), ...end("end_turn")]
    : answer("Unused.")));
  const live = [];
  const r = await runAgent({ store, projectId: project.id, patternId: story.id, prompt: "a headline", apiKey: "k", baseUrl: f.baseUrl, onLive: (l) => live.push(l) });
  assert.equal(f.seen[0].stream, true, "it asks for a stream");
  assert.equal(r.text, "Done.");
  assert.equal(store.getPattern(story.id).stitches.find((s) => s.slot === "headline").content, "Streamed in", "the tool's input, put together, is what ran");
  const notes = live.filter((l) => l.kind === "note");
  assert.deepEqual(notes.filter((l) => !l.done).map((l) => l.text), ["I", "I will", "I will write", "I will write the", "I will write the headline", "I will write the headline now."], "each word shows as it comes");
  assert.deepEqual(notes.filter((l) => l.done).map((l) => l.text), ["I will write the headline now."], "and once, finished");
  assert.ok(!live.some((l) => l.text.includes("interrupted") || CUT_OFF.startsWith(l.text)), "the stand-in for cut-off work is never shown");
  assert.deepEqual(live.at(-1), { kind: "text", text: "Done.", done: true });
  // The message sent back is the one that streamed: thinking, signature and the tool's input.
  assert.deepEqual(f.seen[1].messages[1].content, [{ type: "thinking", thinking: "I will write the headline now.", signature: "sig" }, { type: "tool_use", id: "t1", name: "fill_slots", input: { patternId: story.id, slots: { headline: "Streamed in" } } }]);
  f.close();
});

test("trouble part way through a stream gets the same one-line fix as before it", async () => {
  const f = await fake(() => [start(), block(0, { type: "text", text: "" }), delta(0, { type: "text_delta", text: "Half" }), { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]);
  await assert.rejects(runAgent({ store, projectId: project.id, prompt: "x", apiKey: "k", baseUrl: f.baseUrl }), (e) => e instanceof AgentError && e.kind === "server" && /having trouble/.test(e.message));
  f.close();
  const g = await fake(() => [start(), { type: "error", error: { type: "rate_limit_error", message: "Slow down" } }]);
  await assert.rejects(runAgent({ store, projectId: project.id, prompt: "x", apiKey: "k", baseUrl: g.baseUrl }), (e) => e.kind === "rate");
  g.close();
});

const ended = async (id) => {
  for (let i = 0; i < 300; i++) { const j = store.getJob(id); if (!["queued", "running"].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error("the run did not end");
};

test("a run's words are in the models' state while it writes them, where it works, and stay a moment after with how it ended", async () => {
  const seen = [];
  // An answer long enough to be seen as it comes, after the finished note has been shown its while.
  const said = "All done here, and the headline now says what the sale is about, in the brand's own voice.";
  const f = await fake((n) => (n === 1 ? noteThenFill("Reading the pattern first, then the headline.") : answer(said)), { gap: 40 });
  try {
  const job = startAgentJob(store, { projectId: project.id, patternId: story.id, prompt: "a headline", apiKey: "k", baseUrl: f.baseUrl });
  for (let i = 0; i < 200 && ["queued", "running"].includes(store.getJob(job.id).status); i++) {
    const l = agentState(store).live?.find((x) => x.jobId === job.id);
    if (l) seen.push(l);
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.equal((await ended(job.id)).status, "done");
  assert.ok(seen.length > 2, "it was there while it ran");
  assert.ok(seen.every((l) => l.client === "Your model" && l.where.patternId === story.id && l.where.projectId === project.id));
  assert.ok(seen.some((l) => l.kind === "note" && !l.done && l.text.startsWith("Reading") && l.text !== "Reading the pattern first, then the headline."), "a note shows before it is finished");
  assert.ok(seen.some((l) => l.kind === "note" && l.done && l.text === "Reading the pattern first, then the headline."), "and once it is finished");
  assert.ok(seen.some((l) => l.kind === "text" && l.text.startsWith("All") && l.text !== said), "and so does the answer, as it comes");
  const last = agentState(store).live?.find((x) => x.jobId === job.id);
  assert.deepEqual({ kind: last?.kind, text: last?.text, done: last?.done, ended: last?.ended }, { kind: "text", text: said, done: true, ended: "done" }, "its last words stay, with how it ended");
  const now = Date.now;
  Date.now = () => now() + 7000;
  try { assert.equal(agentState(store).live?.some((x) => x.jobId === job.id), false, "then go"); } finally { Date.now = now; }
  } finally { f.close(); }
});

test("the words of a run the app closed on go with it", () => {
  const job = store.updateJob(store.createJob("agent", project.id, { prompt: "x" }).id, { status: "running" });
  agentLive(store, job.id, { client: "Your model", where: { projectId: project.id, patternId: story.id }, kind: "note", text: "Halfway through", done: false });
  assert.equal(agentState(store).live?.some((x) => x.jobId === job.id), true);
  assert.equal(store.interruptStaleJobs(), 1);
  assert.equal(agentState(store).live?.some((x) => x.jobId === job.id), false);
});

test("a word written is not a change to the library: a long answer moves the change counter no more than a short one", async () => {
  const bumps = async (words) => {
    const f = await fake(() => answer(Array.from({ length: words }, (_, i) => `word${i}`).join(" ")), { gap: 2 });
    const before = store.rev();
    await ended(startAgentJob(store, { projectId: project.id, patternId: story.id, prompt: "say something", apiKey: "k", baseUrl: f.baseUrl }).id);
    f.close();
    return store.rev() - before;
  };
  assert.equal(await bumps(80), await bumps(3));
});
