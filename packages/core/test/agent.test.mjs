// What a model is doing, kept where every window and both MCP doors can read it. A call
// starts and ends, the person can pause it, and a call whose process died does not read
// as working forever.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentBegin, agentEnd, agentRev, agentState, openStore, setAgentPaused } from "../src/node.ts";

const file = () => join(mkdtempSync(join(tmpdir(), "knitted-agent-")), "k.db");
const call = (summary = "Filling headline on Story") => ({ client: "Claude Code", tool: "fill_slots", summary, edits: true, where: { projectId: "pj", patternId: "pt", stitchIds: ["a"] } });

test("a call is working until it says how it ended, and what it made is added to where it worked", () => {
  const store = openStore(file());
  const rev = agentRev(store);
  const id = agentBegin(store, call());
  assert.equal(agentRev(store), rev + 1, "a start is news for the change stream");
  let [c] = agentState(store).calls;
  assert.equal(c.state, "running");
  assert.equal(c.summary, "Filling headline on Story");
  assert.equal(c.endedAt, undefined);
  agentEnd(store, id, { state: "refused", note: "x".repeat(500), where: { stitchIds: ["a", "b"] } });
  [c] = agentState(store).calls;
  assert.equal(c.state, "refused");
  assert.equal(c.note.length, 300, "a long reason is cut, not dropped");
  assert.deepEqual(c.where, { projectId: "pj", patternId: "pt", stitchIds: ["a", "b"] });
  assert.ok(Date.parse(c.endedAt) >= Date.parse(c.startedAt));
  assert.equal(agentRev(store), rev + 2);
});

test("watching a model is not a change to the library, so open windows do not refetch for it", () => {
  const store = openStore(file());
  const rev = store.rev();
  agentEnd(store, agentBegin(store, call()), { state: "done" });
  setAgentPaused(store, true);
  assert.equal(store.rev(), rev);
});

test("only the newest calls are kept", () => {
  const store = openStore(file());
  for (let i = 0; i < 40; i++) agentBegin(store, call(`call ${i}`));
  const { calls } = agentState(store);
  assert.equal(calls.length, 30);
  assert.equal(calls[0].summary, "call 10");
  assert.equal(calls.at(-1).summary, "call 39");
});

test("a pause is kept in the library, so the stdio server's own process sees it too", () => {
  const f = file();
  const studio = openStore(f), stdio = openStore(f);
  assert.equal(agentState(stdio).paused, false);
  assert.equal(setAgentPaused(studio, true).paused, true);
  assert.equal(agentState(stdio).paused, true);
  setAgentPaused(studio, false);
  assert.equal(agentState(stdio).paused, false);
});

test("a call whose process stopped without ending it reads as failed, not as working forever", () => {
  const store = openStore(file());
  agentBegin(store, call());
  const [c] = agentState(store).calls;
  const long = new Date(Date.now() - 16 * 60_000).toISOString();
  store.db.prepare("update meta set value = ? where key = 'agent.calls'").run(JSON.stringify([{ ...c, startedAt: long }]));
  const [d] = agentState(store).calls;
  assert.equal(d.state, "failed");
  assert.match(d.note, /stopped without saying how it went/);
});
