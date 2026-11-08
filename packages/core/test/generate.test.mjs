import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { estimateCost, openaiCost } from "../src/index.ts";
import { importYarn, openStore, planGeneration, runGeneration, setGenChoice, setSpendLimits, startGeneration, testGenKey, uploadTempPath, usageSummary } from "../src/node.ts";

const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-gen-")), "k.db"));
const p = store.createProject({ name: "Cafe" });
const BASE = "http://fake.test";
const png = async (r, g, b) => sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g, b } } }).png().toBuffer();
const haveFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();

/** A stand-in for the providers: answers by host and path, and writes down what was asked. */
function fake(routes) {
  const asked = [];
  const f = async (url, init = {}) => {
    const u = new URL(url);
    const [host, ...rest] = u.pathname.slice(1).split("/");
    const at = { host, path: `/${rest.join("/")}`, q: u.searchParams, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null, method: init.method ?? "GET" };
    asked.push(at);
    const r = await routes(at);
    if (r instanceof Response) return r;
    if (Buffer.isBuffer(r)) return new Response(r, { headers: { "content-type": "video/mp4" } });
    return r === undefined ? Response.json({ error: { message: "no such thing" } }, { status: 404 }) : Response.json(r);
  };
  f.asked = asked;
  return f;
}
const keys = (have) => async (provider) => have[provider] ?? null;
const ref = await (async () => {
  const tmp = uploadTempPath(store, p.id);
  mkdirSync(join(tmp, ".."), { recursive: true });
  writeFileSync(tmp, await png(244, 163, 64));
  return (await importYarn(store, p.id, tmp, "Sunny.png", {})).yarn;
})();

test("with no key, it says which key to add; with one, that provider makes it, at its price", async () => {
  await assert.rejects(planGeneration(store, { kind: "image", prompt: "a latte" }, { key: keys({}) }), /needs an OpenAI or Google Gemini key/);
  await assert.rejects(planGeneration(store, { kind: "video", prompt: "a wave" }, { key: keys({ openai: "k" }) }), /needs a Google Gemini key/);
  const g = await planGeneration(store, { kind: "image", prompt: "a latte", count: 2 }, { key: keys({ google: "k" }) });
  assert.deepEqual([g.provider, g.model, g.count, g.aspect, g.quality], ["google", "gemini-nano-banana-2.1", 2, "1:1", "good"]);
  assert.equal(Math.round(g.cost * 10000), 1008, "2 at 2K, 5.04 cents each");
  assert.match(g.say, /^two square photos, good quality, with Nano Banana 2\.1, for about \$0\.10$/);
  const v = await planGeneration(store, { kind: "video", prompt: "a wave", seconds: 8 }, { key: keys({ google: "k" }) });
  assert.equal(Math.round(v.cost * 100), 56, "8 seconds at 720p");
  assert.equal(v.aspect, "9:16");
  await assert.rejects(planGeneration(store, { kind: "video", prompt: "a wave", aspect: "1:1" }, { key: keys({ google: "k" }) }), /9:16 or 16:9/);
  await assert.rejects(planGeneration(store, { kind: "image", prompt: "a cut-out", transparent: true }, { key: keys({ google: "k" }) }), /see-through background comes from OpenAI/);
  await assert.rejects(planGeneration(store, { kind: "image", prompt: "   " }, { key: keys({ google: "k" }) }), /Say what to make/);
});

test("the choice in Settings is the one used, and a model it does not have is refused", async () => {
  setGenChoice(store, { image: { provider: "openai", model: "gpt-image-2.6-sunburst" } });
  const o = await planGeneration(store, { kind: "image", prompt: "a latte", aspect: "4:5" }, { key: keys({ google: "k", openai: "k" }) });
  assert.deepEqual([o.provider, o.model], ["openai", "gpt-image-2.6-sunburst"]);
  await assert.rejects(planGeneration(store, { kind: "image", prompt: "a latte" }, { key: keys({ google: "k" }) }), /OpenAI needs your key first/);
  assert.throws(() => setGenChoice(store, { video: { provider: "openai", model: "sora-2" } }), /no video model called sora-2/);
  setGenChoice(store, { image: null });
});

test("a monthly limit with too little left stops it before anything is asked", async () => {
  setSpendLimits(store, { monthly: 0.05 });
  await assert.rejects(planGeneration(store, { kind: "image", prompt: "a latte", count: 4 }, { key: keys({ google: "k" }) }), /would cost about \$0\.20, and your monthly limit has \$0\.05 left/);
  setSpendLimits(store, { monthly: null });
});

