// Making photos and video with a provider, on the person's own key: OpenAI for photos, Google
// Gemini for photos and video. What is asked for, and any pictures to work from (a product
// shot, a mascot), go to the provider; what comes back is kept as Yarn, with what was asked,
// what it was made from, by which model, and what it cost (YarnMeta.made).
//
// It is a job: a photo takes up to a couple of minutes, a video longer. Before it starts, the
// cost is worked out and held against the Spending limits; when it ends, what it cost is kept
// with the rest of the key's spending. A key goes only to its own provider, and never into an
// error, a log or the database. KNITTED_GENERATE_API sends every address to a stand-in
// instead, as <that>/<host>/<path>: the tests' fakes.

import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_MODEL, GEN_ASPECTS, GEN_SOURCES, GOOGLE_SIZE, OPENAI_QUALITY, OPENAI_SIZE, VIDEO_ASPECTS, VIDEO_RESOLUTION, estimateCost, money, openaiCost, type GenAspect, type GenKind, type GenProvider, type GenQuality } from "./gen-pure.ts";
import { LIBRARY_ID, type MadeBy, type Yarn } from "./types.ts";
import { ValidationError, type Store } from "./store.ts";
import { getSecret } from "./secrets.ts";
import { recordUsage, spendCheck, spendLimits, spentSince, monthStart } from "./usage.ts";
import { getYarn, importYarn, uploadTempPath, yarnPath } from "./yarn.ts";

export const genKey = (p: GenProvider) => `gen_${p}`;

/** Which provider and model makes each kind, as chosen in Settings. Null: the first with a key. */
export interface GenChoice { image: { provider: GenProvider; model: string } | null; video: { provider: GenProvider; model: string } | null }
export function genChoice(store: Store): GenChoice { return { image: null, video: null, ...store.getSetting<Partial<GenChoice>>("generate", {}) }; }
export function setGenChoice(store: Store, change: Partial<GenChoice>): GenChoice {
  for (const [kind, c] of Object.entries(change) as [GenKind, GenChoice[GenKind]][]) {
    if (!c) continue;
    const src = GEN_SOURCES[c.provider];
    if (!src?.models.some((m) => m.id === c.model && m.kind === kind)) throw new ValidationError(`${src?.name ?? c.provider} has no ${kind === "image" ? "photo" : "video"} model called ${c.model}.`);
  }
  const next = { ...genChoice(store), ...change };
  store.setSetting("generate", next);
  return next;
}

export interface GenDeps {
  fetch?: typeof fetch;
  /** The key for a provider; by default the person's, from the computer's secret store. */
  key?: (p: GenProvider) => Promise<string | null>;
  /** Where every address goes instead (tests). */
  base?: string;
}

export interface GenInput {
  kind: GenKind;
  /** What to make, in words. */
  prompt: string;
  /** Pictures in Yarn to work from, by id: a product, a mascot, a style. */
  from?: string[];
  /** Photos: how many, 1 to 4. */
  count?: number;
  aspect?: GenAspect;
  quality?: GenQuality;
  /** Video: how long, 3 to 15. */
  seconds?: number;
  /** Photos from OpenAI: a see-through background, for a cut-out. */
  transparent?: boolean;
  provider?: GenProvider;
  model?: string;
  name?: string;
  folder?: string;
  tags?: string[];
  actor?: "human" | "model";
}
export interface GenPlan { kind: GenKind; provider: GenProvider; model: string; count: number; aspect: GenAspect; quality: GenQuality; seconds: number; cost: number; say: string }

class GenError extends Error {}

const keyFor = (store: Store, deps: GenDeps) => (p: GenProvider) => (deps.key ? deps.key(p) : getSecret(genKey(p), store.paths.root));
const via = (url: string, base: string | undefined) => (base ? `${base.replace(/\/$/, "")}/${url.replace(/^https?:\/\//, "")}` : url);
const KIND_WORD: Record<GenKind, string> = { image: "photo", video: "video" };

/**
 * What a request will be: which provider and model, its shape, and what it will cost. Throws,
 * in words for the person, when it cannot be made: no key, a shape the model does not make,
 * or over a Spending limit.
 */
