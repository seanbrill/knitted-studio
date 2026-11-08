// A style that nothing draws. StitchSchema.style takes any key, so `fontsize` was
// stored, reported clean by check_pattern, and never drawn: the silent no-op the lock
// rule refuses everywhere else. The warning is only as good as its list of keys, so
// the list is held to the one place that reads them, the renderer.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FALLBACK_SWATCH, STYLE_KEYS, cleanRate, preflight, safeZoneIssues, videoFps } from "../src/index.ts";
import { socialStarterPack } from "../src/starters.ts";
import { BUILTIN_PARTS } from "../src/builtin-parts.ts";

const pattern = (style) => ({ id: "pt", projectId: "pj", name: "P", size: { name: "Square", w: 1080, h: 1080 }, version: 1, stitches: [{ id: "st_1", kind: "text", slot: "headline", x: 0.1, y: 0.1, w: 0.8, h: 0.2, locked: false, content: "Hello", style }] });
const unknownStyle = (style) => preflight(pattern(style), FALLBACK_SWATCH, { yarn: {} }).filter((i) => i.code === "unknown-style");

test("the style keys checked are exactly the ones the renderer reads", () => {
  const src = readFileSync(join(import.meta.dirname, "../../render/src/pure.mjs"), "utf8");
  const read = new Set([...src.matchAll(/\bst\.([a-zA-Z]+)/g), ...src.matchAll(/resolveStyle\([^)]*\)\.([a-zA-Z]+)/g)].map((m) => m[1]));
  assert.ok(read.size > 20, "the scan found the renderer's reads");
  assert.deepEqual([...STYLE_KEYS].sort(), [...read].sort());
});

test("a style nothing draws is a warning, with the key that was meant", () => {
  assert.deepEqual(unknownStyle({ fontSize: 0.05, color: "$color.text" }), []);
  const [w] = unknownStyle({ fontSize: 0.05, fontsize: 0.08, nonsenseKey: "x" });
  assert.equal(w.slot, "headline");
  assert.match(w.message, /nothing draws: fontsize, nonsenseKey/);
  assert.match(w.message, /Did you mean fontSize for fontsize\?/);
  assert.match(unknownStyle({ letterspacing: 0.1 })[0].message, /letterSpacing for letterspacing/);
});

test("nothing knitted ships uses a style nothing draws", () => {
  const styles = [];
  const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { if (k === "style" && v && typeof v === "object") styles.push(v); else walk(v); } };
  walk(socialStarterPack()); walk(BUILTIN_PARTS);
  assert.ok(styles.length > 10, "the walk found the starters' styles");
  const stray = [...new Set(styles.flatMap(Object.keys))].filter((k) => !STYLE_KEYS.includes(k));
  assert.deepEqual(stray, []);
});

// Field report 3: a phone capture (554x1200) in a landscape box on a 1080x1350 Post.
// The softness warning was right and pointed at the symptom; the cause was the shape.
const shot = (w, h, style = {}, yarn = { width: 554, height: 1200, mime: "image/png" }) => preflight(
  { id: "pt", projectId: "pj", name: "P", size: { name: "Post", w: 1080, h: 1350 }, version: 1, stitches: [{ id: "st_1", kind: "image", slot: "shot", x: 0.08, y: 0.1, w, h, locked: false, yarnId: "yn_1", style }] },
  FALLBACK_SWATCH, { yarn: { yn_1: { id: "yn_1", kind: "image", ...yarn } } });
const codes = (issues) => issues.map((i) => i.code).sort();

test("a picture in a box of a very different shape is mostly cut off, and the check says how much", () => {
  const before = shot(0.84, 0.42);
  assert.deepEqual(codes(before), ["cropped", "low-res"]);
  assert.match(before.find((i) => i.code === "cropped").message, /Only 29% of the shot image is in its box\. The box is 3\.5 times wider, in proportion/);
  assert.match(before.find((i) => i.code === "low-res").message, /554px wide but is drawn 907px wide/);
  // The report's fix: a box closer to the picture's shape still crops half of it, legitimately.
  assert.deepEqual(codes(shot(0.5, 0.42)), []);
  // Contain shows all of it; a picture that is the box's shape loses nothing.
  assert.deepEqual(codes(shot(0.84, 0.42, { fit: "contain" })), []);
  assert.deepEqual(codes(shot(0.84, 0.42, {}, { width: 1800, height: 1125, mime: "image/png" })), []);
});

test("softness is measured on the side that is stretched, so a wide picture in a tall box is caught", () => {
  const tall = shot(0.5, 0.8, {}, { width: 2000, height: 500, mime: "image/jpeg" });
  assert.match(tall.find((i) => i.code === "low-res").message, /500px tall but is drawn 1080px tall/);
  assert.match(tall.find((i) => i.code === "cropped").message, /times taller, in proportion/);
  // A vector never looks soft, but it is cut off like anything else.
  assert.deepEqual(codes(shot(0.5, 0.8, {}, { width: 200, height: 50, mime: "image/svg+xml" })), ["cropped"]);
});

