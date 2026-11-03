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

test("the in-app model and an outside model get exactly the same tools", async () => {
  const { TOOLS } = await import("@knitted/mcp/context");
  assert.deepEqual(Object.keys(tools).sort(), TOOLS.map((t) => t.name).sort());
  const names = TOOLS.map((t) => t.name);
  for (const forbidden of [/delete/, /unlock/, /purge/, /remove_project/, /remove_yarn/]) assert.ok(!names.some((n) => forbidden.test(n)), `no tool matches ${forbidden}`);
});