export async function planGeneration(store: Store, input: GenInput, deps: GenDeps = {}): Promise<GenPlan> {
  const kind = input.kind;
  if (kind !== "image" && kind !== "video") throw new ValidationError("Make a photo or a video.");
  const prompt = String(input.prompt ?? "").trim();
  if (!prompt) throw new ValidationError("Say what to make.");
  if (prompt.length > 4000) throw new ValidationError("Say what to make in under 4,000 characters.");
  const key = keyFor(store, deps);

  let provider = input.provider, model = input.model;
  if (!provider) {
    const chosen = genChoice(store)[kind];
    if (chosen) ({ provider, model } = { provider: chosen.provider, model: model ?? chosen.model });
    else for (const p of (["google", "openai"] as GenProvider[]).filter((p) => GEN_SOURCES[p].kinds.includes(kind))) if (await key(p).catch(() => null)) { provider = p; break; }
  }
  if (!provider) throw new ValidationError(kind === "video" ? "Making video needs a Google Gemini key. Add one in Settings, Photos and video." : "Making photos needs an OpenAI or Google Gemini key. Add one in Settings, Photos and video.");
  const src = GEN_SOURCES[provider];
  if (!src) throw new ValidationError(`knitted cannot make anything with ${provider}.`);
  if (!src.kinds.includes(kind)) throw new ValidationError(`${src.name} does not make ${KIND_WORD[kind]}s here. ${kind === "video" ? "Google Gemini does." : ""}`.trim());
  model = model ?? DEFAULT_MODEL[provider][kind]!;
  if (!src.models.some((m) => m.id === model && m.kind === kind)) throw new ValidationError(`${src.name} has no ${KIND_WORD[kind]} model called ${model}. Choose one in Settings, Photos and video.`);
  if (!(await key(provider).catch(() => null))) throw new ValidationError(`${src.name} needs your key first. Add it in Settings, Photos and video.`);

  const aspect = input.aspect ?? (kind === "video" ? "9:16" : "1:1");
  if (!(kind === "video" ? VIDEO_ASPECTS : GEN_ASPECTS).includes(aspect)) throw new ValidationError(kind === "video" ? "A video is 9:16 or 16:9." : `A photo is one of ${GEN_ASPECTS.join(", ")}.`);
  const quality: GenQuality = input.quality ?? "good";
  if (!["draft", "good", "best"].includes(quality)) throw new ValidationError("The quality is draft, good or best.");
  const count = kind === "video" ? 1 : Math.max(1, Math.min(4, Math.floor(input.count ?? 1)));
  const seconds = kind === "video" ? Math.max(3, Math.min(15, Math.round(input.seconds ?? 6))) : 0;
  if (input.transparent && provider !== "openai") throw new ValidationError("A see-through background comes from OpenAI. Choose it, or leave the background in.");
  if ((input.from?.length ?? 0) > (kind === "video" ? 2 : 6)) throw new ValidationError(kind === "video" ? "A video works from one or two pictures: the first frame, and maybe the last." : "Work from up to six pictures at once.");

  const cost = estimateCost({ kind, provider, model, count, aspect, quality, seconds });
  const ok = spendCheck(store);
  if (!ok.ok) throw new ValidationError(ok.why);
  const l = spendLimits(store);
  if (l.monthly != null) {
    const left = l.monthly - spentSince(store, monthStart());
    if (cost > left) throw new ValidationError(`That would cost about ${money(cost)}, and your monthly limit has ${money(Math.max(0, left))} left. Raise it in Settings, Spending, or ask for less.`);
  }
  const shape = aspect === "1:1" ? "square" : aspect;
  const what = kind === "video" ? `a ${seconds}-second ${aspect} video at ${VIDEO_RESOLUTION[quality]}` : `${["a", "two", "three", "four"][count - 1]} ${shape} photo${count === 1 ? "" : "s"}, ${quality} quality`;
  return { kind, provider, model, count, aspect, quality, seconds, cost, say: `${what}, with ${src.models.find((m) => m.id === model)!.name}, for about ${money(cost)}` };
}

