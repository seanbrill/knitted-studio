// The rule that protects brand consistency: a model cannot change a locked
// stitch. If this ever passes silently, the product's main promise is gone.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = await mkdtemp(join(tmpdir(), "knitted-"));
process.env.KNITTED_HOME = home;
const { tools } = await import("@knitted/mcp");

// Set up through the same store the studio uses, then talk to it only through
// the MCP tools, as a model would.
const { getStore } = await import("@knitted/core/node");
const store = getStore();
const project = store.createProject({ name: "Test" });
const pattern = store.createPattern(project.id, {
  name: "Story",
  size: { name: "Story", w: 1080, h: 1920 },
  stitches: [
    { id: "a", kind: "text", slot: "headline", x: 0, y: 0, w: 1, h: 0.1, locked: false, content: "old" },
    { id: "b", kind: "text", slot: "eyebrow", x: 0, y: 0.2, w: 1, h: 0.05, locked: true, content: "LOCKED" },
  ],
});
const ids = { projectId: project.id, patternId: pattern.id };
const saved = () => store.getPattern(pattern.id);

test("a free slot is filled", async () => {
  const r = await tools.fill_slots({
    ...ids, slots: { headline: "Make it knitted." },
  });
  assert.deepEqual(r.filled, ["headline"]);
  assert.equal(saved().stitches[0].content, "Make it knitted.");
});

test("a LOCKED slot is refused, and the pattern is unchanged", async () => {
  const r = await tools.fill_slots({
    ...ids, slots: { eyebrow: "SNEAKY" },
  });
  assert.deepEqual(r.filled, []);
  assert.equal(r.refused.length, 1);
  assert.match(r.refused[0].why, /locked/i);
  assert.equal(saved().stitches[1].content, "LOCKED", "a locked stitch must not change");
});

test("a refusal is REPORTED, never silent", async () => {
  // The failure this guards: a model that believes it wrote a headline and did
  // not is worse than one that is told no.
  const r = await tools.fill_slots({
    ...ids, slots: { nonesuch: "x", eyebrow: "y" },
  });
  assert.equal(r.refused.length, 2);
  assert.ok(r.refused.every((x) => typeof x.why === "string" && x.why.length > 0));
});

test("a mixed call fills what it can and refuses the rest", async () => {
  const r = await tools.fill_slots({
    ...ids, slots: { headline: "Second go", eyebrow: "no" },
  });
  assert.deepEqual(r.filled, ["headline"]);
  assert.equal(r.refused.length, 1);
});

test("slots are addressed by NAME, so a relayout does not break a model", async () => {
  const p = await tools.get_pattern(ids);
  assert.ok(p.stitches.every((s) => typeof s.slot === "string"),
    "every stitch a model may write needs a stable slot name");
});

test("list_projects reports ids and names, not directory names", async () => {
  const list = await tools.list_projects();
  assert.ok(list.some((p) => p.id === project.id && p.name === "Test"));
});

test("a model's refusal is in the audit trail, so a person can see what was attempted", async () => {
  await tools.fill_slots({ ...ids, slots: { eyebrow: "again" } });
  assert.ok(store.activity(project.id).some((a) => a.action === "edit.refused" && a.actor === "model"));
});

test("the model's edit and a person's edit are the same document", async () => {
  await tools.fill_slots({ ...ids, slots: { headline: "from the model" } });
  store.apply(pattern.id, { type: "updateStitch", id: "a", patch: { x: 0.25 } }, "human");
  const seen = await tools.get_pattern(ids);
  assert.equal(seen.stitches[0].content, "from the model");
  assert.equal(seen.stitches[0].x, 0.25, "the MCP side sees the human's change");
});

// ── The wire: what both doors (stdio and the studio's HTTP address) answer ──

const { answer, INSTRUCTIONS } = await import("@knitted/mcp/protocol");
const rpc = (method, params, id = 1) => answer({ jsonrpc: "2.0", id, method, params }, (name, args) => tools[name](args));

test("initialize answers in the client's own protocol version when it has it, and says where to start", async () => {
  for (const v of ["2025-06-18", "2025-03-26", "2024-11-05"]) assert.equal((await rpc("initialize", { protocolVersion: v })).result.protocolVersion, v);
  const r = (await rpc("initialize", { protocolVersion: "1999-01-01" })).result;
  assert.equal(r.protocolVersion, "2025-06-18", "a version it does not know gets the newest it does");
  assert.equal(r.serverInfo.name, "knitted-studio");
  assert.equal(r.instructions, INSTRUCTIONS);
  assert.match(r.instructions, /list_projects/);
  assert.match(r.instructions, /locked/);
});

test("tools/list is every tool, and a call's failure is a result the model can read, not a protocol error", async () => {
  assert.deepEqual((await rpc("tools/list")).result.tools.map((t) => t.name), (await import("@knitted/mcp/context")).TOOLS.map((t) => t.name));
  const ok = (await rpc("tools/call", { name: "list_projects", arguments: {} })).result;
  assert.ok(JSON.parse(ok.content[0].text).some((p) => p.id === project.id));
  const bad = (await rpc("tools/call", { name: "describe_pattern", arguments: {} })).result;
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /needs patternId/);
});

test("notifications get no reply, ping gets an empty one, and an unknown method is reported as one", async () => {
  assert.equal(await answer({ jsonrpc: "2.0", method: "notifications/initialized" }, () => {}), null);
  assert.equal(await answer({ jsonrpc: "2.0", id: 7, result: {} }, () => {}), null, "a reply from the client needs no reply");
  assert.deepEqual((await rpc("ping", undefined, 9)), { jsonrpc: "2.0", id: 9, result: {} });
  assert.equal((await rpc("resources/list")).error.code, -32601);
});

test("set_project_picture shows one of the project's images on its card, and nothing else", async () => {
  await assert.rejects(tools.set_project_picture({ projectId: project.id, yarnId: "yn_nonesuch" }), /not in this project/);
  const r = await tools.set_project_picture({ projectId: project.id });
  assert.equal(r.picture, null, "no yarnId takes the picture away");
});

test("the site lists every tool as the server describes it (run `npm run mcp:tools` when this fails)", async () => {
  const { readFile } = await import("node:fs/promises");
  const { CATALOG, text } = await import("../scripts/mcp-tools.mjs");
  const { TOOLS } = await import("@knitted/mcp/context");
  assert.equal(await readFile(CATALOG, "utf8"), text(TOOLS));
});

test("the in-app model and an outside model get exactly the same tools", async () => {
  const { TOOLS } = await import("@knitted/mcp/context");
  assert.deepEqual(Object.keys(tools).sort(), TOOLS.map((t) => t.name).sort());
  const names = TOOLS.map((t) => t.name);
  for (const forbidden of [/delete/, /unlock/, /purge/, /remove_project/, /remove_yarn/]) assert.ok(!names.some((n) => forbidden.test(n)), `no tool matches ${forbidden}`);
});