// Contrast is judged against what is really behind the text. Against the page alone, every
// dark label on a bright button read 1.0:1: 189 warnings in a real library, every one wrong.
const square = (stitches) => ({ id: "pt", projectId: "pj", name: "P", size: { name: "Square", w: 1080, h: 1080 }, version: 1, stitches });
const page = { id: "bg", kind: "shape", x: 0, y: 0, w: 1, h: 1, locked: false, style: { background: "#140c24" } };
const label = (style, box = { x: 0.1, y: 0.8, w: 0.4, h: 0.08 }) => ({ id: "cta", kind: "text", slot: "cta", ...box, locked: false, content: "Create account", style: { fontSize: 0.04, color: "#140c24", ...style } });
const contrast = (stitches) => preflight(square(stitches), FALLBACK_SWATCH, { yarn: {} }).filter((i) => i.code === "low-contrast");

test("dark text on a bright button is judged against the button, not the dark page", () => {
  const pill = { id: "pill", kind: "shape", x: 0.08, y: 0.79, w: 0.44, h: 0.1, locked: false, style: { background: "#e879f9" } };
  assert.deepEqual(contrast([page, pill, label({})]), []);
  // The same text with no button under it really is unreadable, and is still caught.
  assert.match(contrast([page, label({})])[0].message, /1\.0:1/);
});

test("text the colour of the card it sits on is caught, measured against the card", () => {
  const card = { id: "card", kind: "shape", x: 0.05, y: 0.7, w: 0.9, h: 0.25, locked: false, style: { background: "#1a1030" } };
  assert.match(contrast([{ ...page, style: { background: "#ffffff" } }, card, label({})])[0].message, /1\.\d:1/);
});

test("a text box's own background is what it is read against", () => {
  assert.deepEqual(contrast([page, label({ background: "#ffffff" })]), []);
});

test("text over a picture or a gradient is not given a made-up number", () => {
  const photo = { id: "ph", kind: "image", x: 0, y: 0.5, w: 1, h: 0.5, locked: false, yarnId: "yn_1", style: { fit: "cover" } };
  const yarn = { yn_1: { id: "yn_1", kind: "image", mime: "image/jpeg", width: 2000, height: 1000 } };
  assert.deepEqual(preflight(square([page, photo, label({})]), FALLBACK_SWATCH, { yarn }).filter((i) => i.code === "low-contrast"), []);
  const fade = { id: "g", kind: "shape", x: 0, y: 0.6, w: 1, h: 0.4, locked: false, style: { background: "linear-gradient(#000, #fff)" } };
  assert.deepEqual(contrast([page, fade, label({})]), []);
});

test("a small shape beside the text, not under most of it, is not what it is read against", () => {
  const dot = { id: "dot", kind: "shape", x: 0.1, y: 0.8, w: 0.05, h: 0.08, locked: false, style: { background: "#ffffff" } };
  assert.equal(contrast([page, dot, label({})]).length, 1);
});

// ── Story safe zones ──────────────────────────────────────────────────────────
const story = (stitches, size = { name: "Story", w: 1080, h: 1920 }) => ({ id: "pt", projectId: "pj", name: "S", size, version: 1, stitches });
const zoned = (p, measured) => (measured ? safeZoneIssues(p, FALLBACK_SWATCH, measured) : preflight(p, FALLBACK_SWATCH, { yarn: { yn_logo: { id: "yn_logo", width: 800, height: 800 } } })).filter((i) => i.code === "safe-zone");
const logo = { id: "lg", kind: "image", slot: "logo", yarnId: "yn_logo", x: 0.06, y: 0.04, w: 0.2, h: 0.1, locked: false, style: {} };
const cta = { id: "ct", kind: "text", slot: "cta", x: 0.1, y: 0.86, w: 0.8, h: 0.06, locked: false, content: "Create account", style: { fontSize: 0.05 } };

test("a story's logo under the top bar and its call to action under the reply bar are both flagged, in pixels", () => {
  const [a, b] = zoned(story([logo, cta]));
  assert.equal(a.stitchId, "lg"); assert.match(a.message, /top 13% of a 9:16 frame.*Keep it below 250px/);
  assert.equal(b.stitchId, "ct"); assert.match(b.message, /bottom 18%.*Keep it above 1574px/);
});

test("the same layout in a post, a full-bleed photo, a backdrop and a hidden stitch are not", () => {
  assert.deepEqual(zoned(story([logo, cta], { name: "Post", w: 1080, h: 1350 })), []);
  const photo = { ...logo, id: "ph", slot: "photo", x: 0, y: 0, w: 1, h: 1 };
  const back = { ...logo, id: "bd", slot: "backdrop", w: 0.1 };
  const hid = { ...cta, id: "hd", style: { hidden: true } };
  assert.deepEqual(zoned(story([photo, back, hid])), []);
});