/** A picture in Yarn, as a provider takes one: a PNG or JPEG, no bigger than 1536 on its long side. */
async function referenceOf(store: Store, y: Yarn): Promise<{ mime: string; data: string }> {
  if (y.kind !== "image") throw new ValidationError(`${y.name} is not a picture, so it cannot be worked from.`);
  const file = yarnPath(store, y);
  const svg = y.mime === "image/svg+xml";
  const img = sharp(await readFile(file), svg ? { density: Math.max(72, Math.min(2400, (72 * 1536) / Math.max(y.width || 512, y.height || 512))) } : undefined).rotate().resize(1536, 1536, { fit: "inside", withoutEnlargement: !svg });
  const keepAlpha = y.meta.hasAlpha || svg;
  const buf = keepAlpha ? await img.png().toBuffer() : await img.jpeg({ quality: 90 }).toBuffer();
  return { mime: keepAlpha ? "image/png" : "image/jpeg", data: buf.toString("base64") };
}

interface Made { data: Buffer; mime: string }
interface Answer { files: Made[]; cost: number }

async function ask(deps: GenDeps, name: string, url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const f = deps.fetch ?? globalThis.fetch;
  let res: Response;
  try { res = await f(via(url, deps.base ?? process.env.KNITTED_GENERATE_API), { ...init, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) { throw new GenError((e as Error).name === "TimeoutError" ? `${name} took too long to answer. Try again, or ask for less.` : `${name} did not answer. Check the internet connection.`); }
  let body: unknown = null;
  const text = await res.text();
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON: said below */ }
  if (res.ok) return body;
  const err = (body as { error?: { message?: string; code?: string | number; type?: string; status?: string } } | null)?.error;
  const said = String(err?.message ?? "").replace(/\s+/g, " ").slice(0, 300);
  if (res.status === 401 || (res.status === 403 && !/verif/i.test(said))) throw new GenError(`${name} did not take the key. Check it in Settings, Photos and video.`);
  if (/verif/i.test(said)) throw new GenError(`${name} asks you to verify your organization before it makes pictures for your key: platform.openai.com/settings/organization/general. Then try again.`);
  if (res.status === 429) throw new GenError(`${name} says too many requests for now, or the key is out of credit. Wait a minute, or check its billing.`);
  if (err?.code === "moderation_blocked" || /safety|policy|moderation|blocked/i.test(said)) throw new GenError(`${name} would not make that: it says it goes against its rules. Say it another way, without real people's likenesses or brands that are not yours.`);
  throw new GenError(`${name} answered ${res.status}${said ? `: ${said}` : ""}.`);
}

async function openaiImages(key: string, plan: GenPlan, prompt: string, refs: { mime: string; data: string }[], transparent: boolean, deps: GenDeps): Promise<Answer> {
  const body: Record<string, unknown> = {
    model: plan.model, prompt, n: plan.count, size: OPENAI_SIZE[plan.aspect], quality: OPENAI_QUALITY[plan.quality],
    output_format: transparent ? "png" : "jpeg", ...(transparent ? { background: "transparent" } : { output_compression: 92 }),
  };
  if (refs.length) body.images = refs.map((r) => ({ image_url: `data:${r.mime};base64,${r.data}` }));
  const r = await ask(deps, "OpenAI", `https://api.openai.com/v1/images/${refs.length ? "edits" : "generations"}`, {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body),
  }, 300_000) as { data?: { b64_json?: string }[]; usage?: Parameters<typeof openaiCost>[0]; output_format?: string };
  const files = (r?.data ?? []).filter((d) => d.b64_json).map((d) => ({ data: Buffer.from(d.b64_json!, "base64"), mime: transparent ? "image/png" : "image/jpeg" }));
  return { files, cost: r?.usage ? openaiCost(r.usage) : plan.cost };
}

/** Every picture or video block in a Gemini answer, wherever this version of the API puts it. */
function geminiMedia(r: unknown, want: "image" | "video"): { data?: string; uri?: string; mime: string }[] {
  const out: { data?: string; uri?: string; mime: string }[] = [];
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== "object" || depth > 8) return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    const o = v as Record<string, unknown>;
    if (o.type === "thought") return; // drafts it made on the way
    const inline = (o.inline_data ?? o.inlineData) as Record<string, string> | undefined;
    const mime = String(o.mime_type ?? o.mimeType ?? inline?.mime_type ?? inline?.mimeType ?? "");
    const data = (typeof o.data === "string" ? o.data : undefined) ?? inline?.data;
    const uri = (o.uri ?? o.file_uri ?? o.fileUri) as string | undefined;
    if ((o.type === want || mime.startsWith(`${want}/`)) && (data || uri)) { out.push({ data, uri, mime: mime || (want === "video" ? "video/mp4" : "image/png") }); return; }
    for (const x of Object.values(o)) walk(x, depth + 1);
  };
  walk(r, 0);
  return out;
}

