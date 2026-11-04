import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { ValidationError, assertPublicUrl, createCopy, deleteYarn, importYarn, importYarnFromUrl, listYarn, openStore, purgeDeletedYarn, undeleteYarn, updateYarn, uploadTempPath, yarnPath, yarnPicturePath, yarnUsage } from "../src/node.ts";
import { sanitiseSvg } from "../src/svg.ts";

const dir = mkdtempSync(join(tmpdir(), "knitted-yarn-"));
const store = openStore(join(dir, "k.db"));
const project = store.createProject({ name: "Yarn tests", starter: "social" });
const scratch = mkdtempSync(join(tmpdir(), "knitted-src-"));

/** Put bytes where an upload would have landed, then import them as `name`. */
async function imp(name, data, opts) {
  const tmp = uploadTempPath(store, project.id);
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(tmp, ".."), { recursive: true });
  writeFileSync(tmp, data);
  return { tmp, result: await importYarn(store, project.id, tmp, name, opts) };
}
const png = (w, h, color = { r: 223, g: 90, b: 15 }) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const haveFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();

test("a PNG becomes Yarn with real dimensions, a thumbnail and its dominant colour", async () => {
  const { result } = await imp("Hero shot.png", await png(1200, 800));
  const y = result.yarn;
  assert.equal(y.kind, "image");
  assert.equal(y.name, "Hero shot");
  assert.deepEqual([y.width, y.height], [1200, 800]);
  assert.ok(existsSync(yarnPath(store, y)));
  assert.ok(existsSync(join(store.paths.yarnDir(project.id), ".thumbs", y.meta.thumb)));
  assert.equal(y.meta.colors[0], "#df5a0f", "the one colour in the image is the dominant colour");
  assert.equal(y.file, `${y.id}.png`, "stored under its id, so renaming never touches the disk");
});

test("the temp file is gone after a successful import", async () => {
  const { tmp } = await imp("tmpcheck.png", await png(700, 700, { r: 1, g: 2, b: 3 }));
  assert.equal(existsSync(tmp), false);
});

test("uploading identical bytes again returns the existing Yarn, not a duplicate", async () => {
  const data = await png(900, 900, { r: 10, g: 200, b: 30 });
  const a = await imp("a.png", data);
  const b = await imp("b-same-bytes.png", data);
  assert.equal(b.result.existing, true);
  assert.equal(b.result.yarn.id, a.result.yarn.id);
  assert.equal(existsSync(b.tmp), false, "the duplicate's temp file is cleaned up");
});

test("a text file renamed to .png is refused, in plain words, and leaves nothing behind", async () => {
  const before = readdirSync(store.paths.yarnDir(project.id)).length;
  const tmp = uploadTempPath(store, project.id);
  const { mkdirSync } = await import("node:fs"); mkdirSync(join(tmp, ".."), { recursive: true });
  writeFileSync(tmp, "this is not an image");
  await assert.rejects(importYarn(store, project.id, tmp, "fake.png"), (e) => e instanceof ValidationError && /not a real PNG/.test(e.message));
  assert.equal(existsSync(tmp), false);
  assert.equal(readdirSync(store.paths.yarnDir(project.id)).length, before);
});

test("an unsupported type says what IS supported", async () => {
  await assert.rejects(imp("thing.exe", Buffer.from("MZ")), /cannot use \.exe yet/);
});

test("an empty file is refused", async () => {
  await assert.rejects(imp("empty.png", Buffer.alloc(0)), /empty/);
});

test("a file over the limit is refused with the number and the fix", async () => {
  await assert.rejects(imp("big.png", await png(800, 800, { r: 9, g: 9, b: 9 }), { maxBytes: 100 }), /limit is/);
});

test("a small logo gets the theme's own message", async () => {
  const { result } = await imp("acme-logo.png", await png(400, 400, { r: 5, g: 5, b: 200 }));
  assert.match(result.yarn.meta.warnings[0], /That logo is 400px wide\. Upload one at least 1000px wide to print sharp\./);
});

