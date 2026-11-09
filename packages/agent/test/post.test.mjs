// A knit's caption, hashtags and track, written by the person's model. Never a real request:
// every call here passes a key that is not one and answers it with a fake fetch.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCopy, importYarn, insertKnit, openStore, saveProfile, setKnitPost, uploadTempPath } from "@knitted/core/node";
import { AgentError } from "../src/index.mjs";
import { POST_SCHEMA, POST_SYSTEM, readPost, writePost } from "../src/post.mjs";

const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-post-")), "k.db"));
const project = store.createProject({ name: "Hollow Oak" });
saveProfile(store, project.id, "# Name\nHollow Oak Bakery\n\n# How they sound\nWarm, plain.");
const knit = insertKnit(store, { projectId: project.id, patternId: null, patternName: "Launch", jobId: null, batchId: null, label: "Launch banner", file: "x.png", kind: "image", format: "png", width: 1080, height: 1080, bytes: 1, durationMs: null, hash: "h", report: {} });

// A short WAV, so the project has one track to choose from.
function wav() {
  const n = 800, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const tmp = uploadTempPath(store, project.id); mkdirSync(dirname(tmp), { recursive: true }); writeFileSync(tmp, wav());
const track = (await importYarn(store, project.id, tmp, "Morning.wav")).yarn;
await createCopy(store, project.id, { name: "Tag", text: "#hollowoak" });

const answer = (text) => async (url, init) => { answer.last = { url, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text }] }), { status: 200 }); };

test("the model writes a caption, hashtags and a track from the project's music, and it is kept on the knit", async () => {
  const fetchImpl = answer(`Here: {"caption": "Fresh from the oven.", "hashtags": ["sourdough", "#Bakery", "#bakery", "#hollow oak"], "audio": {"id": "${track.id}", "why": "Calm, like a morning"}}`);
  const k = await writePost(store, knit.id, { apiKey: "sk-test-not-real", baseUrl: "http://127.0.0.1:9", fetchImpl });
  assert.equal(k.post.caption, "Fresh from the oven.");
  assert.deepEqual(k.post.hashtags, ["#sourdough", "#Bakery", "#hollowoak"], "each once, with its #, no spaces");
  assert.deepEqual([k.post.audioId, k.post.by], [track.id, "model"]);
  const sent = answer.last.body;
  assert.equal(sent.system, POST_SYSTEM);
  const prompt = typeof sent.messages[0].content === "string" ? sent.messages[0].content : sent.messages[0].content.at(-1).text;
  assert.match(prompt, /Hollow Oak Bakery/);
  assert.match(prompt, new RegExp(track.id), "the track is offered by its id");
  assert.match(prompt, /#hollowoak/, "the words the business saved go too");
  assert.match(prompt, /Write it\.$/);
});

test("writing again sends what it has, and what the person asked to change", async () => {
  const fetchImpl = answer(`{"caption": "Saturday's loaves are in.", "hashtags": ["#saturday"], "audio": null}`);
  const k = await writePost(store, knit.id, { ask: "mention Saturday", apiKey: "sk-test-not-real", baseUrl: "http://127.0.0.1:9", fetchImpl });
  const prompt = answer.last.body.messages[0].content;
  assert.match(typeof prompt === "string" ? prompt : prompt.at(-1).text, /Fresh from the oven\.[\s\S]*The person asks: mention Saturday/);
  assert.deepEqual([k.post.caption, k.post.audioId, k.post.ask], ["Saturday's loaves are in.", null, "mention Saturday"]);
});

test("a track not on the list is let go, an answer with no caption is an error, and no key says where to add one", async () => {
  assert.equal(readPost(`{"caption": "Hi", "audio": {"id": "yn_made_up", "why": "x"}}`, []).audioId, null);
  assert.throws(() => readPost("I cannot help with that.", []), AgentError);
  await assert.rejects(writePost(store, knit.id, { apiKey: null, fetchImpl: answer("{}") }), /Add your Anthropic key/);
  const k = setKnitPost(store, knit.id, { caption: "My own words", by: "human" });
  assert.deepEqual([k.post.caption, k.post.by, k.post.hashtags], ["My own words", "human", ["#saturday"]], "the person's change keeps the rest");
});

test("it is asked for by schema, with room to think first, and streamed", async () => {
  const fetchImpl = answer(`{"caption": "Warm bread, Saturday.", "hashtags": ["#bread"], "audio": null}`);
  await writePost(store, knit.id, { apiKey: "sk-test-not-real", baseUrl: "http://127.0.0.1:9", fetchImpl });
  const sent = answer.last.body;
  assert.equal(sent.stream, true);
  assert.ok(sent.max_tokens >= 16000, "the models think before they write, and the thinking counts");
  assert.deepEqual(sent.output_config.format, { type: "json_schema", schema: POST_SCHEMA });
  assert.equal(POST_SCHEMA.additionalProperties, false);
});

test("an answer cut off at the longest it may be says so, instead of that it could not be read", async () => {
  const cut = async () => new Response(JSON.stringify({ stop_reason: "max_tokens", content: [{ type: "text", text: `{"caption": "Once upon a ti` }] }), { status: 200 });
  await assert.rejects(writePost(store, knit.id, { ask: "longer, for LinkedIn", apiKey: "sk-test-not-real", baseUrl: "http://127.0.0.1:9", fetchImpl: cut }), /cut off/);
});

test("an address that turns the schema down is asked plainly, and plainly from then on", async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    const b = JSON.parse(init.body); bodies.push(b);
    if (b.output_config) return new Response(JSON.stringify({ error: { message: "output_config: Extra inputs are not permitted" } }), { status: 400 });
    return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: `{"caption": "Plain.\nTwo lines.", "hashtags": [], "audio": null}` }] }), { status: 200 });
  };
  const k = await writePost(store, knit.id, { apiKey: "sk-test-not-real", baseUrl: "http://127.0.0.1:8", fetchImpl });
  assert.equal(k.post.caption, "Plain.\nTwo lines.", "a raw line break inside the JSON is read");
  assert.deepEqual(bodies.map((b) => !!b.output_config), [true, false]);
  await writePost(store, knit.id, { apiKey: "sk-test-not-real", baseUrl: "http://127.0.0.1:8", fetchImpl });
  assert.deepEqual(bodies.map((b) => !!b.output_config), [true, false, false]);
});