const GOOGLE = "https://generativelanguage.googleapis.com/v1beta";
const googleHeaders = (key: string) => ({ "x-goog-api-key": key, "content-type": "application/json", "api-revision": "2026-05-20" });

async function googleOnce(key: string, plan: GenPlan, prompt: string, refs: { mime: string; data: string }[], deps: GenDeps): Promise<Made> {
  const video = plan.kind === "video";
  const r = await ask(deps, "Google Gemini", `${GOOGLE}/interactions`, {
    method: "POST", headers: googleHeaders(key),
    body: JSON.stringify({
      model: plan.model,
      input: [...refs.map((x) => ({ type: "image", mime_type: x.mime, data: x.data })), { type: "text", text: prompt }],
      response_format: video
        ? { type: "video", duration: `${plan.seconds}s`, aspect_ratio: plan.aspect, resolution: VIDEO_RESOLUTION[plan.quality] }
        : { type: "image", aspect_ratio: plan.aspect, image_size: GOOGLE_SIZE[plan.quality] },
      ...(video ? { delivery: "uri" } : {}),
    }),
  }, video ? 900_000 : 300_000);
  const errors = (r as { errors?: { message?: string }[] } | null)?.errors;
  const found = geminiMedia(r, video ? "video" : "image");
  const last = found.at(-1);
  if (!last) throw new GenError(errors?.length ? `Google Gemini could not make it: ${String(errors[0].message ?? "").slice(0, 200)}` : `Google Gemini answered without a ${KIND_WORD[plan.kind]}. Say it another way, and try again.`);
  if (last.data) return { data: Buffer.from(last.data, "base64"), mime: last.mime };
  return { data: await googleFile(key, last.uri!, deps), mime: last.mime };
}

/** A file Gemini made and kept: waited for until it is ready, then fetched with the key. */
async function googleFile(key: string, uri: string, deps: GenDeps): Promise<Buffer> {
  const id = /files\/([\w-]+)/.exec(uri)?.[1];
  if (!id) throw new GenError("Google Gemini gave an address for the video that knitted cannot read.");
  for (let i = 0; i < 120; i++) {
    const f = await ask(deps, "Google Gemini", `${GOOGLE}/files/${id}`, { headers: googleHeaders(key) }, 30_000) as { state?: string };
    if (f?.state === "FAILED") throw new GenError("Google Gemini could not finish the video. Try again.");
    if (!f?.state || f.state === "ACTIVE") break;
    await new Promise((r) => setTimeout(r, deps.base ? 10 : 5000));
  }
  const res = await (deps.fetch ?? globalThis.fetch)(via(`${GOOGLE}/files/${id}:download?alt=media`, deps.base ?? process.env.KNITTED_GENERATE_API), { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(300_000) })
    .catch(() => { throw new GenError("Google Gemini did not send the video. Check the internet connection."); });
  if (!res.ok) throw new GenError(`Google Gemini answered ${res.status} for the video.`);
  return Buffer.from(await res.arrayBuffer());
}

async function googleMake(key: string, plan: GenPlan, prompt: string, refs: { mime: string; data: string }[], deps: GenDeps): Promise<Answer> {
  // It makes one at a time: four photos are four asks, made side by side.
  const files = await Promise.all(Array.from({ length: plan.count }, () => googleOnce(key, plan, prompt, refs, deps)));
  return { files, cost: plan.cost };
}

const EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov" };

