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
  assert.ok(r.instructions.startsWith(INSTRUCTIONS));
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
  await assert.rejects(tools.rename({ name: "x" }), /one of patternId, yarnId or folder/);
  await assert.rejects(tools.rename({ patternId: photos.id, yarnId: product.id, name: "x" }), /one of patternId, yarnId or folder/);
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

// ── Field reports 2 and 3: what a model reached for on a complete run ──

test("initialize says which knitted this is, so a client can tell the build it is talking to", async () => {
  const { readFile } = await import("node:fs/promises");
  const { version } = JSON.parse(await readFile(new URL("../apps/studio/package.json", import.meta.url), "utf8"));
  const r = (await rpc("initialize", { protocolVersion: "2025-06-18" })).result;
  assert.equal(r.serverInfo.version, version);
  assert.match(r.instructions, new RegExp(`This is knitted ${version.replace(/\./g, "\\.")}\\.$`));
});

test("a pattern id is enough for every pattern tool, and a project id that is not the pattern's is refused", async () => {
  const { TOOLS } = await import("@knitted/mcp/context");
  assert.deepEqual(TOOLS.filter((t) => t.inputSchema.properties.patternId && t.inputSchema.required.includes("projectId")).map((t) => t.name), []);
  assert.equal((await tools.get_pattern({ patternId: pattern.id })).id, pattern.id);
  assert.deepEqual((await tools.fill_slots({ patternId: pattern.id, slots: { headline: "By its id alone" } })).filled, ["headline"]);
  assert.equal(saved().stitches[0].content, "By its id alone");
  const elsewhere = store.createProject({ name: "Elsewhere" });
  for (const name of ["get_pattern", "fill_slots", "knit_pattern"]) {
    await assert.rejects(tools[name]({ projectId: elsewhere.id, patternId: pattern.id, slots: {} }), /is in project .*Leave out projectId/, name);
  }
});

test("import_yarn takes tags, and the same file twice gets the new tags on the one already there", async () => {
  const r = await tools.import_yarn({ projectId: project.id, text: "Spring is here.", name: "Spring line", tags: ["Spring", "launch"] });
  assert.deepEqual([r.kind, r.tags, r.existing], ["copy", ["spring", "launch"], false]);
  const again = await tools.import_yarn({ projectId: project.id, text: "Spring is here.", name: "Spring line", tags: ["hero"] });
  assert.deepEqual([again.id, again.tags, again.existing], [r.id, ["spring", "launch", "hero"], true]);
  assert.deepEqual(listYarn(store, project.id, { tag: "hero" }).map((y) => y.id), [r.id]);
  assert.ok(store.activity(project.id).some((a) => a.action === "yarn.imported" && a.subject === "Spring line" && a.actor === "model"), "the activity says a model saved it");
  await assert.rejects(tools.import_yarn({ projectId: project.id, text: "x", tags: "product" }), /tags is a list of words/);
});