test("OpenAI: from pictures goes to edits as data addresses, the key only in its header, and the cost is what it used", async () => {
  const a = await png(10, 120, 200), b = await png(200, 40, 90);
  const f = fake(({ host, path }) => host === "api.openai.com" && path === "/v1/images/edits"
    ? { data: [{ b64_json: a.toString("base64") }, { b64_json: b.toString("base64") }], usage: { input_tokens: 1300, input_tokens_details: { image_tokens: 1200, text_tokens: 100 }, output_tokens: 4000 } }
    : undefined);
  const deps = { fetch: f, key: keys({ openai: "sk-test-123" }), base: BASE };
  const plan = await planGeneration(store, { kind: "image", prompt: "Sunny on a beach", provider: "openai", count: 2, aspect: "9:16", transparent: true }, deps);
  const r = await runGeneration(store, p.id, plan, { kind: "image", prompt: "Sunny on a beach", from: [ref.id], count: 2, transparent: true, folder: "Made", tags: ["beach"] }, deps);
  const sent = f.asked[0];
  assert.equal(sent.method, "POST");
  assert.equal(sent.headers.authorization, "Bearer sk-test-123");
  assert.equal(sent.body.model, "gpt-image-2.6-flare");
  assert.deepEqual([sent.body.n, sent.body.size, sent.body.quality, sent.body.background, sent.body.output_format], [2, "1152x2048", "medium", "transparent", "png"]);
  assert.match(sent.body.images[0].image_url, /^data:image\/jpeg;base64,/, "an opaque picture goes as a JPEG");
  assert.equal(r.yarn.length, 2);
  assert.deepEqual(r.yarn.map((y) => y.name), ["Sunny on a beach 1", "Sunny on a beach 2"]);
  assert.equal(r.yarn[0].folder, "Made");
  assert.deepEqual([...r.yarn[0].tags].sort(), ["beach", "made"]);
  const made = r.yarn[0].meta.made;
  assert.deepEqual([made.by, made.provider, made.model, made.prompt], ["provider", "OpenAI", "gpt-image-2.6-flare", "Sunny on a beach"]);
  assert.deepEqual(made.from, [{ id: ref.id, name: "Sunny" }]);
  const cost = (4000 * 30 + 1200 * 8 + 100 * 5) / 1e6;
  assert.equal(r.cost, cost);
  assert.equal(made.costUsd, Math.round((cost / 2) * 10000) / 10000);
  assert.ok(usageSummary(store).kinds.some((k) => k.kind === "generate" && Math.abs(k.cost - cost) < 1e-9));
  assert.doesNotMatch(JSON.stringify(r.yarn), /sk-test-123/);
});

test("Google: one ask a picture, its drafts left out, the key in its own header", async () => {
  const draft = await png(1, 1, 1), final = await png(30, 200, 90), other = await png(220, 200, 10);
  let n = 0;
  const f = fake(({ host, path, body }) => {
    if (host !== "generativelanguage.googleapis.com" || path !== "/v1beta/interactions") return undefined;
    n++;
    return { steps: [
      { type: "thought", content: [{ type: "image", mime_type: "image/png", data: draft.toString("base64") }] },
      { type: "model_output", content: [{ type: "text", text: "Here it is" }, { type: "image", mime_type: "image/png", data: (n === 1 ? final : other).toString("base64") }] },
    ], echo: body.model };
  });
  const deps = { fetch: f, key: keys({ google: "AIza-test" }), base: BASE };
  const plan = await planGeneration(store, { kind: "image", prompt: "A latte, overhead", count: 2, aspect: "4:5", quality: "draft" }, deps);
  const r = await runGeneration(store, p.id, plan, { kind: "image", prompt: "A latte, overhead", count: 2, from: [ref.id], name: "Latte" }, deps);
  assert.equal(f.asked.length, 2, "two asks for two pictures");
  const sent = f.asked[0];
  assert.equal(sent.headers["x-goog-api-key"], "AIza-test");
  assert.equal(sent.q.get("key"), null, "not in the address");
  assert.deepEqual(sent.body.response_format, { type: "image", aspect_ratio: "4:5", image_size: "1K" });
  assert.equal(sent.body.input[0].type, "image");
  assert.deepEqual(sent.body.input.at(-1), { type: "text", text: "A latte, overhead" });
  assert.deepEqual(r.yarn.map((y) => y.name), ["Latte 1", "Latte 2"]);
  const colours = await Promise.all(r.yarn.map((y) => y.meta.colors[0]));
  assert.ok(!colours.includes("#010101"), "never the draft");
  assert.equal(r.yarn[0].meta.made.provider, "Google Gemini");
});

