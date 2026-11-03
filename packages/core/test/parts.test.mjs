import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_PARTS, ValidationError, createPart, deletePart, duplicatePart, ensureBuiltinParts, exportPart, importPart, listParts, openStore, partUsage, setPartScope, updatePart } from "../src/node.ts";
import { applyCommand, detachInstance, fillTemplate, hasLintErrors, instanceOf, lintCodePart, partFromStitches, uniqueSlotName } from "../src/index.ts";
import { pageFor } from "../../render/src/pure.mjs";

const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-parts-")), "k.db"));
const project = store.createProject({ name: "Parts", starter: "social" });

test("ten starter parts ship, are visible from every project, and are seeded once", () => {
  const a = listParts(store, project.id);
  assert.equal(a.filter((p) => p.builtin).length, BUILTIN_PARTS.length);
  assert.equal(BUILTIN_PARTS.length, 10);
  const other = store.createProject({ name: "Other" });
  assert.equal(listParts(store, other.id).filter((p) => p.builtin).length, 10, "the library is shared");
  ensureBuiltinParts(store); ensureBuiltinParts(store);
  assert.equal(listParts(store, project.id).filter((p) => p.builtin).length, 10, "never duplicated");
});

test("the starter parts use brand tokens, never hex, so they adopt any swatch", () => {
  for (const p of listParts(store, project.id).filter((x) => x.builtin)) {
    const css = JSON.stringify(p.stitches);
    assert.doesNotMatch(css, /#[0-9a-f]{6}/i, `${p.name} hard-codes a colour`);
  }
});

test("a starter part is read-only, and cannot be deleted: duplicate it instead", () => {
  const p = listParts(store, project.id).find((x) => x.builtin);
  assert.throws(() => updatePart(store, p.id, { name: "x" }), /read-only/);
  assert.throws(() => deletePart(store, p.id), /cannot be deleted/);
  const mine = duplicatePart(store, p.id, project.id);
  assert.equal(mine.builtin, false);
  assert.equal(mine.projectId, project.id);
});

// ── a selection becomes a Part and back, without drifting ───────────────────
const frame = { w: 1080, h: 1920 };
const sel = () => [
  { id: "a", kind: "text", slot: "headline", x: 0.1, y: 0.5, w: 0.6, h: 0.1, locked: false, content: "Hello", style: { fontSize: 0.06, fontFamily: "$font.display", color: "$color.text" } },
  { id: "b", kind: "shape", x: 0.1, y: 0.62, w: 0.3, h: 0.02, locked: false, style: { background: "$color.primary", radius: 0.01 } },
];

test("saving a selection as a part, then detaching it, restores positions, sizes and type", () => {
  const { draft, box } = partFromStitches(sel(), frame, { name: "Block" });
  assert.equal(draft.slots.length, 1);
  assert.equal(draft.slots[0].name, "headline");
  const part = { ...draft, id: "pa_1", version: 1, kind: "stitches", projectId: "p", builtin: false, tags: [], durationMs: 0, createdAt: "", updatedAt: "" };
  const inst = instanceOf(part, box, "block");
  const back = detachInstance(inst, part);
  for (const orig of sel()) {
    const got = back.find((s) => s.kind === orig.kind);
    for (const k of ["x", "y", "w", "h"]) assert.ok(Math.abs(got[k] - orig[k]) < 1e-4, `${orig.kind}.${k}: ${got[k]} vs ${orig[k]}`);
    if (orig.style.fontSize) assert.ok(Math.abs(got.style.fontSize - orig.style.fontSize) < 1e-4, "type size survives the round trip");
  }
  assert.equal(back.find((s) => s.kind === "text").slot, "block_headline", "slot names are prefixed so they stay unique");
});

test("instance names are unique in a pattern", () => {
  assert.equal(uniqueSlotName("Lower third", []), "lower_third");
  assert.equal(uniqueSlotName("Lower third", ["lower_third"]), "lower_third_2");
  assert.equal(uniqueSlotName("3 up", []), "p3_up");
});

// ── locks reach INSIDE a part ───────────────────────────────────────────────
function patternWith(slots, locked = false) {
  return { id: "pt", projectId: "pj", name: "P", size: { name: "S", w: 1000, h: 1000 }, durationMs: 0, version: 1, updatedAt: "",
    stitches: [{ id: "i", kind: "part", slot: "lower_third", x: 0, y: 0.8, w: 0.5, h: 0.1, locked, partId: "pa", partVersion: 1, overrides: {}, partSlots: slots }] };
}
const SLOTS = [{ name: "name", kind: "text", locked: false }, { name: "title", kind: "text", locked: true }];

test("a model can fill a free slot inside a part and is refused on a locked one", () => {
  const p = patternWith(SLOTS);
  const ok = applyCommand(p, { type: "fillSlot", slot: "lower_third.name", content: "Ada" }, "model");
  assert.equal(ok.changed, true);
  assert.equal(ok.pattern.stitches[0].overrides.name, "Ada");
  const no = applyCommand(p, { type: "fillSlot", slot: "lower_third.title", content: "hijack" }, "model");
  assert.equal(no.changed, false);
  assert.equal(no.refusals.length, 1);
  assert.match(no.refusals[0].why, /locked/);
  assert.equal(applyCommand(p, { type: "fillSlot", slot: "lower_third.title", content: "owner may" }, "human").changed, true);
});

test("a locked instance locks every slot in it, and typos are reported, not ignored", () => {
  const p = patternWith(SLOTS, true);
  assert.equal(applyCommand(p, { type: "fillSlot", slot: "lower_third.name", content: "x" }, "fill").changed, false);
  assert.match(applyCommand(patternWith(SLOTS), { type: "fillSlot", slot: "lower_third.nope", content: "x" }, "model").refusals[0].why, /no slot called "nope"/);
  assert.match(applyCommand(patternWith(SLOTS), { type: "fillSlot", slot: "nothing.name", content: "x" }, "model").refusals[0].why, /no part called/);
});

test("filling a slot inside a part is undoable, exactly", () => {
  const p = patternWith(SLOTS);
  const r = applyCommand(p, { type: "fillSlot", slot: "lower_third.name", content: "Ada" }, "human");
  const back = applyCommand(r.pattern, r.inverse, "human");
  assert.deepEqual(back.pattern.stitches[0].overrides, p.stitches[0].overrides);
});

// ── versions, usage, files ──────────────────────────────────────────────────
test("editing a part bumps its version, and usage finds every pattern that uses it", () => {
  const part = createPart(store, project.id, { name: "Mine", stitches: sel(), slots: [{ name: "headline", kind: "text", locked: false }], aspect: 4 });
  assert.equal(part.version, 1);
  const pat = store.listPatterns(project.id)[0];
  store.apply(pat.id, { type: "addStitch", stitch: { id: "inst", kind: "part", slot: "mine", x: 0, y: 0, w: 0.5, h: 0.1, locked: false, partId: part.id, partVersion: 1, overrides: {}, partSlots: part.slots } }, "human");
  assert.deepEqual(partUsage(store, part.id).map((u) => u.patternId), [pat.id]);
  assert.equal(updatePart(store, part.id, { name: "Mine v2" }).version, 2);
  assert.equal(deletePart(store, part.id).usedIn, 1, "delete reports how many patterns lose it");
});

test("a part can move to the library and become available in other projects", () => {
  const part = createPart(store, project.id, { name: "Shared", stitches: sel(), aspect: 2 });
  const other = store.createProject({ name: "Elsewhere" });
  assert.equal(listParts(store, other.id).some((p) => p.name === "Shared"), false);
  setPartScope(store, part.id, null);
  assert.equal(listParts(store, other.id).some((p) => p.name === "Shared"), true);
});

test("export then import round-trips a part, and bad or newer files are refused", () => {
  const part = createPart(store, project.id, { name: "Portable", stitches: sel(), slots: [{ name: "headline", kind: "text", locked: true }], aspect: 3 });
  const file = JSON.parse(JSON.stringify(exportPart(store, part.id)));
  const got = importPart(store, project.id, file);
  assert.equal(got.name, "Portable");
  assert.equal(got.slots[0].locked, true);
  assert.notEqual(got.id, part.id);
  assert.throws(() => importPart(store, project.id, { hello: 1 }), /not a knitted part file/);
  assert.throws(() => importPart(store, project.id, { ...file, version: 9 }), /newer knitted/);
});

test("validation speaks plainly", () => {
  assert.throws(() => createPart(store, project.id, { name: " ", stitches: sel() }), /Give the part a name/);
  assert.throws(() => createPart(store, project.id, { name: "x", stitches: [] }), /at least one stitch/);
  assert.throws(() => createPart(store, project.id, { name: "x", stitches: sel(), slots: [{ name: "Bad Name", kind: "text", locked: false }] }), /not a slot name/);
  assert.throws(() => createPart(store, project.id, { name: "x", stitches: sel(), slots: [{ name: "a", kind: "text", locked: false }, { name: "a", kind: "text", locked: false }] }), /same name/);
});

// ── code parts: each rule must be seen to FAIL ──────────────────────────────
const BAD = [
  ["<script>alert(1)</script><p>x</p>", "", /Scripts are not allowed/],
  ['<p onclick="x()">x</p>', "", /Event handlers/],
  ["<p>x</p>", "", null],
  ["<p>x</p><script>setTimeout(f,1)</script>", "", /clock or randomness/],
  ["<p>x</p>", "p{background:url(https://evil.example/a.png)}", /cannot load anything from the web/],
  ["<p>x</p>", "@import 'x.css';", /@import/],
  ['<iframe src="x"></iframe>', "", /not allowed/],
  ["<p>fetch('/x')</p>", "", /network/],
];
test("code parts: scripts, handlers, the clock, the network, remote loads and embeds are all refused", () => {
  for (const [html, css, re] of BAD) {
    const lint = lintCodePart(html, css);
    if (!re) { assert.equal(hasLintErrors(lint), false, "a clean part must pass"); continue; }
    assert.ok(lint.some((l) => l.level === "error" && re.test(l.message)), `not caught: ${html}${css}`);
  }
});
test("an infinite animation is a warning, not an error", () => {
  const l = lintCodePart("<p>x</p>", "p{animation:a 1s infinite;animation-iteration-count:infinite}");
  assert.ok(l.some((x) => x.level === "warning"));
  assert.equal(hasLintErrors(l), false);
});
test("a code part with a script cannot even be saved", () => {
  assert.throws(() => createPart(store, project.id, { name: "Bad", kind: "code", html: "<script>x</script>", css: "", aspect: 1 }), ValidationError);
});

test("slot values are HTML-escaped into a code part, so a slot cannot inject markup", () => {
  const out = fillTemplate("<p>{{name}}</p>", { name: '<img src=x onerror="alert(1)">' });
  assert.doesNotMatch(out, /<img/);
  assert.match(out, /&lt;img/);
});

test("a code part renders inside a sandbox with no script and a CSP, and an injection attempt stays inert", () => {
  const part = { id: "pa_c", kind: "code", slots: [{ name: "name", kind: "text", locked: false }], html: "<p class=n>{{name}}</p>", css: ".n{color:red}", stitches: [], aspect: 2, version: 1 };
  const html = pageFor({ id: "p", size: { name: "S", w: 600, h: 600 }, durationMs: 0, stitches: [{ id: "i", kind: "part", slot: "c", x: 0, y: 0, w: 0.5, h: 0.25, locked: false, partId: "pa_c", overrides: { name: '</p><script>alert(1)</script>' }, partSlots: part.slots }] }, { part: () => part });
  assert.match(html, /<iframe class="partframe" sandbox="allow-same-origin"/);
  assert.doesNotMatch(html, /sandbox="[^"]*allow-scripts/);
  const srcdoc = html.match(/srcdoc="([^"]*)"/)[1];
  assert.match(srcdoc, /Content-Security-Policy/);
  assert.doesNotMatch(srcdoc.replace(/&lt;script&gt;/g, ""), /<script/i, "the injected script is text, not markup");
});
