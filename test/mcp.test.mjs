// The rule that protects brand consistency: a model cannot change a locked
// stitch. If this ever passes silently, the product's main promise is gone.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = await mkdtemp(join(tmpdir(), "knitted-"));
process.env.KNITTED_HOME = home;
const { tools } = await import("../mcp/server.mjs");

const PROJECT = {
  id: "pj_test",
  name: "Test",
  patterns: [
    {
      id: "pt_1",
      size: { name: "Story", w: 1080, h: 1920 },
      durationMs: 0,
      stitches: [
        { id: "a", kind: "text", slot: "headline", x: 0, y: 0, w: 1, h: 0.1, locked: false, content: "old" },
        { id: "b", kind: "text", slot: "eyebrow", x: 0, y: 0.2, w: 1, h: 0.05, locked: true, content: "LOCKED" },
      ],
    },
  ],
};

await mkdir(join(home, "projects", "pj_test"), { recursive: true });
await writeFile(join(home, "projects", "pj_test", "project.json"), JSON.stringify(PROJECT), "utf8");

test("a free slot is filled", async () => {
  const r = await tools.fill_slots({
    projectId: "pj_test", patternId: "pt_1", slots: { headline: "Make it knitted." },
  });
  assert.deepEqual(r.filled, ["headline"]);
  const saved = JSON.parse(await readFile(join(home, "projects", "pj_test", "project.json"), "utf8"));
  assert.equal(saved.patterns[0].stitches[0].content, "Make it knitted.");
});

test("a LOCKED slot is refused, and the file is unchanged", async () => {
  const r = await tools.fill_slots({
    projectId: "pj_test", patternId: "pt_1", slots: { eyebrow: "SNEAKY" },
  });
  assert.deepEqual(r.filled, []);
  assert.equal(r.refused.length, 1);
  assert.match(r.refused[0].why, /locked/i);
  const saved = JSON.parse(await readFile(join(home, "projects", "pj_test", "project.json"), "utf8"));
  assert.equal(saved.patterns[0].stitches[1].content, "LOCKED", "a locked stitch must not change");
});

test("a refusal is REPORTED, never silent", async () => {
  // The failure this guards: a model that believes it wrote a headline and did
  // not is worse than one that is told no.
  const r = await tools.fill_slots({
    projectId: "pj_test", patternId: "pt_1", slots: { nonesuch: "x", eyebrow: "y" },
  });
  assert.equal(r.refused.length, 2);
  assert.ok(r.refused.every((x) => typeof x.why === "string" && x.why.length > 0));
});

test("a mixed call fills what it can and refuses the rest", async () => {
  const r = await tools.fill_slots({
    projectId: "pj_test", patternId: "pt_1", slots: { headline: "Second go", eyebrow: "no" },
  });
  assert.deepEqual(r.filled, ["headline"]);
  assert.equal(r.refused.length, 1);
});

test("slots are addressed by NAME, so a relayout does not break a model", async () => {
  const p = await tools.get_pattern({ projectId: "pj_test", patternId: "pt_1" });
  assert.ok(p.stitches.every((s) => typeof s.slot === "string"),
    "every stitch a model may write needs a stable slot name");
});