test("without a browser only the line a text box is anchored by counts; measured lines say where it really is", () => {
  // A tall box from 5% down, its text sitting at the bottom: the words are clear of the top bar.
  const tall = { id: "tx", kind: "text", slot: "headline", x: 0.1, y: 0.05, w: 0.8, h: 0.55, locked: false, content: "Rate it once", style: { fontSize: 0.09, verticalAlign: "bottom" } };
  assert.deepEqual(zoned(story([tall])), [], "no false alarm from the box's empty top");
  assert.deepEqual(zoned(story([{ ...tall, style: { fontSize: 0.09 } }])).map((i) => i.stitchId), ["tx"], "anchored at the top, its first line is under the bar");
  assert.deepEqual(zoned(story([tall]), [{ stitchId: "tx", top: 0.08, bottom: 0.6 }]).map((i) => i.stitchId), ["tx"], "measured: six lines reach up under the bar");
  assert.deepEqual(zoned(story([tall]), [{ stitchId: "tx", top: 0.5, bottom: 0.6 }]), []);
});

test("music set far under the voice is flagged, with what suits", () => {
  const withAudio = (audio) => ({ ...story([]), durationMs: 5000, motion: { tracks: {}, audio } });
  const yarn = { yn_m: { id: "yn_m" }, yn_v: { id: "yn_v" } };
  const quiet = (audio) => preflight(withAudio(audio), FALLBACK_SWATCH, { yarn }).filter((i) => i.code === "quiet-music").map((i) => i.message);
  const voice = { id: "v", yarnId: "yn_v", kind: "voice", startMs: 0 };
  assert.match(quiet([voice, { id: "m", yarnId: "yn_m", kind: "music", startMs: 0, gain: 0.08 }])[0], /gain 0\.08, 22 dB under the voice level, so it will barely be heard even when nobody speaks.*0\.4 to 0\.6/);
  assert.deepEqual(quiet([voice, { id: "m", yarnId: "yn_m", kind: "music", startMs: 0, gain: 0.5 }]), []);
  assert.deepEqual(quiet([voice, { id: "m", yarnId: "yn_m", kind: "music", startMs: 0 }]), [], "no gain is full level");
});

test("a video is knitted at its footage's own rate when all of it shares 24 or 25, so no frame repeats", () => {
  const clip = (id, fps) => [id, { id, name: `clip ${fps}`, kind: "video", deletedAt: null, meta: { fps } }];
  const yarn = Object.fromEntries([clip("y25", 25), clip("y25b", 25), clip("y24", 23.98), clip("y30", 29.97), clip("y50", 50), clip("y12", 12)]);
  const reel = (...ids) => ({ ...story(ids.map((y, i) => ({ id: `v${i}`, kind: "video", slot: i ? undefined : "footage", x: 0, y: 0, w: 1, h: 1, locked: false, yarnId: y }))), durationMs: 6000, motion: { tracks: {}, audio: [] } });
  assert.deepEqual([25, 50, 23.98, 29.97, 59.94, 12, undefined].map(cleanRate), [25, 25, 24, 30, 30, null, null]);
  assert.equal(videoFps(reel("y25", "y25b"), yarn), 25);
  assert.equal(videoFps(reel("y25", "y50"), yarn), 25, "50 halves evenly to 25");
  assert.equal(videoFps(reel("y24"), yarn), 24);
  assert.equal(videoFps(reel("y30"), yarn), 30);
  assert.equal(videoFps(reel(), yarn), 30, "no footage: the standard");
  assert.equal(videoFps(reel("y25", "y30"), yarn), 30, "mixed: the standard");
  assert.equal(videoFps(reel("y25"), yarn, 60), 60, "60 when asked for");
  const hidden = reel("y25", "y30"); hidden.stitches[1].style = { hidden: true };
  assert.equal(videoFps(hidden, yarn), 25, "a hidden clip is not in the video");

  const rate = (p, fps) => preflight(p, FALLBACK_SWATCH, { yarn, fps }).filter((i) => i.code === "footage-rate");
  assert.deepEqual(rate(reel("y25", "y25b")), [], "at its own rate, nothing to say");
  const [mixed, ...more] = rate(reel("y25", "y30", "y25"));
  assert.equal(more.length, 0, "told once a file");
  assert.equal(mixed.slot, "footage");
  assert.match(mixed.message, /"clip 25" was shot at 25 frames a second and this video is 30, so some of its frames are held longer than others/);
  assert.match(rate(reel("y25"), 60)[0].message, /video is 60.*and 60 is not asked for/);
  assert.deepEqual(rate(reel("y30"), 60), [], "30 divides into 60");
  assert.deepEqual(rate(reel("y12", "y30"), undefined), [], "an odd rate has no clean one to suggest");
  assert.deepEqual(rate({ ...reel("y25", "y30"), durationMs: 0 }), [], "a still has no frame rate");
});