// ── SVG is code ─────────────────────────────────────────────────────────────
const VECTORS = [
  `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="9" height="9"/></svg>`,
  `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="9" height="9"/></svg>`,
  `<svg xmlns="http://www.w3.org/2000/svg"><rect width="9" height="9" onclick="alert(1)"/></svg>`,
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="javascript:alert(1)"><rect width="9" height="9"/></a></svg>`,
  `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="https://evil.example"></iframe></foreignObject></svg>`,
  `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/track.png" width="9" height="9"/></svg>`,
  `<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.example/x.css); rect{fill:url(https://evil.example/f)}</style><rect width="9" height="9"/></svg>`,
  `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>`,
];
test("known SVG attack vectors are all neutralised by the sanitiser", () => {
  for (const v of VECTORS) {
    const { svg, changed } = sanitiseSvg(v);
    assert.equal(changed, true, `not detected: ${v}`);
    assert.doesNotMatch(svg, /<script|onload|onclick|javascript:|foreignObject|<iframe|evil\.example|<!ENTITY|file:\/\//i, `survived: ${v}\n=> ${svg}`);
  }
});
test("a clean SVG passes through untouched", () => {
  const clean = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M1 1L5 5"/><use href="#a"/></svg>`;
  assert.equal(sanitiseSvg(clean).changed, false);
});
test("an uploaded hostile SVG is stored clean, renders as an image, and the user is told", async () => {
  const { result } = await imp("evil.svg", Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" onload="alert(1)"><script>alert(1)</script><rect width="100" height="100" fill="red"/></svg>`));
  const stored = readFileSync(yarnPath(store, result.yarn), "utf8");
  assert.doesNotMatch(stored, /script|onload/);
  assert.match(result.yarn.meta.warnings[0], /removed from this SVG/);
  assert.deepEqual([result.yarn.width, result.yarn.height], [100, 100]);
});

test("a font's family comes from its tables, not its filename", async () => {
  const f = join(process.cwd(), "node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff");
  const { result } = await imp("final-FINAL2.woff", readFileSync(f));
  assert.equal(result.yarn.kind, "font");
  assert.equal(result.yarn.meta.family, "Instrument Serif");
});
// Field report 2: woff2 is what Google Fonts serves, under a hash for a filename, and its
// family used to come from that filename, so a swatch asking for the font never found it.
test("a woff2 font's family comes from its tables too, whatever the file is called", async () => {
  const font = (f) => readFileSync(join(process.cwd(), "packages/fonts/files", f));
  const { result } = await imp("2V0cKI0OB5U7WaJCxne5blYKArHM.woff2", font("instrument-serif-latin-400-italic.woff2"));
  assert.deepEqual([result.yarn.kind, result.yarn.meta.family, result.yarn.meta.weight], ["font", "Instrument Serif", 400]);
  // A variable font's name carries its default weight; the family is every weight of it.
  assert.equal((await imp("archivo-latin-wght-normal.woff2", font("archivo-latin-wght-normal.woff2"))).result.yarn.meta.family, "Archivo");
  assert.equal((await imp("b.woff2", font("bricolage-grotesque-latin-wght-normal.woff2"))).result.yarn.meta.family, "Bricolage Grotesque");
  // One whose tables will not open is still a font, and goes by the name it was given.
  const broken = Buffer.concat([font("bebas-neue-latin-400-normal.woff2").subarray(0, 60), Buffer.alloc(64)]);
  assert.equal((await imp("2V0cKI0OB5U7WaJCxne5blYKArHM.woff2", broken, { name: "Chango" })).result.yarn.meta.family, "Chango");
});
test("random bytes named .ttf are not a font", async () => {
  await assert.rejects(imp("fake.ttf", Buffer.from("not a font at all, definitely")), /not a font/);
});

test("copy is stored as text and reusable", async () => {
  const { yarn } = await createCopy(store, project.id, { name: "Launch headlines", text: "Make it knitted.\nPattern once." });
  assert.equal(yarn.kind, "copy");
  assert.match(yarn.meta.text, /Pattern once/);
  await assert.rejects(createCopy(store, project.id, { name: "x", text: "   " }), /Write some copy/);
});

test("video and audio are probed, with a poster frame and a waveform", { skip: !haveFfmpeg }, async () => {
  const v = join(scratch, "clip.mp4"), a = join(scratch, "tone.wav");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", v]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=1.5", a]);
  const vid = (await imp("clip.mp4", readFileSync(v))).result.yarn;
  assert.equal(vid.kind, "video");
  assert.ok(Math.abs(vid.durationMs - 2000) < 150, `duration ${vid.durationMs}`);
  assert.deepEqual([vid.width, vid.height], [320, 240]);
  assert.equal(vid.meta.hasAudio, true);
  assert.ok(existsSync(join(store.paths.yarnDir(project.id), ".thumbs", vid.meta.thumb)));
  const aud = (await imp("tone.wav", readFileSync(a))).result.yarn;
  assert.equal(aud.kind, "audio");
  assert.ok(Math.abs(aud.durationMs - 1500) < 150);
  assert.ok(aud.meta.peaks.length > 20 && Math.max(...aud.meta.peaks) > 0.05, "a real waveform, not silence");
});
test("a text file named .mp4 is not video", { skip: !haveFfmpeg }, async () => {
  await assert.rejects(imp("fake.mp4", Buffer.from("hello")), /could not be read as video/);
});

