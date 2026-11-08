// Auto: the least model a task needs, stepping up part way when it must, never down; and a
// pick the person makes while a run goes is taken at its next step.

import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "@knitted/core/node";
import { CHOICES, DEFAULT_CHOICE, runAgent, startAgentJob, startChat } from "../src/index.mjs";
import { AUTO, concrete, fits, LADDER, pickModel, stepUp } from "../src/auto.mjs";

const [HAIKU, SONNET, OPUS] = LADDER;

test("a message starts on the least model that fits what the person asked", () => {
  assert.equal(fits("make the headline shorter").model, HAIKU);
  assert.equal(fits("Rename this to Spring sale").model, HAIKU);
  assert.equal(fits("design a landing page for our app").model, OPUS);
  assert.equal(fits("animate the logo coming in").model, OPUS);
  assert.equal(fits("write three posts about our new menu in our voice and knit them").model, SONNET);
  // An Ask dialog says what the thing is first: it is the person's own words that are judged...
  const context = `This is about the pattern "Website video" (pt_1). Look at it with preview_pattern before you change it, keep to what the brand locked, and check it with check_pattern when you are done.`;
  assert.equal(fits(`${context}\n\nWhat I want: make the headline shorter`).model, HAIKU);
  // ...unless the thing is a design, which wants the model best at layout.
  assert.equal(fits(`This is about the design sheet "Site" (ds_1). Read get_guide designing first.\n\nWhat I want: fix the spacing`).model, OPUS);
  assert.match(fits("make the headline shorter").why, /quick change/);
});

test("between messages it steps down, unless the chat is long and still in the model's cache", () => {
  const now = 1_000_000_000;
  const long = { model: OPUS, context: 60_000, at: now - 60_000 };
  // Opus for a long chat answered a minute ago: reading it again on Sonnet costs more than Sonnet saves.
  const kept = pickModel({ prompt: "write a new caption for the summer post", last: long, now });
  assert.equal(kept.model, OPUS);
  assert.match(kept.why, /cache/);
  // The same chat after the cache has gone: down to Sonnet.
  assert.equal(pickModel({ prompt: "write a new caption for the summer post", last: { ...long, at: now - 20 * 60_000 }, now }).model, SONNET);
  // A short chat: down, as there is little to read again.
  assert.equal(pickModel({ prompt: "write a new caption for the summer post", last: { ...long, context: 4000 }, now }).model, SONNET);
  // Haiku is cheap enough to read anything again.
  assert.equal(pickModel({ prompt: "make it shorter", last: long, now }).model, HAIKU);
  // Needing more than the chat was on: up, always.
  assert.equal(pickModel({ prompt: "redesign the whole site", last: { model: HAIKU, context: 90_000, at: now }, now }).model, OPUS);
  // A chat on a model Auto does not pick (one the person chose): what the message needs.
  assert.equal(pickModel({ prompt: "make it shorter", last: { model: "claude-fable-5-1", context: 90_000, at: now }, now }).model, HAIKU);
});

test("part way, it steps up after failed steps or a long task, and never past the top", () => {
  assert.deepEqual(stepUp(HAIKU, { failed: 1, steps: 3 }), null);
  assert.equal(stepUp(HAIKU, { failed: 2, steps: 3 }).model, SONNET);
  assert.match(stepUp(HAIKU, { failed: 2, steps: 3 }).why, /2 steps failed on Claude Haiku 5\.5/);
  assert.equal(stepUp(HAIKU, { failed: 0, steps: 8 }).model, SONNET);
  assert.equal(stepUp(SONNET, { failed: 0, steps: 16 }).model, OPUS);
  assert.equal(stepUp(OPUS, { failed: 9, steps: 40 }), null);
  assert.equal(stepUp("claude-fable-5-1", { failed: 9, steps: 40 }), null);
});

test("Auto is a choice, the default for a new setup, and a one-request task gets a model for it", () => {
  assert.equal(DEFAULT_CHOICE, AUTO);
  assert.equal(CHOICES[0].id, AUTO);
  assert.equal(concrete(AUTO, SONNET), SONNET);
  assert.equal(concrete(undefined, SONNET), SONNET);
  assert.equal(concrete(OPUS, SONNET), OPUS);
});

// ── the run itself, against a fake API ──

const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-auto-")), "k.db"));
const project = store.createProject({ name: "Auto", starter: "social" });
const pattern = store.listPatterns(project.id)[0];

