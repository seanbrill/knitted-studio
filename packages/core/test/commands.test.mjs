import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand } from "../src/commands.ts";

const base = () => ({
  id: "pt_1", projectId: "pj_1", name: "Launch", size: { name: "Story", w: 1080, h: 1920 }, durationMs: 0, version: 1, updatedAt: "",
  stitches: [
    { id: "a", kind: "text", slot: "headline", x: 0.1, y: 0.1, w: 0.5, h: 0.1, locked: false, content: "Hello" },
    { id: "b", kind: "text", slot: "eyebrow", x: 0.1, y: 0.3, w: 0.5, h: 0.1, locked: true, content: "NEW" },
    { id: "c", kind: "image", slot: "logo", x: 0.1, y: 0.9, w: 0.2, h: 0.05, locked: true },
  ],
});

// ── The rule the product is built on ───────────────────────────────────────
const LOCKED_CMDS = [
  ["updateStitch", { type: "updateStitch", id: "b", patch: { content: "X" } }],
  ["removeStitch", { type: "removeStitch", id: "b" }],
  ["reorder", { type: "reorder", id: "b", toIndex: 0 }],
  ["fillSlot", { type: "fillSlot", slot: "eyebrow", content: "X" }],
  ["setLocked", { type: "setLocked", id: "b", locked: false }],
];

for (const actor of ["model", "fill", "import"]) {
  for (const [name, cmd] of LOCKED_CMDS) {
    test(`${actor} cannot ${name} a locked stitch, and is told so`, () => {
      const p = base();
      const r = applyCommand(p, cmd, actor);
      assert.equal(r.changed, false);
      assert.deepEqual(r.pattern, p, "the pattern must be untouched");
      assert.equal(r.refusals.length, 1, "refused, never silently skipped");
      assert.ok(r.refusals[0].why.length > 10);
    });
  }
  test(`${actor} CAN change a free stitch`, () => {
    const r = applyCommand(base(), { type: "fillSlot", slot: "headline", content: "New" }, actor);
    assert.equal(r.changed, true);
    assert.equal(r.pattern.stitches[0].content, "New");
    assert.deepEqual(r.refusals, []);
  });
  test(`${actor} cannot lock or unlock even a free stitch`, () => {
    const r = applyCommand(base(), { type: "setLocked", id: "a", locked: true }, actor);
    assert.equal(r.changed, false);
    assert.equal(r.refusals.length, 1);
    const r2 = applyCommand(base(), { type: "updateStitch", id: "a", patch: { locked: true } }, actor);
    assert.equal(r2.changed, false, "locking through a patch is the same thing and must be refused too");
  });
}

test("a person in Pattern mode (human) is the brand owner and may change locked stitches", () => {
  for (const [, cmd] of LOCKED_CMDS) assert.equal(applyCommand(base(), cmd, "human").changed, true);
});

test("a model cannot reach a locked stitch by rewriting it inside a batch", () => {
  const r = applyCommand(base(), { type: "batch", commands: [
    { type: "fillSlot", slot: "headline", content: "ok" },
    { type: "fillSlot", slot: "eyebrow", content: "sneaky" },
  ] }, "model");
  assert.equal(r.pattern.stitches[0].content, "ok");
  assert.equal(r.pattern.stitches[1].content, "NEW");
  assert.equal(r.refusals.length, 1);
});

test("an atomic batch applies all or nothing", () => {
  const p = base();
  const r = applyCommand(p, { type: "batch", atomic: true, commands: [
    { type: "fillSlot", slot: "headline", content: "ok" },
    { type: "fillSlot", slot: "eyebrow", content: "sneaky" },
  ] }, "model");
  assert.deepEqual(r.pattern, p);
  assert.equal(r.changed, false);
  assert.equal(r.refusals.length, 1);
});

test("filling an image slot with text is refused with a useful reason", () => {
  const r = applyCommand(base(), { type: "fillSlot", slot: "logo", content: "x" }, "human");
  assert.match(r.refusals[0].why, /image slot/);
});

test("slots are addressed by NAME, so a relayout does not break a model", () => {
  const p = base();
  p.stitches = p.stitches.map((s) => ({ ...s, id: "new_" + s.id }));
  assert.equal(applyCommand(p, { type: "fillSlot", slot: "headline", content: "still works" }, "model").changed, true);
});

test("a duplicate slot name is refused: a slot is a promise, and two stitches cannot keep it", () => {
  const r = applyCommand(base(), { type: "addStitch", stitch: { id: "z", kind: "text", slot: "headline", x: 0, y: 0, w: 1, h: 1, locked: false } }, "human");
  assert.equal(r.changed, false);
});

test("no-op commands report no change and no inverse", () => {
  const r = applyCommand(base(), { type: "updateStitch", id: "a", patch: { content: "Hello" } }, "human");
  assert.equal(r.changed, false);
  assert.equal(r.inverse, null);
});

// ── Undo: every inverse really undoes ──────────────────────────────────────
function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }

test("applying random commands then their inverses in reverse restores the pattern exactly (fuzz)", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rand = rng(seed);
    const original = base();
    let cur = original;
    const inverses = [];
    for (let i = 0; i < 25; i++) {
      const pick = Math.floor(rand() * 7);
      const ids = cur.stitches.map((s) => s.id);
      const id = ids[Math.floor(rand() * ids.length)] ?? "a";
      const cmd = [
        { type: "updateStitch", id, patch: { x: Math.round(rand() * 100) / 100, content: "t" + i } },
        { type: "addStitch", stitch: { id: "n" + seed + "_" + i, kind: "shape", x: rand(), y: rand(), w: 0.1, h: 0.1, locked: false }, index: Math.floor(rand() * 4) },
        { type: "removeStitch", id },
        { type: "reorder", id, toIndex: Math.floor(rand() * 4) },
        { type: "setSize", size: { name: "Custom", w: 500 + i, h: 800 } },
        { type: "setMeta", name: "N" + i, durationMs: i * 100 },
        { type: "setLocked", id, locked: rand() > 0.5 },
      ][pick];
      const r = applyCommand(cur, cmd, "human");
      if (r.changed) { cur = r.pattern; inverses.unshift(r.inverse); }
    }
    for (const inv of inverses) {
      const r = applyCommand(cur, inv, "human");
      cur = r.pattern;
    }
    assert.deepEqual(cur, original, `seed ${seed} did not round-trip`);
  }
});

test("commands never mutate their input", () => {
  const p = base();
  const frozen = JSON.parse(JSON.stringify(p));
  applyCommand(p, { type: "batch", commands: [{ type: "updateStitch", id: "a", patch: { x: 0.9 } }, { type: "removeStitch", id: "c" }] }, "human");
  assert.deepEqual(p, frozen);
});
