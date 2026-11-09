// The claims check: a pattern's words read beside the Brief by the person's model. Never a real
// request: every call here passes a key that is not one and answers it with a fake fetch.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, saveProfile, setBriefNotes } from "@knitted/core/node";
import { AgentError } from "../src/index.mjs";
import { CLAIMS_SCHEMA, CLAIMS_SYSTEM, checkClaims, readClaims } from "../src/claims.mjs";

const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-claims-")), "k.db"));
const project = store.createProject({ name: "Notch" });
saveProfile(store, project.id, "# What they offer\nNotch plays your music library and works with Apple Music.\n\n# Available now, and what is not yet\nSpotify is in early access, by invitation. Ratings sync is planned.");
const text = (id, slot, content, more = {}) => ({ id, kind: "text", slot, x: 0.1, y: 0.1, w: 0.8, h: 0.2, locked: false, content, ...more });
const pattern = store.createPattern(project.id, { name: "Launch", stitches: [
  text("t1", "headline", "Works with Apple Music and Spotify"),
  text("t2", "body", "Only $49 a year. Your ratings sync back to your library."),
  text("t3", undefined, "A draft line", { style: { hidden: true } }),
] });

const answer = (o) => async (url, init) => {
  answer.calls = (answer.calls ?? 0) + 1;
  answer.last = { url, body: JSON.parse(init.body) };
  return new Response(JSON.stringify({ model: "claude-sonnet-5-5", stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 300 }, content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o) }] }), { status: 200 });
};
const opts = (fetchImpl) => ({ apiKey: "sk-test-not-real", baseUrl: "http://127.0.0.1:9", fetchImpl });
const claim = (quote, verdict, more = {}) => ({ quote, verdict, brief: "", why: "", fix: null, ...more });

test("the model reads the post's words beside the Brief, and each claim it answers is found on the pattern", async () => {
  const fetchImpl = answer({ claims: [
    claim("Your ratings sync back to your library", "notyet", { brief: "Ratings sync is planned.", why: "The Brief says it is planned.", fix: "Your likes go back to your library" }),
    claim("Works with Apple Music", "backed", { brief: "works with Apple Music", fix: "should be let go" }),
    claim("Works with Apple Music and Spotify", "against", { brief: "Spotify is in early access, by invitation.", why: "Spotify is by invitation.", fix: "Works with Apple Music. Spotify, by invitation" }),
    claim("$49 a year", "missing", { why: "The Brief gives no yearly price." }),
    claim("Free forever", "missing", { why: "Not on this post at all" }),
    claim("Works with Apple Music and Spotify", "against", { why: "Twice" }),
    claim("Music that moves you", "maybe"),
  ] });
  const r = await checkClaims(store, pattern.id, opts(fetchImpl));
  assert.deepEqual(r.claims.map((c) => [c.verdict, c.quote]), [
    ["against", "Works with Apple Music and Spotify"],
    ["notyet", "Your ratings sync back to your library"],
    ["missing", "$49 a year"],
    ["backed", "Works with Apple Music"],
  ], "against first, then not yet, not in the Brief and backed; each once, and only what is on the post");
  const [against, notyet, missing, backed] = r.claims;
  assert.deepEqual([against.stitchId, against.replaceable, against.fix], ["t1", true, "Works with Apple Music. Spotify, by invitation"]);
  assert.deepEqual([notyet.stitchId, notyet.replaceable], ["t2", true]);
  assert.deepEqual([missing.stitchId, missing.fix, missing.replaceable], ["t2", null, false], "nothing true to say in its place");
  assert.equal(backed.fix, null, "a backed claim has nothing to change");
  assert.deepEqual(r.words, { t1: "Works with Apple Music and Spotify", t2: "Only $49 a year. Your ratings sync back to your library." }, "the words checked, a hidden text not among them");
  assert.equal(r.patternId, pattern.id);

  const sent = answer.last.body;
  assert.equal(sent.system, CLAIMS_SYSTEM);
  assert.deepEqual(sent.output_config.format.schema, CLAIMS_SCHEMA);
  assert.equal(sent.model, "claude-sonnet-5-5");
  assert.match(sent.messages[0].content, /Spotify is in early access, by invitation/);
  assert.match(sent.messages[0].content, /\[headline\] "Works with Apple Music and Spotify"/);
  assert.doesNotMatch(sent.messages[0].content, /A draft line/, "a hidden text is not knitted, so not checked");
  assert.match(sent.messages[0].content, /<untrusted_data source="The post's texts/);
  const spent = store.db.prepare("select kind, input, project_id as projectId from usage where kind = 'claims'").all();
  assert.deepEqual(spent.map((r) => ({ ...r })), [{ kind: "claims", input: 900, projectId: project.id }], "counted with the rest of what the key spends");
});

test("the person's notes are part of the Brief, and Auto checks with the all-round model", async () => {
  setBriefNotes(store, project.id, "Prices: $49 a year, from December.");
  const fetchImpl = answer({ claims: [] });
  const r = await checkClaims(store, pattern.id, { ...opts(fetchImpl), model: "auto" });
  assert.deepEqual(r.claims, []);
  assert.match(answer.last.body.messages[0].content, /the person's own notes[\s\S]*\$49 a year, from December/);
  assert.equal(answer.last.body.model, "claude-sonnet-5-5");
  setBriefNotes(store, project.id, "");
});

test("a fix is offered to put in place only where the quote is once, as it is", () => {
  const words = { a: "Plays every song. Plays every song, anywhere.", b: "“The best player”, says Wired" };
  const read = readClaims(JSON.stringify({ claims: [
    claim("Plays every song", "against", { fix: "Plays your songs" }),
    claim("plays EVERY song", "against", { fix: "Plays your songs" }),
    claim("\"The best player\", says Wired", "missing"),
    claim("\u201cPlays every song, anywhere.\u201d", "missing"),
  ] }), words);
  assert.equal(read.length, 3, "the same claim, copied loosely, is the one before");
  const [twice, curly, wrapped] = read;
  assert.deepEqual([twice.stitchId, twice.replaceable], ["a", false], "in it twice: which one is meant is not known");
  assert.equal(wrapped.quote, "Plays every song, anywhere.", "quote marks round the whole of it are let go");
  assert.deepEqual([curly.stitchId, curly.replaceable], ["b", false], "found with its quote marks let go, to show; not to replace");
  assert.throws(() => readClaims("I cannot help with that.", words), AgentError);
});

test("no key says where to add one, an empty Brief says so, and a pattern with no words asks nothing", async () => {
  await assert.rejects(checkClaims(store, pattern.id, { apiKey: null, fetchImpl: answer({ claims: [] }) }), /Add your Anthropic key in Settings/);
  const empty = store.createProject({ name: "Blank" });
  const p = store.createPattern(empty.id, { name: "Hello", stitches: [text("t1", "headline", "Hello")] });
  await assert.rejects(checkClaims(store, p.id, opts(answer({ claims: [] }))), (e) => e instanceof AgentError && e.kind === "nobrief");
  saveProfile(store, empty.id, "# What they offer\nNothing yet.");
  const quiet = store.createPattern(empty.id, { name: "Picture only", stitches: [{ id: "s", kind: "shape", x: 0, y: 0, w: 1, h: 1, locked: false }] });
  answer.calls = 0;
  const r = await checkClaims(store, quiet.id, opts(answer({ claims: [] })));
  assert.deepEqual([r.claims, answer.calls], [[], 0]);
});