function fake(script) {
  const seen = [];
  const server = createServer(async (req, res) => {
    let b = ""; for await (const c of req) b += c;
    seen.push(JSON.parse(b));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(script(seen.length)));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ baseUrl: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() })));
}
const usage = { input_tokens: 100, output_tokens: 20 };
const thinking = (n) => ({ type: "thinking", thinking: `Step ${n}.`, signature: `sig${n}` });
const failing = (n) => ({ content: [thinking(n), { type: "tool_use", id: `t${n}`, name: "fill_slots", input: { projectId: project.id, patternId: "pt_not_there", slots: { headline: "x" } } }], stop_reason: "tool_use", usage });
const done = { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", usage };

test("in Auto a quick change starts on Haiku, and two failed steps take it up to Sonnet with its thinking kept", async () => {
  const f = await fake((n) => (n <= 2 ? failing(n) : done));
  const events = [];
  const r = await runAgent({ store, projectId: project.id, patternId: pattern.id, prompt: "make the headline shorter", apiKey: "k", baseUrl: f.baseUrl, model: AUTO, onEvent: (e) => events.push(e) });
  f.close();
  assert.deepEqual(f.seen.map((b) => b.model), [HAIKU, HAIKU, SONNET]);
  assert.deepEqual(r.models, [HAIKU, SONNET]);
  assert.equal(r.model, SONNET);
  const said = events.filter((e) => e.type === "model");
  assert.equal(said[0].model, HAIKU);
  assert.match(said[0].why, /quick change/);
  assert.equal(said[1].switched, true);
  assert.match(said[1].why, /2 steps failed/);
  // The thinking from before the step up goes with it, as it was: Sonnet 5.5 reads Haiku 5.5's.
  const sent = f.seen[2].messages.filter((m) => m.role === "assistant").flatMap((m) => m.content).filter((b) => b.type === "thinking");
  assert.deepEqual(sent.map((b) => b.signature), ["sig1", "sig2"]);
  assert.ok(r.context > 0, "how much the last request held, for the next message's pick");
});

test("a pick the person makes while it runs is taken at the next step, even downward", async () => {
  const f = await fake((n) => (n === 1 ? failing(1) : done));
  let pick;
  const events = [];
  await runAgent({ store, projectId: project.id, patternId: pattern.id, prompt: "redesign the layout", apiKey: "k", baseUrl: f.baseUrl, model: OPUS,
    choose: () => pick, onEvent: (e) => { events.push(e); if (e.type === "tool_call") pick = HAIKU; } });
  f.close();
  assert.deepEqual(f.seen.map((b) => b.model), [OPUS, HAIKU]);
  const switched = events.find((e) => e.type === "model" && e.switched);
  assert.match(switched.why, /you picked it/);
});

test("with one model picked, it stays on it however the steps go", async () => {
  const f = await fake((n) => (n <= 3 ? failing(n) : done));
  await runAgent({ store, projectId: project.id, patternId: pattern.id, prompt: "make the headline shorter", apiKey: "k", baseUrl: f.baseUrl, model: SONNET });
  f.close();
  assert.deepEqual([...new Set(f.seen.map((b) => b.model))], [SONNET]);
});

const ended = async (id) => {
  for (let i = 0; i < 200; i++) { const j = store.getJob(id); if (!["queued", "running"].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error("still running");
};

test("in a chat, the next message's pick knows the model the last answer was on, and how long the chat is", async () => {
  // A long conversation on Opus, so its next message stays on Opus while the cache holds.
  const big = { input_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 58_000, output_tokens: 300 };
  const f = await fake(() => ({ content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", usage: big }));
  const chat = startChat(store, { projectId: project.id, prompt: "redesign the layout" });
  const one = await ended(startAgentJob(store, { chatId: chat.id, prompt: "redesign the layout", apiKey: "k", baseUrl: f.baseUrl, model: AUTO }).id);
  assert.equal(one.result.model, OPUS);
  assert.equal(one.result.context, 60_000);
  const two = await ended(startAgentJob(store, { chatId: chat.id, prompt: "write a new caption for the summer post", apiKey: "k", baseUrl: f.baseUrl, model: AUTO }).id);
  f.close();
  assert.deepEqual(f.seen.map((b) => b.model), [OPUS, OPUS]);
  assert.match(two.progress.events.find((e) => e.type === "model").why, /cache/);
});

test("a pick made in Settings while a chat's run goes is taken at its next step", async () => {
  store.setSetting("model", { model: AUTO, maxTurns: 25, maxKnits: 24 });
  const f = await fake((n) => {
    if (n === 1) store.setSetting("model", { model: OPUS, maxTurns: 25, maxKnits: 24 });
    return n === 1 ? failing(1) : done;
  });
  const chat = startChat(store, { projectId: project.id, prompt: "make the headline shorter" });
  await ended(startAgentJob(store, { chatId: chat.id, prompt: "make the headline shorter", apiKey: "k", baseUrl: f.baseUrl, model: AUTO }).id);
  f.close();
  assert.deepEqual(f.seen.map((b) => b.model), [HAIKU, OPUS]);
});