test("propose_swatch takes fonts in the shape a swatch stores them, and the brand's corner radius", async () => {
  const colors = [{ role: "primary", hex: "#b16cf8" }, { role: "text", hex: "#ffffff" }, { role: "background", hex: "#150829" }];
  const r = await tools.propose_swatch({ projectId: project.id, colors, fonts: { display: { family: "Bricolage Grotesque" }, body: "Inter" }, rules: { cornerRadius: 0.04 } });
  assert.deepEqual(r.fonts, { display: "Bricolage Grotesque", body: "Inter" });
  assert.equal(r.cornerRadius, 0.04);
  await assert.rejects(tools.propose_swatch({ projectId: project.id, colors, fonts: { display: 7 } }), /fonts\.display is not a family name\. Give fonts as family names/);
  await assert.rejects(tools.propose_swatch({ projectId: project.id, colors, rules: { cornerRadius: "round" } }), /cornerRadius is a fraction of the frame's width/);
});

test("create_part makes a part of a pattern's stitches, and a slot the brand locked stays locked wherever it goes", async () => {
  const { listParts } = await import("@knitted/core/node");
  const post = store.createPattern(project.id, {
    name: "Post", size: { name: "Post", w: 1080, h: 1350 },
    stitches: [
      { id: "h", kind: "text", slot: "headline", x: 0.1, y: 0.1, w: 0.8, h: 0.2, locked: false, content: "Hi" },
      { id: "r", kind: "shape", slot: "rule", x: 0.1, y: 0.808, w: 0.8, h: 0.0015, locked: false },
      { id: "w", kind: "text", slot: "wordmark", x: 0.1, y: 0.814, w: 0.3, h: 0.028, locked: false, content: "notch.fm" },
      { id: "g", kind: "text", slot: "legal", x: 0.1, y: 0.846, w: 0.8, h: 0.02, locked: true, content: "Terms apply." },
    ],
  });
  const parts = () => listParts(store, project.id).filter((p) => !p.builtin).length;
  const before = parts();
  await assert.rejects(tools.create_part({ patternId: post.id, stitches: ["rule", "wordmark", "legal"], name: "Footer", replace: true }), /legal is locked by the brand, so only a person can swap it for a part/);
  assert.equal(parts(), before, "a refused call makes nothing");
  const footer = await tools.create_part({ patternId: post.id, stitches: ["rule", "wordmark", "legal"], name: "Footer", category: "frame" });
  assert.deepEqual(footer.slots, ["wordmark", "legal [locked]"]);
  assert.equal(store.getPattern(post.id).stitches.length, 4, "without replace the pattern is left as it was");
  assert.ok(store.activity(project.id).some((a) => a.action === "part.created" && a.subject === "Footer" && a.actor === "model"));
  // Inserted anywhere, its locked slot is still the brand's.
  const ins = await tools.insert_part({ patternId: pattern.id, partId: footer.id, slot: "footer" });
  const fill = await tools.fill_slots({ patternId: pattern.id, slots: { "footer.wordmark": "notch", "footer.legal": "No terms" } });
  assert.deepEqual([ins.inserted, fill.filled, fill.refused.map((x) => x.slot)], ["footer", ["footer.wordmark"], ["footer.legal"]]);
  // With replace, the stitches become one linked copy of the part.
  const bar = await tools.create_part({ patternId: post.id, stitches: ["rule", "wordmark"], name: "Wordmark bar", replace: true });
  const now = store.getPattern(post.id).stitches;
  assert.deepEqual(now.map((s) => s.slot), ["headline", "legal", "wordmark_bar"]);
  assert.deepEqual([bar.instance, now[2].partId, now[2].kind], ["wordmark_bar", bar.id, "part"]);
  assert.ok(Math.abs(now[2].y - 0.808) < 1e-9 && Math.abs(now[2].w - 0.8) < 1e-9, "the instance sits where the stitches were");
  await assert.rejects(tools.create_part({ patternId: post.id, stitches: ["nonesuch"], name: "X" }), /No stitch "nonesuch"/);
});

// ── Watching a model work: each call is shown as it runs, and the person can pause it ──

const { agentState, setAgentPaused } = await import("@knitted/core/node");
const lastCall = () => agentState(store).calls.at(-1);

test("each call is shown in words while it runs, pointing at the stitches it works on", async () => {
  await tools.fill_slots({ patternId: pattern.id, slots: { headline: "Watched" } });
  const c = lastCall();
  assert.deepEqual([c.client, c.tool, c.summary, c.edits, c.state], ["A model", "fill_slots", "Filling headline on Story", true, "done"]);
  assert.deepEqual(c.where, { projectId: project.id, patternId: pattern.id, stitchIds: ["a"] });
  // Partly refused, it still did the rest: the canvas marks what it changed, never the locked stitch.
  await tools.fill_slots({ patternId: pattern.id, slots: { headline: "Again", eyebrow: "no" } });
  assert.deepEqual([lastCall().state, lastCall().where.stitchIds], ["done", ["a"]]);
  assert.match(lastCall().note, /^eyebrow: .*locked/i);
  await tools.fill_slots({ patternId: pattern.id, slots: { eyebrow: "no" } });
  assert.deepEqual([lastCall().state, lastCall().where.stitchIds], ["refused", undefined]);
  await assert.rejects(tools.get_pattern({ patternId: "pt_nonesuch" }));
  assert.deepEqual([lastCall().state, lastCall().edits, lastCall().summary], ["failed", false, "Reading a pattern"]);
  assert.ok(lastCall().note.length > 0, "a failure says why");
});

test("paused, a model's changes are refused and it is told to wait, but it can still look and stop its own job", async () => {
  setAgentPaused(store, true);
  try {
    const before = saved().stitches[0].content;
    await assert.rejects(tools.fill_slots({ patternId: pattern.id, slots: { headline: "While paused" } }), /paused you in the studio.*press Resume/);
    assert.equal(saved().stitches[0].content, before, "nothing changed");
    assert.deepEqual([lastCall().state, lastCall().note], ["refused", "Paused in the studio."]);
    const wire = (await rpc("tools/call", { name: "apply_batch", arguments: { patternId: pattern.id, commands: [] } })).result;
    assert.equal(wire.isError, true);
    assert.match(wire.content[0].text, /paused you in the studio/, "the model reads why, as a result");
    assert.equal((await tools.get_pattern({ patternId: pattern.id })).id, pattern.id);
    const stop = await tools.cancel_job({ jobId: "jb_nonesuch" }).then(() => "", (e) => e.message);
    assert.doesNotMatch(stop, /paused/);
  } finally { setAgentPaused(store, false); }
  assert.deepEqual((await tools.fill_slots({ patternId: pattern.id, slots: { headline: "Resumed" } })).filled, ["headline"]);
});

test("the tools marked read-only change nothing, so a pause that lets them through holds", async () => {
  const { READ_ONLY } = await import("@knitted/mcp/tools");
  const { TOOLS } = await import("@knitted/mcp/context");
  assert.deepEqual([...READ_ONLY].filter((n) => !TOOLS.some((t) => t.name === n)), [], "every name is a real tool");
  const listed = (await rpc("tools/list")).result.tools;
  assert.deepEqual(listed.filter((t) => t.annotations.readOnlyHint).map((t) => t.name).sort(), [...READ_ONLY].sort());
  await tools.list_parts({ projectId: project.id }); // the first look puts the built-in parts on the shelf
  const rev = store.rev();
  // preview_pattern draws in a browser: test/e2e/renderer.e2e.mjs covers it.
  for (const name of [...READ_ONLY].filter((n) => n !== "preview_pattern")) await tools[name]({ ...ids, jobId: "jb_nonesuch" }).catch(() => {});
  assert.equal(store.rev(), rev);
});

test("the studio names a model by what its client said it is", async () => {
  const { clientLabel } = await import("@knitted/mcp/context");
  assert.equal(clientLabel("claude-code"), "Claude Code");
  assert.equal(clientLabel("Cursor"), "Cursor");
  assert.equal(clientLabel("notch-agent"), "notch-agent");
  assert.equal(clientLabel(""), "A model");
  assert.equal(clientLabel(undefined), "A model");
  assert.equal(clientLabel("x".repeat(100)).length, 40);
});

// ── Folders: a model sorts a project the way its person thinks of it ──

test("a model files things into folders, and filing one changes nothing else about it", async () => {
  const at = { projectId: project.id };
  const before = store.getPattern(photos.id);
  const r = await tools.move_to_folder({ ...at, folder: "Royalty free music/Lo-fi", yarnIds: [hero.id], patternIds: [photos.id] });
  assert.deepEqual(r.moved, { yarn: { folder: "Royalty free music/Lo-fi", moved: 1 }, patterns: { folder: "Royalty free music/Lo-fi", moved: 1 } });
  const after = store.getPattern(photos.id);
  assert.deepEqual([after.folder, after.version, after.stitches], ["Royalty free music/Lo-fi", before.version, before.stitches], "the pattern is the same, only filed");
  assert.deepEqual([lastCall().summary, lastCall().where], ["Filing 2 things into \"Royalty free music/Lo-fi\"", { projectId: project.id, section: "yarn" }]);
  assert.ok(store.activity(project.id).some((a) => a.actor === "model" && a.action === "folder.filed" && a.subject === "1 file into Royalty free music/Lo-fi"), "the person can see what the model sorted");

  // The lists say where each thing is; a folder's path is found whatever its case.
  assert.deepEqual((await tools.list_yarn({ ...at, folder: "royalty free MUSIC" })).map((y) => [y.id, y.folder]), [[hero.id, "Royalty free music/Lo-fi"]]);
  assert.equal((await tools.list_patterns(at)).find((p) => p.id === photos.id).folder, "Royalty free music/Lo-fi");
  assert.equal((await tools.list_patterns(at)).find((p) => p.id === pattern.id).folder, undefined, "at the top, nothing is said");
  assert.deepEqual(await tools.list_folders({ ...at, section: "yarn" }), { section: "yarn", top: listYarn(store, project.id).length - 1, folders: [{ path: "Royalty free music", items: 0 }, { path: "Royalty free music/Lo-fi", items: 1 }] });
  assert.deepEqual(Object.keys(await tools.list_folders(at)), ["patterns", "yarn", "parts", "swatches", "knits", "reference"]);

  // Renamed in place, or moved by its whole path, a folder takes what is in it along. Each section is its own.
  assert.deepEqual(await tools.rename({ ...at, section: "yarn", folder: "Royalty free music/Lo-fi", name: "Chill" }), { folder: "Royalty free music/Chill", section: "yarn" });
  assert.equal(lastCall().summary, "Renaming the folder \"Royalty free music/Lo-fi\" to \"Chill\"");
  assert.equal((await tools.rename({ ...at, section: "yarn", folder: "Royalty free music/Chill", name: "/Chill" })).folder, "Chill");
  assert.equal(listYarn(store, project.id).find((y) => y.id === hero.id).folder, "Chill");
  assert.equal(store.getPattern(photos.id).folder, "Royalty free music/Lo-fi", "the Patterns folders did not move");

  // All or none, and what is missing is said.
  await assert.rejects(tools.move_to_folder({ ...at, folder: "Elsewhere", yarnIds: [hero.id], patternIds: ["pt_nonesuch"] }), /pt_nonesuch is not one of this project's patterns/);
  assert.equal(listYarn(store, project.id).find((y) => y.id === hero.id).folder, "Chill", "nothing moved");
  await assert.rejects(tools.move_to_folder({ ...at, folder: "Elsewhere" }), /Give the ids of what to move/);
  await assert.rejects(tools.move_to_folder({ ...at, yarnIds: [hero.id] }), /needs folder/);
  await assert.rejects(tools.rename({ ...at, folder: "Chill", name: "Calm" }), /its section/);
  await assert.rejects(tools.rename({ ...at, section: "yarn", folder: "Nonesuch", name: "Calm" }), /no folder "Nonesuch" in Yarn/);

  // Made in a folder, and back to the top.
  assert.equal((await tools.create_pattern({ ...at, name: "Filed", folder: "Launch/Week 1" })).folder, "Launch/Week 1");
  assert.deepEqual((await tools.import_yarn({ ...at, text: "Spring is here", name: "Spring line", folder: "Launch" })).folder, "Launch");
  await tools.move_to_folder({ ...at, folder: "", yarnIds: [hero.id] });
  assert.deepEqual([lastCall().summary, listYarn(store, project.id).find((y) => y.id === hero.id).folder], ["Filing 1 file at the top", ""]);
});

// ── The notch.fm field report of 2026-11-05: copy brought up to date, an empty folder, which build ──

const { createCopy, getYarn } = await import("@knitted/core/node");

test("a model brings a piece of copy up to date by its id, instead of saving another beside it", async () => {
  const at = { projectId: project.id };
  const note = await tools.import_yarn({ ...at, text: "THE IMAGES ARE NOT HERE YET", name: "Status note", tags: ["note"] });
  const r = await tools.import_yarn({ ...at, yarnId: note.id, text: "All 30 images are in.", tags: ["done"] });
  assert.deepEqual([r.id, r.name, r.kind, r.tags, r.existing, r.changed], [note.id, "Status note", "copy", ["note", "done"], true, true]);
  assert.equal(getYarn(store, note.id).meta.text, "All 30 images are in.");
  assert.deepEqual(listYarn(store, project.id, { q: "Status note" }).map((y) => y.id), [note.id], "no second note beside it");
  assert.equal(lastCall().summary, "Changing the saved text \"Status note\"");
  assert.ok(store.activity(project.id).some((a) => a.action === "yarn.changed" && a.subject === "Status note" && a.actor === "model"), "the person can see it changed");
  assert.equal((await tools.import_yarn({ ...at, yarnId: note.id, text: "All 30 images are in." })).changed, false, "the same text again changes nothing");
  const moved = await tools.import_yarn({ ...at, yarnId: note.id, text: "All 30 are in, and tagged.", name: "Status", folder: "Notes" });
  assert.deepEqual([moved.id, moved.name, moved.folder, getYarn(store, note.id).meta.text], [note.id, "Status", "Notes", "All 30 are in, and tagged."]);

  // Copy the person saved changes too, and the Activity says who changed it.
  const mine = (await createCopy(store, project.id, { name: "Tagline", text: "Made by hand." })).yarn;
  assert.equal((await tools.import_yarn({ ...at, yarnId: mine.id, text: "Made by hand, edited by a model." })).changed, true);
  assert.equal(getYarn(store, mine.id).meta.text, "Made by hand, edited by a model.");
  assert.ok(store.activity(project.id).some((a) => a.action === "yarn.changed" && a.subject === "Tagline" && a.actor === "model"));

  // A file, another project's copy, and no text: each is said.
  await assert.rejects(tools.import_yarn({ ...at, yarnId: hero.id, text: "x" }), /is a file, not copy/);
  const other = store.createProject({ name: "Other copy" });
  await assert.rejects(tools.import_yarn({ projectId: other.id, yarnId: note.id, text: "x" }), /is not in this project's Yarn/);
  await assert.rejects(tools.import_yarn({ ...at, yarnId: note.id, url: "https://example.com/a.png" }), /give its yarnId with the new text/);
});

test("move_to_folder with no ids makes the folder, empty, in the section it is given", async () => {
  const at = { projectId: project.id };
  assert.deepEqual(await tools.move_to_folder({ ...at, folder: "Landing page/Reference", section: "yarn" }), { folder: "Landing page/Reference", section: "yarn" });
  assert.deepEqual([lastCall().summary, lastCall().where], ["Making the folder \"Landing page/Reference\"", { projectId: project.id, section: "yarn" }]);
  assert.deepEqual((await tools.list_folders({ ...at, section: "yarn" })).folders.filter((f) => f.path.startsWith("Landing page")), [{ path: "Landing page", items: 0 }, { path: "Landing page/Reference", items: 0 }]);
  assert.equal((await tools.move_to_folder({ ...at, folder: "landing PAGE/reference", section: "yarn" })).folder, "Landing page/Reference", "one that is there is the one returned");
  assert.equal(store.activity(project.id).filter((a) => a.action === "folder.created" && a.subject === "Landing page/Reference").length, 1, "made once, and said once");
  assert.equal((await tools.list_folders({ ...at, section: "patterns" })).folders.some((f) => f.path.startsWith("Landing page")), false, "only in that section");
  await assert.rejects(tools.move_to_folder({ ...at, folder: "Elsewhere" }), /Give the ids of what to move.*give its section/);
  await assert.rejects(tools.move_to_folder({ ...at, folder: "", section: "yarn" }), /Give the folder a name/);
});

test("get_studio_info says which knitted is answering, since when, and where its library is", async () => {
  const { readFile } = await import("node:fs/promises");
  const { version } = JSON.parse(await readFile(new URL("../apps/studio/package.json", import.meta.url), "utf8"));
  const { TOOLS } = await import("@knitted/mcp/context");
  const { READ_ONLY } = await import("@knitted/mcp/tools");
  const r = await tools.get_studio_info({});
  assert.deepEqual(Object.keys(r), ["version", "builtAt", "startedAt", "home", "toolCount"]);
  assert.deepEqual([r.version, r.builtAt, r.home, r.toolCount], [version, null, home, TOOLS.length], "from source there is no build");
  const started = Date.parse(r.startedAt);
  assert.ok(started <= Date.now() && Date.now() - started < 15 * 60_000, `startedAt is when this process started: ${r.startedAt}`);
  assert.ok(READ_ONLY.has("get_studio_info"), "it only reads, so it works while paused");
});

test("import_yarn_file copies a file on this computer in by its path, and leaves the file as it was", async () => {
  const { mkdir, readFile, symlink, writeFile } = await import("node:fs/promises");
  const at = { projectId: project.id };
  const dir = await mkdtemp(join(tmpdir(), "knitted-files-"));
  const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 20, g: 120, b: 220 } } }).png().toBuffer();
  const file = join(dir, "Landing hero.png");
  await writeFile(file, png);
  const r = await tools.import_yarn_file({ ...at, path: file, tags: ["reference"], folder: "Landing page/Reference" });
  assert.deepEqual([r.name, r.kind, r.tags, r.folder, r.existing], ["Landing hero", "image", ["reference"], "Landing page/Reference", false]);
  assert.deepEqual(await readFile(file), png, "the file on the computer is left as it was");
  assert.equal(getYarn(store, r.id).width, 64);
  assert.deepEqual([lastCall().summary, lastCall().where.yarnId], ["Bringing \"Landing hero.png\" into Yarn from this computer", r.id]);
  assert.ok(store.activity(project.id).some((a) => a.action === "yarn.imported" && a.subject === "Landing hero" && a.actor === "model"));

  // The same file again is the one there, with the new tags. A text file is copy.
  const again = await tools.import_yarn_file({ ...at, path: file, tags: ["desktop"] });
  assert.deepEqual([again.id, again.tags, again.existing], [r.id, ["reference", "desktop"], true]);
  await writeFile(join(dir, "Brief.md"), "# Spring launch\nThree posts.");
  const brief = await tools.import_yarn_file({ ...at, path: join(dir, "Brief.md") });
  assert.deepEqual([brief.kind, getYarn(store, brief.id).meta.text], ["copy", "# Spring launch\nThree posts."]);

  // What it will not read, and what it cannot, each said.
  await assert.rejects(tools.import_yarn_file({ ...at, path: "Landing hero.png" }), /whole path, from the top/);
  await mkdir(join(dir, ".ssh"));
  await writeFile(join(dir, ".ssh", "id.txt"), "secret");
  await assert.rejects(tools.import_yarn_file({ ...at, path: join(dir, ".ssh", "id.txt") }), /does not read hidden folders or files/);
  await writeFile(join(dir, ".env.txt"), "KEY=secret");
  await assert.rejects(tools.import_yarn_file({ ...at, path: join(dir, ".env.txt") }), /does not read hidden/);
  await symlink(join(dir, ".ssh", "id.txt"), join(dir, "notes.txt"));
  await assert.rejects(tools.import_yarn_file({ ...at, path: join(dir, "notes.txt") }), /does not read hidden/, "a link is checked by the file it stands for");
  await assert.rejects(tools.import_yarn_file({ ...at, path: join(dir, "nonesuch.png") }), /cannot open .* on the computer it runs on.*public address/);
  await assert.rejects(tools.import_yarn_file({ ...at, path: dir }), /is a folder, not a file/);
  await writeFile(join(dir, "data.json"), "{}");
  await assert.rejects(tools.import_yarn_file({ ...at, path: join(dir, "data.json") }), /cannot use \.json yet/);
  await writeFile(join(dir, "fake.png"), "not a picture");
  await assert.rejects(tools.import_yarn_file({ ...at, path: join(dir, "fake.png") }), /not a real PNG image/);
  assert.equal(await readFile(join(dir, "fake.png"), "utf8"), "not a picture", "a file refused is left as it was too");
  assert.ok(!listYarn(store, project.id).some((y) => /secret/.test(y.meta.text ?? "")), "nothing hidden came in");
});