/** Make it now, keep what comes back in Yarn, and keep what it cost. The job's work. */
export async function runGeneration(store: Store, projectId: string, plan: GenPlan, input: GenInput, deps: GenDeps = {}, jobId?: string): Promise<{ yarn: Yarn[]; cost: number }> {
  const progress = (p: unknown) => jobId && store.updateJob(jobId, { status: "running", progress: p });
  try {
    progress({ step: "asking", provider: plan.provider, say: plan.say });
    const from = (input.from ?? []).map((id) => getYarn(store, id));
    const refs = await Promise.all(from.map((y) => referenceOf(store, y)));
    const key = await keyFor(store, deps)(plan.provider);
    if (!key) throw new GenError(`${GEN_SOURCES[plan.provider].name} needs your key first. Add it in Settings, Photos and video.`);
    const prompt = String(input.prompt).trim();
    const answer = plan.provider === "openai"
      ? await openaiImages(key, plan, prompt, refs, !!input.transparent, deps)
      : await googleMake(key, plan, prompt, refs, deps);
    if (!answer.files.length) throw new GenError(`${GEN_SOURCES[plan.provider].name} answered without a ${KIND_WORD[plan.kind]}. Say it another way, and try again.`);
    recordUsage(store, { kind: "generate", model: plan.model, projectId: projectId === LIBRARY_ID ? null : projectId, chatId: null, input: 0, output: answer.files.length, cacheWrite: 0, cacheRead: 0, cost: answer.cost });

    progress({ step: "keeping", provider: plan.provider, say: plan.say });
    const made: MadeBy = { by: "provider", provider: GEN_SOURCES[plan.provider].name, model: plan.model, prompt: prompt.slice(0, 2000), at: new Date().toISOString(), costUsd: Math.round((answer.cost / answer.files.length) * 10000) / 10000 };
    if (from.length) made.from = from.map((y) => ({ id: y.id, name: y.name }));
    const base = (input.name?.trim() || prompt.replace(/\s+/g, " ").slice(0, 48).replace(/[,.;:\s]+$/, "")).slice(0, 90);
    const yarn: Yarn[] = [];
    for (const [i, f] of answer.files.entries()) {
      const tmp = uploadTempPath(store, projectId);
      await mkdir(join(tmp, ".."), { recursive: true });
      await writeFile(tmp, f.data);
      const name = answer.files.length > 1 ? `${base} ${i + 1}` : base;
      yarn.push((await importYarn(store, projectId, tmp, `${name}${EXT[f.mime] ?? (plan.kind === "video" ? ".mp4" : ".png")}`, { name, folder: input.folder, tags: [...(input.tags ?? []), "made"], actor: input.actor ?? "human", made })).yarn);
    }
    if (jobId) store.updateJob(jobId, { status: "done", progress: { step: "done", say: plan.say }, result: { yarn: yarn.map((y) => ({ id: y.id, name: y.name })), cost: answer.cost } });
    return { yarn, cost: answer.cost };
  } catch (e) {
    const why = e instanceof GenError || e instanceof ValidationError ? e.message : `It could not be made: ${String((e as Error)?.message ?? e).slice(0, 200)}`;
    if (jobId) store.updateJob(jobId, { status: "failed", error: why });
    throw e instanceof GenError ? new ValidationError(e.message) : e;
  }
}

/** Plan it, then make it as a job. Returns at once, with the job and the plan. */
export async function startGeneration(store: Store, projectId: string, input: GenInput, deps: GenDeps = {}) {
  store.getProject(projectId);
  for (const id of input.from ?? []) {
    const y = getYarn(store, id);
    if (y.kind !== "image") throw new ValidationError(`${y.name} is not a picture, so it cannot be worked from.`);
  }
  const plan = await planGeneration(store, input, deps);
  const job = store.createJob("generate", projectId, { kind: plan.kind, provider: plan.provider, model: plan.model, count: plan.count, say: plan.say });
  runGeneration(store, projectId, plan, input, deps, job.id).catch(() => { /* kept on the job */ });
  return { job, plan };
}

/** Whether a key works, without making anything (it lists the provider's models, which is free). */
export async function testGenKey(store: Store, provider: GenProvider, deps: GenDeps = {}): Promise<{ ok: true } | { ok: false; why: string }> {
  const src = GEN_SOURCES[provider];
  const key = await keyFor(store, deps)(provider).catch(() => null);
  if (!key) return { ok: false, why: `There is no ${src.name} key yet.` };
  try {
    if (provider === "openai") await ask(deps, src.name, "https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` } }, 20_000);
    else await ask(deps, src.name, `${GOOGLE}/models`, { headers: { "x-goog-api-key": key } }, 20_000);
    return { ok: true };
  } catch (e) { return { ok: false, why: (e as Error).message }; }
}