test("rename and tags change the record, never the file", async () => {
  const { result } = await imp("rename-me.png", await png(800, 800, { r: 77, g: 77, b: 7 }));
  const before = readFileSync(yarnPath(store, result.yarn));
  const y = updateYarn(store, result.yarn.id, { name: "Better name", tags: ["Logo", "  Brand ", "logo", "!!bad!!"] });
  assert.equal(y.name, "Better name");
  assert.deepEqual(y.tags, ["logo", "brand", "bad"]);
  assert.deepEqual(readFileSync(yarnPath(store, y)), before);
  assert.equal(listYarn(store, project.id, { tag: "brand" }).length, 1);
  assert.ok(listYarn(store, project.id, { q: "better" }).some((x) => x.id === y.id));
});

test("replacing a file keeps the id, so every use updates", async () => {
  const first = (await imp("swap.png", await png(800, 800, { r: 1, g: 1, b: 1 }))).result.yarn;
  const tmp = uploadTempPath(store, project.id);
  writeFileSync(tmp, await png(1000, 500, { r: 250, g: 250, b: 250 }));
  const { yarn } = await importYarn(store, project.id, tmp, "swap2.png", { replaceId: first.id });
  assert.equal(yarn.id, first.id);
  assert.deepEqual([yarn.width, yarn.height], [1000, 500]);
  assert.notEqual(yarn.hash, first.hash);
});

test("usage lists the patterns a piece of Yarn is in; deleting is undoable; purge removes the file", async () => {
  const y = (await imp("used.png", await png(800, 800, { r: 9, g: 99, b: 199 }))).result.yarn;
  const pat = store.listPatterns(project.id)[0];
  store.apply(pat.id, { type: "updateStitch", id: pat.stitches.find((s) => s.slot === "backdrop").id, patch: { yarnId: y.id } }, "human");
  assert.deepEqual(yarnUsage(store, y.id).map((u) => u.patternId), [pat.id]);
  deleteYarn(store, y.id);
  assert.equal(listYarn(store, project.id).some((x) => x.id === y.id), false);
  undeleteYarn(store, y.id);
  assert.ok(listYarn(store, project.id).some((x) => x.id === y.id), "undo brings it back");
  deleteYarn(store, y.id);
  assert.equal(await purgeDeletedYarn(store, -1), 1);
  assert.equal(existsSync(yarnPath(store, y)), false);
});

test("the project's yarn count ignores deleted yarn", async () => {
  const p2 = store.createProject({ name: "Counts" });
  const tmp = uploadTempPath(store, p2.id);
  const { mkdirSync } = await import("node:fs"); mkdirSync(join(tmp, ".."), { recursive: true });
  writeFileSync(tmp, await png(800, 800, { r: 3, g: 3, b: 3 }));
  const { yarn } = await importYarn(store, p2.id, tmp, "c.png");
  assert.equal(store.listProjects().find((p) => p.id === p2.id).counts.yarn, 1);
  deleteYarn(store, yarn.id);
  assert.equal(store.listProjects().find((p) => p.id === p2.id).counts.yarn, 0);
});

// ── URL import must not be a way into the user's own network ────────────────
test("URL import refuses loopback, private, link-local and non-http addresses", async () => {
  for (const bad of ["http://127.0.0.1/a.png", "http://localhost/a.png", "http://10.0.0.5/a.png", "http://192.168.1.1/a.png", "http://169.254.169.254/latest/meta-data", "http://[::1]/a.png", "http://172.16.0.1/a.png", "file:///etc/passwd", "ftp://example.com/a.png", "javascript:alert(1)", "not a url"]) {
    await assert.rejects(assertPublicUrl(bad), ValidationError, `should refuse ${bad}`);
  }
});
test("importing from a local server is refused end to end", async () => {
  const srv = createServer((_, res) => res.end("x")).listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  try { await assert.rejects(importYarnFromUrl(store, project.id, `http://127.0.0.1:${srv.address().port}/a.png`), /your own computer or network/); }
  finally { srv.close(); }
});

// ── URL import that works ───────────────────────────────────────────────────
// The guard above refuses every address a test could serve from, so these answer
// from a stand-in for fetch instead. The address is a public one (203.0.113.0/24, kept
// for documentation, so nothing real is behind it): the guard runs as it does for anyone.
async function fromLink(url, answer, opts) {
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u, init) => { asked.push(String(u)); return answer(String(u), init); };
  try { return { asked, result: await importYarnFromUrl(store, project.id, url, opts) }; }
  finally { globalThis.fetch = real; }
}
const leftovers = () => { const d = join(store.paths.yarnDir(project.id), ".tmp"); return existsSync(d) ? readdirSync(d).length : 0; };

test("a picture from a link becomes Yarn, streamed to disk", async () => {
  const body = await png(640, 480, { r: 20, g: 120, b: 200 });
  const { result } = await fromLink("https://203.0.113.7/brand/Hero%20photo.png", () => new Response(body, { headers: { "content-type": "image/png", "content-length": String(body.length) } }));
  assert.equal(result.yarn.kind, "image");
  assert.equal(result.yarn.name, "Hero photo");
  assert.deepEqual([result.yarn.width, result.yarn.height], [640, 480]);
  assert.ok(existsSync(yarnPath(store, result.yarn)));
});