// ── The Brief, and looking at files ──

// A tool's own handler, for what tools() turns into protocol content (a picture) or needs an engine for.
const { toolByName: byName } = await import("@knitted/mcp/tools");
const toolByName = () => byName;

test("a model reads the brief, writes the profile the person can undo, and is told of it with the brand", async () => {
  const at = { projectId: project.id };
  const empty = await tools.get_brief(at);
  assert.equal(empty.profile, null);
  assert.match(empty.next, /website/);
  const r = await tools.set_profile({ ...at, profile: "# Name\nHollow Oak Bakery\n\n# What they offer\nSourdough, baked daily." });
  assert.deepEqual([r.changed, r.canUndo], [true, true]);
  assert.equal(lastCall().summary, "Writing Test's profile");
  const b = await tools.get_brief(at);
  assert.match(b.profile, /^<untrusted_data source="brief:profile">\n# Name\nHollow Oak/, "what it says about the business is data");
  assert.equal(b.by, "model");
  assert.ok((await tools.get_brand_guidelines(at)).some((l) => /The Brief has a profile of the business, 10 words: read it with get_brief/.test(l)));
  await assert.rejects(tools.set_profile({ ...at, profile: "  " }), /needs something in it/);
});

test("a reference file is listed, looked at, cut from and filed apart from Yarn", async () => {
  const at = { projectId: project.id };
  // A whole web page: far taller than it is wide, red at the top and blue at the bottom.
  const tall = await sharp({ create: { width: 400, height: 3000, channels: 3, background: { r: 220, g: 30, b: 30 } } })
    .composite([{ input: await sharp({ create: { width: 400, height: 1500, channels: 3, background: { r: 30, g: 30, b: 220 } } }).png().toBuffer(), top: 1500, left: 0 }]).png().toBuffer();
  const tmp = uploadTempPath(store, project.id); mkdirSync(join(tmp, ".."), { recursive: true }); writeFileSync(tmp, tall);
  const page = (await importYarn(store, project.id, tmp, "Home.png", { name: "Home, desktop", shelf: "reference", folder: "Website/Desktop" })).yarn;
  const note = await tools.import_yarn({ ...at, text: "Closed on Mondays.", reference: true });
  assert.equal(note.name, "Note");
  assert.equal(lastCall().where.section, "reference");

  const ref = await tools.list_yarn({ ...at, reference: true });
  assert.deepEqual(ref.map((y) => y.name).sort(), ["Home, desktop", "Note"]);
  assert.ok(!(await tools.list_yarn(at)).some((y) => y.id === page.id), "Yarn's own list leaves the reference out");
  assert.deepEqual((await tools.get_brief(at)).reference.map((y) => y.name).sort(), ["Home, desktop", "Note"]);

  // Looking: the top of a long page first, and the box for the part below it.
  const top = await toolByName().view_yarn.handler({ yarnId: page.id }, { store });
  assert.equal(top.mime, "image/jpeg");
  assert.match(top.caption, /There is more below: for the next part, give box \{"x": 0, "y": 0\.2667, "w": 1, "h": 0\.2667\}/);
  const px = async (b64) => (await sharp(Buffer.from(b64, "base64")).raw().toBuffer({ resolveWithObject: true }));
  const first = await px(top.__image);
  assert.deepEqual([first.info.width, first.info.height], [400, 800]);
  assert.ok(first.data[0] > 180 && first.data[2] < 80, "the top is red");
  const low = await toolByName().view_yarn.handler({ yarnId: page.id, box: { x: 0, y: 0.75, w: 1, h: 0.25 } }, { store });
  assert.ok((await px(low.__image)).data[2] > 180, "asked for, the bottom is blue");
  assert.doesNotMatch(low.caption, /more below/);
  assert.match((await tools.view_yarn({ yarnId: note.id })).text, /Closed on Mondays/);

  // Cut from it into Yarn, where a pattern can use it; the page itself stays.
  const cut = await tools.crop_to_yarn({ yarnId: page.id, box: { x: 0, y: 0.5, w: 1, h: 0.5 }, name: "Blue band" });
  assert.deepEqual([cut.in, cut.size], ["yarn", "400x1500"]);
  assert.match(lastCall().summary, /Cutting "Blue band" out of "Home, desktop"/);
  assert.ok((await tools.list_yarn(at)).some((y) => y.id === cut.id));

  // Filed into the reference, a file leaves Yarn; and back.
  await tools.move_to_folder({ ...at, folder: "Cut outs", referenceIds: [cut.id] });
  assert.equal(getYarn(store, cut.id).shelf, "reference");
  await tools.move_to_folder({ ...at, folder: "", yarnIds: [cut.id] });
  assert.equal(getYarn(store, cut.id).shelf, "yarn");
});

test("a PDF is read a page at a time, looked at, and cut from", async () => {
  const { makePdf } = await import("../packages/core/test/fixtures/pdf.mjs");
  const tmp = uploadTempPath(store, project.id); mkdirSync(join(tmp, ".."), { recursive: true }); writeFileSync(tmp, makePdf(["Our menu", "Cakes to order"]));
  const pdf = (await importYarn(store, project.id, tmp, "Menu.pdf", { name: "Menu" })).yarn;
  assert.equal((await tools.list_yarn({ projectId: project.id, kind: "pdf" }))[0].pages, 2);
  const words = await tools.view_yarn({ yarnId: pdf.id, text: true });
  assert.match(words.text, /\[page 1\]\nOur menu[\s\S]*\[page 2\]\nCakes to order/);
  const seen = await toolByName().view_yarn.handler({ yarnId: pdf.id, page: 2 }, { store });
  assert.match(seen.caption, /Page 2 of 2\./);
  await assert.rejects(tools.view_yarn({ yarnId: pdf.id, page: 3 }), /has 2 pages/);
  const cut = await tools.crop_to_yarn({ yarnId: pdf.id, page: 1, box: { x: 0.12, y: 0.25, w: 0.48, h: 0.25 } });
  assert.equal(cut.name, "Menu, page 1");
});

test("capture_website starts a job with the Brief's own website, and says where to look", async () => {
  const { setBriefSite } = await import("@knitted/core/node");
  const asked = [];
  const engine = { startCaptureJob: (_, o) => { asked.push(o); return { id: "jb_test", status: "running" }; } };
  const tool = toolByName().capture_website;
  await assert.rejects(tool.handler({ projectId: project.id }, { store, engine }), /Give the website's url/);
  setBriefSite(store, project.id, { url: "https://hollowoak.example" });
  const r = await tool.handler({ projectId: project.id, devices: ["mobile"], maxPages: 400 }, { store, engine });
  assert.equal(r.jobId, "jb_test");
  assert.deepEqual(asked[0], { projectId: project.id, url: "https://hollowoak.example", devices: ["mobile"], maxPages: 40 });
  await assert.rejects(tool.handler({ projectId: project.id, devices: ["tablet"] }, { store, engine }), /desktop and mobile/);
});

test("the guide has a topic for each kind of task, and the instructions send a model to it", async () => {
  const { INSTRUCTIONS } = await import("../packages/mcp/src/protocol.mjs");
  const { GUIDE_TOPICS } = await import("../packages/mcp/src/guide.mjs");
  assert.match(INSTRUCTIONS, /get_guide/);
  assert.match(await tools.get_guide({}), /^# Working in knitted/);
  const motion = await tools.get_guide({ topic: "motion" });
  assert.match(motion, /type-on types one character at a time/);
  assert.match(motion, /Other topics: start, patterns/);
  for (const t of GUIDE_TOPICS) assert.ok((await tools.get_guide({ topic: t })).length > 200, `${t} says something`);
  // Every tool a topic names is a real tool, so the guide cannot send a model to one that is gone.
  const names = new Set(Object.keys(tools));
  for (const t of GUIDE_TOPICS) for (const m of (await tools.get_guide({ topic: t })).matchAll(/\b([a-z]+_[a-z_]+)\b/g)) {
    if (/^(list|get|set|create|import|view|crop|tag|fill|add|update|remove|apply|insert|propose|read|capture|describe|duplicate|preview|check|knit|cancel|move|synthesize)_/.test(m[1])) assert.ok(names.has(m[1]), `${t} names ${m[1]}, which is a tool`);
  }
});

test("list_knits pages through every knit, and marks the ones made before their pattern was last saved", async () => {
  // It stopped at 30 with no way on, and 173 knits were on disk; a fixed pattern's old knit looked current.
  const { insertKnit } = await import("@knitted/core/node");
  const p = store.createPattern(project.id, { name: "Paged", size: { name: "Square", w: 1080, h: 1080 }, stitches: [] });
  const made = Array.from({ length: 5 }, (_, i) => insertKnit(store, { projectId: project.id, patternId: p.id, patternName: "Paged", jobId: null, batchId: null, label: `Paged ${i}`, file: `x/paged-${i}.png`, kind: "image", format: "png", width: 10, height: 10, bytes: 1, durationMs: null, hash: `paged-${i}`, report: {} }));
  const first = await tools.list_knits({ patternId: p.id, limit: 2 });
  assert.equal(first.total, 5);
  const pages = [first, await tools.list_knits({ projectId: project.id, patternId: p.id, limit: 2, offset: 2 }), await tools.list_knits({ projectId: project.id, patternId: p.id, limit: 2, offset: 4 })];
  assert.deepEqual(pages.flatMap((x) => x.knits.map((k) => k.id)).sort(), made.map((k) => k.id).sort(), "every knit once across the pages");
  assert.ok(first.knits.every((k) => !k.patternChangedSince && k.pattern === "Paged"));
  await new Promise((r) => setTimeout(r, 5));
  store.apply(p.id, { type: "setMeta", durationMs: 2000 }, "model");
  assert.ok((await tools.list_knits({ projectId: project.id, patternId: p.id })).knits.every((k) => k.patternChangedSince), "the pattern was saved after them");
});

test("a model tags a knit and writes what goes with it, with a track from the project's own audio", async () => {
  const { insertKnit, getKnit } = await import("@knitted/core/node");
  const k = insertKnit(store, { projectId: project.id, patternId: pattern.id, patternName: "Story", jobId: null, batchId: null, label: "Story", file: "x/story.png", kind: "image", format: "png", width: 10, height: 10, bytes: 1, durationMs: null, hash: "mcp-post", report: {} });
  assert.deepEqual((await tools.tag_knit({ knitId: k.id, tags: ["launch", " launch ", "spring"] })).tags, ["launch", "spring"]);
  const r = await tools.set_knit_post({ knitId: k.id, caption: "Spring is here.", hashtags: ["spring", "#Bakery"] });
  assert.deepEqual(r.post.hashtags, ["#spring", "#Bakery"]);
  assert.equal(getKnit(store, k.id).post.by, "model");
  const listed = (await tools.list_knits({ projectId: project.id })).knits.find((x) => x.id === k.id);
  assert.equal(listed.caption, "Spring is here.");
  assert.deepEqual(listed.tags, ["launch", "spring"]);
  assert.equal(listed.seen, false);
  // A picture is not a track.
  await assert.rejects(tools.set_knit_post({ knitId: k.id, audioId: hero.id }), /not a sound in this knit's project/);
  assert.equal((await tools.set_knit_post({ knitId: k.id, audioId: "" })).post.audioId, null);
});

test("synthesize_voiceover waits for its job and get_job can wait, so a model never polls on the person's key", async () => {
  // Real asks spent 41 of 59 calls on get_job, each re-reading the whole conversation.
  const job = store.createJob("tts", project.id, { patternId: pattern.id, lines: 2 });
  const engine = { startVoiceJob: (_, o) => {
    setTimeout(() => store.updateJob(job.id, { status: "done", progress: { total: 2, done: 2, units: [{ label: o.lines[0].say, status: "done", issues: [{ level: "warning", code: "voice-joined", message: "Lines 1 to 2 are one clip" }] }] }, result: { clips: 1, spoken: [{ text: "filefreak sites rollback 3", startMs: 500, endMs: 1900 }] } }), 400);
    return store.getJob(job.id);
  } };
  const t = toolByName();
  const r = await t.synthesize_voiceover.handler({ patternId: pattern.id, lines: [{ say: "Roll it back from the terminal", show: "filefreak sites rollback 3" }, "Live again."] }, { store, engine });
  assert.equal(r.status, "done");
  assert.deepEqual(r.lines, [{ text: "filefreak sites rollback 3", startMs: 500, endMs: 1900 }], "the caption shows the command; the voice said what it does");
  assert.deepEqual(r.issues, ["Lines 1 to 2 are one clip"]);
  const later = store.createJob("knit", project.id, {});
  setTimeout(() => store.updateJob(later.id, { status: "done", result: { knitIds: [] } }), 300);
  const t0 = Date.now();
  const g = await t.get_job.handler({ jobId: later.id, waitSeconds: 5 }, { store });
  assert.equal(g.status, "done");
  assert.ok(Date.now() - t0 < 3000, "it answers when the job ends, not when the wait runs out");
});
