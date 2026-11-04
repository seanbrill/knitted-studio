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

// ── What a model reached for and did not have (the notch.fm field report) ──

const { activeSwatch, importYarn, listSwatches, listYarn, uploadTempPath } = await import("@knitted/core/node");
const { default: sharp } = await import("sharp");
const { mkdirSync, writeFileSync } = await import("node:fs");
async function picture(name, background) {
  const tmp = uploadTempPath(store, project.id); mkdirSync(join(tmp, ".."), { recursive: true });
  writeFileSync(tmp, await sharp({ create: { width: 64, height: 64, channels: 3, background } }).png().toBuffer());
  return (await importYarn(store, project.id, tmp, `${name}.png`, { name })).yarn;
}
const hero = await picture("Hero shot", { r: 200, g: 60, b: 20 });
const product = await picture("Bottle", { r: 20, g: 90, b: 200 });
await tools.tag_yarn({ yarnId: product.id, tags: ["product"] });
const photos = store.createPattern(project.id, {
  name: "Photos", size: { name: "Square", w: 1080, h: 1080 },
  stitches: [
    { id: "p", kind: "image", slot: "photo", x: 0, y: 0, w: 1, h: 0.8, locked: false },
    { id: "l", kind: "image", slot: "logo", x: 0, y: 0.8, w: 0.2, h: 0.2, locked: true, yarnId: hero.id },
  ],
});
const photo = () => store.getPattern(photos.id).stitches[0];

test("an image slot is filled with a Yarn name, id or tag; a name that is not there is refused by name", async () => {
  const at = { projectId: project.id, patternId: photos.id };
  assert.deepEqual((await tools.fill_slots({ ...at, slots: { photo: "hero SHOT" } })).filled, ["photo"]);
  assert.equal(photo().yarnId, hero.id, "a name, whatever its case");
  await tools.fill_slots({ ...at, slots: { photo: "tag:product" } });
  assert.equal(photo().yarnId, product.id, "the first file with the tag");
  await tools.fill_slots({ ...at, slots: { photo: hero.id } });
  assert.equal(photo().yarnId, hero.id, "an id");
  const r = await tools.fill_slots({ ...at, slots: { photo: "Nonesuch", logo: "Bottle" } });
  assert.deepEqual(r.filled, []);
  assert.match(r.refused.find((x) => x.slot === "photo").why, /called "Nonesuch".*list_yarn/);
  assert.match(r.refused.find((x) => x.slot === "logo").why, /locked/i, "a locked image is refused like locked text");
  assert.equal(store.getPattern(photos.id).stitches[1].yarnId, hero.id);
});

test("rename labels a pattern or a piece of Yarn, one at a time", async () => {
  assert.equal((await tools.rename({ patternId: photos.id, name: "Draft: photos" })).name, "Draft: photos");
  assert.equal(store.getPattern(photos.id).name, "Draft: photos");
  await tools.rename({ yarnId: product.id, name: "Bottle, front" });
  assert.equal(listYarn(store, project.id).find((y) => y.id === product.id).name, "Bottle, front");
  await assert.rejects(tools.rename({ name: "x" }), /one of patternId or yarnId/);
  await assert.rejects(tools.rename({ patternId: photos.id, yarnId: product.id, name: "x" }), /one of patternId or yarnId/);
});

test("add_stitch answers with the new stitch's id, as the other tools that make things do", async () => {
  const r = await tools.add_stitch({ patternId: photos.id, kind: "text", slot: "caption", x: 0.1, y: 0.85, w: 0.8, h: 0.1, content: "Fresh" });
  assert.equal(typeof r.id, "string");
  assert.equal(r.added, r.id);
  assert.equal(store.getPattern(photos.id).stitches.find((s) => s.id === r.id).slot, "caption");
});

test("check_pattern names a style nothing draws, with the one that was meant", async () => {
  await tools.update_stitch({ patternId: photos.id, stitch: "caption", patch: { style: { fontsize: 0.08 } } });
  const issues = (await tools.check_pattern({ patternId: photos.id })).flatMap((u) => u.issues);
  assert.ok(issues.some((i) => /Did you mean fontSize for fontsize\?/.test(i)), issues.join("\n"));
});

test("propose_swatch adds a swatch for the person to look over, and never makes it the project's", async () => {
  const before = activeSwatch(store, project.id).id;
  const count = listSwatches(store, project.id).length;
  const r = await tools.propose_swatch({
    projectId: project.id, name: "notch.fm",
    colors: [{ role: "primary", name: "Violet", hex: "#B16CF8" }, { role: "text", hex: "#ffffff" }, { role: "background", hex: "#150829" }],
    fonts: { display: "Bricolage Grotesque", body: "Inter" }, logoYarnId: hero.id,
  });
  assert.equal(r.active, false);
  assert.equal(activeSwatch(store, project.id).id, before, "only a person makes it the project's swatch");
  assert.equal(listSwatches(store, project.id).length, count + 1);
  assert.equal(r.name, "notch.fm", "a name the model gave is not wrapped as a website's words");
  assert.deepEqual(r.colors, ["primary #b16cf8", "text #ffffff", "background #150829"]);
  assert.deepEqual(r.fonts, { display: "Bricolage Grotesque", body: "Inter" });
  assert.equal(r.logo, hero.id);
  assert.match(r.next, /only they can make it the project's swatch/);
  assert.ok(store.activity(project.id).some((a) => a.action === "swatch.created" && a.actor === "model"));
  await assert.rejects(tools.propose_swatch({ projectId: project.id, colors: [{ role: "primary", hex: "#b16cf8" }] }), /needs a text colour/);
  await assert.rejects(tools.propose_swatch({ projectId: project.id }), /Give a url/);
  const other = store.createProject({ name: "Other" });
  await assert.rejects(tools.propose_swatch({ projectId: other.id, colors: [{ role: "primary", hex: "#b16cf8" }, { role: "text", hex: "#ffffff" }, { role: "background", hex: "#150829" }], logoYarnId: hero.id }), /this project's Yarn/);
});

test("propose_swatch reads a website, and the colours a model gives win over the site's", async () => {
  // A public documentation address, so the guard on every fetch stays on.
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(`<!doctype html><html><head><title>Brandy</title><style>body { background: #fdfcfb; color: #1c1917 } .btn { background: #0f766e }</style></head><body><button class="btn">Go</button></body></html>`, { headers: { "content-type": "text/html" } });
  try {
    const r = await tools.propose_swatch({ projectId: project.id, url: "https://203.0.113.7/", colors: [{ role: "primary", hex: "#e11d48" }] });
    assert.match(r.colors.join(" "), /primary #e11d48/, "the model's primary wins");
    assert.match(r.colors.join(" "), /background #fdfcfb/);
    assert.match(r.colors.join(" "), /text #1c1917/);
    assert.match(r.name, /<untrusted_data source="website:203\.0\.113\.7">\nBrandy\n<\/untrusted_data>/, "a website's name is its words, not an instruction");
    assert.equal(r.active, false);
  } finally { globalThis.fetch = real; }
});
