import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DownloadError, cacheKey, downloadFile, durationOf, estimateWords, openaiCompatible, providerFromSettings, speak, system } from "../src/index.mjs";

const dir = mkdtempSync(join(tmpdir(), "knitted-voice-"));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const wav = join(dir, "tone.wav");
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5", "-ac", "1", "-ar", "24000", wav]);

/** A tiny file server that honours Range, counts bytes, and can be told to misbehave. */
function serve(body, { ignoreRange = false, status } = {}) {
  const stats = { sent: 0, ranges: [] };
  const server = createServer((req, res) => {
    if (status) { res.statusCode = status; return res.end("nope"); }
    const m = /bytes=(\d+)-/.exec(req.headers.range ?? "");
    if (m && !ignoreRange) { const s = Number(m[1]); stats.ranges.push(s); res.statusCode = 206; res.setHeader("content-range", `bytes ${s}-${body.length - 1}/${body.length}`); res.setHeader("content-length", body.length - s); stats.sent += body.length - s; return res.end(body.subarray(s)); }
    res.setHeader("content-length", body.length); stats.sent += body.length; res.end(body);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${server.address().port}/f`, stats, close: () => server.close() })));
}

test("a download is verified against its checksum before it is moved into place", async () => {
  const body = Buffer.alloc(200_000, 7);
  const s = await serve(body);
  const dest = join(dir, "ok.bin");
  const r = await downloadFile(s.url, dest, { sha256: sha(body) });
  assert.equal(r.bytes, body.length);
  assert.deepEqual(readFileSync(dest), body);
  assert.equal(existsSync(`${dest}.part`), false);
  s.close();
});

test("a download that does not match its checksum is thrown away, never kept", async () => {
  const s = await serve(Buffer.alloc(5000, 1));
  const dest = join(dir, "bad.bin");
  await assert.rejects(downloadFile(s.url, dest, { sha256: sha(Buffer.from("something else")) }), (e) => e instanceof DownloadError && e.kind === "checksum" && /did not match its checksum/.test(e.message));
  assert.equal(existsSync(dest), false);
  assert.equal(existsSync(`${dest}.part`), false);
  s.close();
});

test("a partial download RESUMES from where it stopped instead of starting over", async () => {
  const body = Buffer.from(Array.from({ length: 100_000 }, (_, i) => i % 251));
  const s = await serve(body);
  const dest = join(dir, "resume.bin");
  writeFileSync(`${dest}.part`, body.subarray(0, 60_000));
  const r = await downloadFile(s.url, dest, { sha256: sha(body) });
  assert.deepEqual(readFileSync(dest), body);
  assert.deepEqual(s.stats.ranges, [60_000], "asked for only the rest");
  assert.equal(s.stats.sent, 40_000, "and only the rest was sent");
  void r; s.close();
});

test("a server that ignores Range cannot corrupt a resume: it restarts cleanly", async () => {
  const body = Buffer.alloc(50_000, 9);
  const s = await serve(body, { ignoreRange: true });
  const dest = join(dir, "norange.bin");
  writeFileSync(`${dest}.part`, Buffer.alloc(10_000, 1));
  await downloadFile(s.url, dest, { sha256: sha(body) });
  assert.deepEqual(readFileSync(dest), body);
  s.close();
});

test("progress is reported with real byte counts", async () => {
  const body = Buffer.alloc(300_000, 3); const s = await serve(body);
  const seen = [];
  await downloadFile(s.url, join(dir, "prog.bin"), { onProgress: (d, t) => seen.push([d, t]) });
  assert.ok(seen.length > 0);
  assert.deepEqual(seen.at(-1), [300_000, 300_000]);
  s.close();
});

test("a missing file and an unreachable host both say what to do", async () => {
  const s = await serve(Buffer.alloc(1), { status: 404 });
  await assert.rejects(downloadFile(s.url, join(dir, "x")), /answered 404/);
  s.close();
  await assert.rejects(downloadFile("http://127.0.0.1:1/x", join(dir, "y")), /Could not reach 127\.0\.0\.1:1/);
});

// ── the OpenAI-compatible provider ──────────────────────────────────────────
function speechServer({ status = 200 } = {}) {
  const calls = [];
  const server = createServer(async (req, res) => {
    let b = ""; for await (const c of req) b += c;
    calls.push({ url: req.url, auth: req.headers.authorization, body: b ? JSON.parse(b) : null });
    if (status !== 200) { res.statusCode = status; return res.end("denied"); }
    res.setHeader("content-type", "audio/wav"); res.end(readFileSync(wav));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ base: `http://127.0.0.1:${server.address().port}`, calls, close: () => server.close() })));
}

test("the OpenAI-compatible provider speaks the standard request and writes the audio", async () => {
  const s = await speechServer();
  const p = openaiCompatible({ baseUrl: s.base + "/", apiKey: "k-123", model: "kokoro" });
  const out = join(dir, "o.wav");
  await p.synthesize({ text: "Hello there", voice: "af_heart", speed: 1.1, out });
  assert.equal(s.calls[0].url, "/v1/audio/speech");
  assert.equal(s.calls[0].auth, "Bearer k-123");
  assert.deepEqual(s.calls[0].body, { model: "kokoro", input: "Hello there", voice: "af_heart", speed: 1.1, response_format: "wav" });
  assert.ok(await durationOf(out) > 1000);
  s.close();
});

test("provider failures are one-line fixes: wrong key, dead server, no address", async () => {
  const denied = await speechServer({ status: 401 });
  await assert.rejects(openaiCompatible({ baseUrl: denied.base }).synthesize({ text: "x", out: join(dir, "a.wav") }), /rejected your key/);
  denied.close();
  await assert.rejects(openaiCompatible({ baseUrl: "http://127.0.0.1:1" }).synthesize({ text: "x", out: join(dir, "b.wav") }), /Could not reach 127\.0\.0\.1:1\. Is your voice server running\?/);
  await assert.rejects(openaiCompatible({}).synthesize({ text: "x", out: join(dir, "c.wav") }), /Add your voice server's address/);
});

// ── timings and caching ─────────────────────────────────────────────────────
test("word timings add up to the line's real length, in order, longer words taking longer", () => {
  const w = estimateWords("Make it knitted, today", 4000, 1000);
  assert.equal(w.length, 4);
  assert.equal(w[0].startMs, 1000);
  assert.ok(Math.abs(w.at(-1).endMs - 5000) <= 1, "ends where the line ends");
  for (let i = 1; i < w.length; i++) assert.ok(w[i].startMs >= w[i - 1].endMs - 1);
  assert.ok(w[2].endMs - w[2].startMs > w[1].endMs - w[1].startMs, '"knitted," outlasts "it"');
  assert.deepEqual(estimateWords("   ", 1000), []);
});

test("speaking caches by everything that changes the sound: same line twice synthesises once", async () => {
  let n = 0;
  const provider = { id: "fake", async synthesize({ out }) { n++; writeFileSync(out, readFileSync(wav)); } };
  const cacheDir = join(dir, "cache");
  const a = await speak(provider, { text: "Same line", voice: "v", cacheDir });
  const b = await speak(provider, { text: "Same line", voice: "v", cacheDir });
  assert.equal(n, 1); assert.equal(b.cached, true); assert.equal(a.file, b.file);
  await speak(provider, { text: "Same line", voice: "other", cacheDir });
  assert.equal(n, 2, "a different voice is a different sound");
  assert.notEqual(cacheKey({ text: "a", provider: "p", speed: 1 }), cacheKey({ text: "a", provider: "p", speed: 1.2 }));
  await assert.rejects(speak(provider, { text: "  ", cacheDir }), /nothing to say/);
  await assert.rejects(speak(provider, { text: "x".repeat(4001), cacheDir }), /too long/);
});

test("settings choose the provider, and the built-in voice is the default", () => {
  assert.equal(providerFromSettings({}).id, "system");
  assert.equal(providerFromSettings({ provider: "openai", baseUrl: "http://x" }).id, "openai");
  assert.equal(providerFromSettings({ provider: "piper" }).id, "piper");
});

test("the built-in voice really speaks on this machine", { skip: process.platform !== "darwin" }, async () => {
  assert.equal(await system.available(), true);
  const r = await speak(system, { text: "Make it knitted.", voice: "default", cacheDir: join(dir, "sys") });
  assert.ok(r.durationMs > 600 && r.durationMs < 5000, `a real utterance: ${r.durationMs}ms`);
  assert.ok((await system.voices()).length > 5);
});
