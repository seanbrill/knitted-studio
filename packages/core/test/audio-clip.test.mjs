// A sound clip on the timeline: its loudness is gain, and a field it does not know is said, not dropped.
import assert from "node:assert/strict";
import test from "node:test";
import { AudioClipSchema } from "../src/schema.ts";

const clip = { id: "au_1", yarnId: "yn_1", startMs: 0, kind: "music" };

test("volume and level are taken as gain, a percent as a fraction, and gain wins when both are given", () => {
  assert.equal(AudioClipSchema.parse({ ...clip, volume: 0.3 }).gain, 0.3);
  assert.equal(AudioClipSchema.parse({ ...clip, volume: 25 }).gain, 0.25);
  assert.equal(AudioClipSchema.parse({ ...clip, level: 0.2 }).gain, 0.2);
  assert.equal(AudioClipSchema.parse({ ...clip, gain: 0.5, volume: 9 }).gain, 0.5);
  assert.equal("volume" in AudioClipSchema.parse({ ...clip, volume: 0.3 }), false);
});

test("a field a clip does not have is refused by name, so a change never quietly does nothing", () => {
  const r = AudioClipSchema.safeParse({ ...clip, loudness: 0.2 });
  assert.equal(r.success, false);
  assert.match(r.error.issues[0].message, /Unrecognized key: "loudness"/);
  assert.deepEqual(AudioClipSchema.parse({ ...clip, gain: 0.2, fadeOutMs: 800, loop: true, label: "Bed" }), { ...clip, gain: 0.2, fadeOutMs: 800, loop: true, label: "Bed" });
});