test("Google video: a file it keeps is waited for, then fetched", { skip: !haveFfmpeg }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "knitted-gen-v-"));
  const mp4 = join(dir, "v.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=180x320:rate=24:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", mp4]);
  let looks = 0;
  const f = fake(({ path, body }) => {
    if (path === "/v1beta/interactions") { assert.deepEqual(body.response_format, { type: "video", duration: "4s", aspect_ratio: "9:16", resolution: "720p" }); return { steps: [{ type: "model_output", content: [{ type: "video", mime_type: "video/mp4", uri: "https://generativelanguage.googleapis.com/v1beta/files/abc123" }] }] }; }
    if (path === "/v1beta/files/abc123") return { name: "files/abc123", state: ++looks < 3 ? "PROCESSING" : "ACTIVE" };
    if (path === "/v1beta/files/abc123:download") return readFileSync(mp4);
    return undefined;
  });
  const deps = { fetch: f, key: keys({ google: "AIza-test" }), base: BASE };
  const plan = await planGeneration(store, { kind: "video", prompt: "Sunny waves", seconds: 4 }, deps);
  const r = await runGeneration(store, p.id, plan, { kind: "video", prompt: "Sunny waves", from: [ref.id] }, deps);
  assert.equal(looks, 3, "asked until it was ready");
  assert.equal(r.yarn[0].kind, "video");
  assert.equal(r.yarn[0].meta.made.model, "gemini-omni-1.2-flash");
  assert.ok(r.yarn[0].durationMs > 1500);
});

test("a refused key, a refused prompt and a rate limit each say what to do, without the key", async () => {
  const plan = await planGeneration(store, { kind: "image", prompt: "x", provider: "openai" }, { key: keys({ openai: "sk-secret" }) });
  const run = (res) => runGeneration(store, p.id, plan, { kind: "image", prompt: "x" }, { fetch: fake(() => res), key: keys({ openai: "sk-secret" }), base: BASE });
  await assert.rejects(run(Response.json({ error: { message: "Incorrect API key provided: sk-secret" } }, { status: 401 })), (e) => /did not take the key/.test(e.message) && !/sk-secret/.test(e.message));
  await assert.rejects(run(Response.json({ error: { type: "image_generation_user_error", code: "moderation_blocked", message: "Your request was rejected by the safety system." } }, { status: 400 })), /would not make that/);
  await assert.rejects(run(Response.json({ error: { message: "Rate limit reached" } }, { status: 429 })), /too many requests for now/);
  await assert.rejects(run(Response.json({ error: { message: "Your organization must be verified to use the model gpt-image-2.6-flare." } }, { status: 403 })), /verify your organization/);
});

test("as a job: it ends done with what it made, or failed with why", async () => {
  const good = fake(() => ({ steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: "iVBORw0KGgo=" }] }] }));
  const ok = fake(async () => ({ steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: (await png(5, 5, 250)).toString("base64") }] }] }));
  const { job } = await startGeneration(store, p.id, { kind: "image", prompt: "Blue square" }, { fetch: ok, key: keys({ google: "k" }), base: BASE });
  let j = store.getJob(job.id);
  for (let i = 0; i < 100 && !["done", "failed"].includes(j.status); i++) { await new Promise((r) => setTimeout(r, 20)); j = store.getJob(job.id); }
  assert.equal(j.status, "done", j.error ?? "");
  assert.equal(j.result.yarn[0].name, "Blue square");
  const { job: bad } = await startGeneration(store, p.id, { kind: "image", prompt: "Broken" }, { fetch: good, key: keys({ google: "k" }), base: BASE });
  for (let i = 0; i < 100 && !["done", "failed"].includes((j = store.getJob(bad.id)).status); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(j.status, "failed");
  assert.match(j.error, /not a real PNG image|corrupt/);
});

test("a key is tested by listing models, which costs nothing", async () => {
  const f = fake(({ path, headers }) => path === "/v1/models" && headers.authorization === "Bearer good" ? { data: [] } : Response.json({ error: { message: "bad" } }, { status: 401 }));
  assert.deepEqual(await testGenKey(store, "openai", { fetch: f, key: keys({ openai: "good" }), base: BASE }), { ok: true });
  const no = await testGenKey(store, "openai", { fetch: f, key: keys({ openai: "bad" }), base: BASE });
  assert.equal(no.ok, false);
  assert.match(no.why, /did not take the key/);
  assert.match((await testGenKey(store, "google", { key: keys({}) })).why, /no Google Gemini key yet/);
});

test("prices: OpenAI by what it used, the rest by the published price", () => {
  assert.equal(openaiCost({ output_tokens: 1_000_000 }), 30);
  assert.equal(estimateCost({ kind: "image", provider: "openai", model: "gpt-image-2.6-flare", count: 1, aspect: "1:1", quality: "best" }), 0.211);
  assert.equal(estimateCost({ kind: "video", provider: "google", model: "gemini-omni-1.2-flash", seconds: 10, quality: "best" }), 1.04);
});