test("a link without a file extension is named from what the server says it sent", async () => {
  const body = await png(64, 64, { r: 200, g: 20, b: 20 });
  const { result } = await fromLink("https://203.0.113.7/download?id=42", () => new Response(body, { headers: { "content-type": "image/png; charset=binary" } }));
  assert.equal(result.yarn.kind, "image");
  assert.equal(result.yarn.mime, "image/png");
});

test("a redirect is followed only to another public address", async () => {
  const body = await png(32, 32);
  const { asked, result } = await fromLink("https://203.0.113.7/old.png", (u) => (u.endsWith("/old.png")
    ? new Response(null, { status: 301, headers: { location: "https://203.0.113.8/new.png" } })
    : new Response(body, { headers: { "content-type": "image/png" } })));
  assert.deepEqual(asked, ["https://203.0.113.7/old.png", "https://203.0.113.8/new.png"]);
  assert.equal(result.yarn.kind, "image");
  await assert.rejects(fromLink("https://203.0.113.7/sneaky.png", () => new Response(null, { status: 302, headers: { location: "http://192.168.1.1/router.png" } })), /your own computer or network/);
});

test("a file bigger than the limit is refused, whether or not the server says its size", async () => {
  const body = await png(256, 256);
  await assert.rejects(fromLink("https://203.0.113.7/big.png", () => new Response(body, { headers: { "content-length": String(body.length) } }), { maxBytes: 100 }), /too large/);
  // No size given: it is counted as it streams, and the part already written is removed.
  const before = leftovers();
  await assert.rejects(fromLink("https://203.0.113.7/big.png", () => new Response(new Blob([body]).stream(), { headers: { "content-type": "image/png" } }), { maxBytes: 100 }), /too large/);
  assert.equal(leftovers(), before);
});

// ── A project's picture, on its card ────────────────────────────────────────
test("a project's picture is one of its own images, and its card in the list gets it", async () => {
  const p = store.createProject({ name: "Pictured" });
  const tmp = uploadTempPath(store, p.id);
  (await import("node:fs")).mkdirSync(join(tmp, ".."), { recursive: true });
  writeFileSync(tmp, await png(2000, 1500, { r: 20, g: 120, b: 200 }));
  const { yarn: y } = await importYarn(store, p.id, tmp, "Cover.png");
  assert.equal(store.listProjects().find((x) => x.id === p.id).cover, null);
  store.updateProject(p.id, { coverYarnId: y.id });
  assert.deepEqual(store.listProjects().find((x) => x.id === p.id).cover, { id: y.id, hash: y.hash });
  assert.ok(store.activity(p.id).some((a) => a.action === "project.picture"), "who changed it is in the activity");

  deleteYarn(store, y.id);
  assert.equal(store.listProjects().find((x) => x.id === p.id).cover, null, "a deleted file is not a picture");
  undeleteYarn(store, y.id);
  assert.deepEqual(store.listProjects().find((x) => x.id === p.id).cover, { id: y.id, hash: y.hash }, "and undoing the delete brings it back");

  const { yarn: words } = await createCopy(store, p.id, { name: "Tagline", text: "Make it knitted." });
  assert.throws(() => store.updateProject(p.id, { coverYarnId: words.id }), /image or a video/);
  const { result } = await imp("Someone else's.png", await png(300, 300));
  assert.throws(() => store.updateProject(p.id, { coverYarnId: result.yarn.id }), /not in this project/, "another project's image is not this one's picture");
  store.updateProject(p.id, { coverYarnId: null });
  assert.equal(store.listProjects().find((x) => x.id === p.id).cover, null);
});

test("the card's picture is made once from the original, 960 pixels at most, and never enlarged", async () => {
  const { result: big } = await imp("Big.png", await png(2000, 1500, { r: 1, g: 2, b: 3 }));
  const first = await yarnPicturePath(store, big.yarn);
  assert.deepEqual(Object.values((({ width, height }) => ({ width, height }))(await sharp(first).metadata())), [960, 720]);
  const made = statSync(first).mtimeMs;
  assert.equal(await yarnPicturePath(store, big.yarn), first);
  assert.equal(statSync(first).mtimeMs, made, "the second ask is served from the first");
  const { result: small } = await imp("Small.png", await png(400, 300, { r: 4, g: 5, b: 6 }));
  assert.equal((await sharp(await yarnPicturePath(store, small.yarn)).metadata()).width, 400);
  const { yarn: words } = await createCopy(store, project.id, { name: "No picture", text: "Words only." });
  assert.equal(await yarnPicturePath(store, words), null, "copy has nothing to show");
});
