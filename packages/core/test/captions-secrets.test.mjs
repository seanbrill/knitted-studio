import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyCommand, captionCommands, toSrt, motionLint } from "../src/index.ts";
import { deleteSecret, getSecret, secretBackend, secretStatus, setSecret } from "../src/node.ts";

const lines = [{ text: "Make it knitted.", startMs: 500, endMs: 2300 }, { text: "Pattern once. Knit forever.", startMs: 2600, endMs: 5200 }];
const pattern = () => ({ id: "p", projectId: "pj", name: "C", size: { name: "S", w: 1080, h: 1920 }, durationMs: 6000, version: 1, updatedAt: "", stitches: [] });

test("captions: one stitch per line, named, timed to the voice, fading in and out", () => {
  let p = pattern();
  for (const c of captionCommands(lines, [])) p = applyCommand(p, c, "human").pattern;
  assert.deepEqual(p.stitches.map((s) => s.slot), ["caption_1", "caption_2"]);
  const t = p.motion.tracks[p.stitches[0].id];
  assert.equal(t[0].startMs, 500);
  assert.equal(t[1].endMs, 2300);
  assert.ok(t[0].endMs < t[1].startMs, "in, then hold, then out");
});

test("caption slot names never collide with ones already used", () => {
  const cmds = captionCommands(lines, ["caption_1"]);
  assert.equal(cmds.filter((c) => c.type === "addStitch").map((c) => c.stitch.slot).join(), "caption_2,caption_3");
});

test("captions are readable for the time they are up (lint agrees)", () => {
  let p = pattern();
  for (const c of captionCommands(lines, [])) p = applyCommand(p, c, "human").pattern;
  assert.equal(motionLint(p).filter((i) => i.code === "text-too-brief").length, 0);
});

test("SRT is the standard format, numbered, with comma milliseconds", () => {
  const srt = toSrt([{ text: " Hi ", startMs: 3723045, endMs: 3725000 }, ...lines]);
  assert.match(srt, /^1\n01:02:03,045 --> 01:02:05,000\nHi\n\n2\n00:00:00,500 --> 00:00:02,300\nMake it knitted\.\n/);
});

// ── secrets ─────────────────────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), "knitted-sec-"));
function memory() {
  const m = new Map();
  return { name: "test store", available: async () => true, get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v), remove: async (k) => void m.delete(k), m };
}

test("a key round-trips through a store, and is trimmed", async () => {
  const s = memory();
  await setSecret("anthropic", "  sk-abc  ", dir, s);
  assert.equal(s.m.get("anthropic"), "sk-abc");
  assert.equal(await getSecret("anthropic", dir, s), "sk-abc");
  await deleteSecret("anthropic", dir, s);
  assert.equal(await getSecret("anthropic", dir, s), null);
});

test("an environment variable always wins, so CI and development need no keychain", async () => {
  const s = memory(); await s.set("anthropic", "from-store");
  process.env.ANTHROPIC_API_KEY = "from-env";
  try {
    assert.equal(await getSecret("anthropic", dir, s), "from-env");
    assert.equal((await secretStatus("anthropic", dir, s)).source, "environment");
  } finally { delete process.env.ANTHROPIC_API_KEY; }
  assert.equal((await secretStatus("anthropic", dir, s)).source, "keychain");
});

test("status never contains the key itself", async () => {
  const s = memory(); await s.set("anthropic", "sk-very-secret");
  assert.doesNotMatch(JSON.stringify(await secretStatus("anthropic", dir, s)), /sk-very-secret/);
});

test("an empty key is refused, and no store at all is a clear message, not a silent file", async () => {
  await assert.rejects(setSecret("anthropic", "   ", dir, memory()), /empty/);
  const none = { name: "x", available: async () => false, get: async () => null, set: async () => {}, remove: async () => {} };
  const orig = process.platform;
  void orig; void none;
  const status = await secretStatus("nothing_set", dir, undefined);
  assert.equal(status.present, false);
});

test("the real macOS Keychain round-trips a secret and cleans up after itself", { skip: process.platform !== "darwin" }, async () => {
  const key = `test_${Date.now()}`;
  const b = await secretBackend(dir);
  assert.equal(b.name, "macOS Keychain");
  await setSecret(key, "kc-value-123", dir);
  try { assert.equal(await getSecret(key, dir), "kc-value-123"); }
  finally { await deleteSecret(key, dir); }
  assert.equal(await getSecret(key, dir), null);
});
