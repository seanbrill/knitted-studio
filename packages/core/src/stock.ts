// Free stock: search Openverse (no key), Pixabay and Pexels (a free key of the person's own
// each), and add what they choose to a project's Yarn or the Library.
//
// Every source is asked at once and answers on its own: one that fails, or has no key, says
// so beside the others' results instead of failing the search. Searches are kept for a day, as
// Pixabay asks, so the same search again costs nothing; looking one up by its id is not, since
// Pixabay's file addresses expire. Freesound is not here: its API is free only for
// non-commercial use, and a business's posts are commercial. Its CC0 and CC BY sounds come
// through Openverse. Adding a file asks its source for it
// again by its id, and never takes an address from the browser: what is downloaded is what the
// source says that id is. The file keeps its credit and licence (YarnMeta.stock).
//
// A key goes only to its own source, and never into an error, a log or the database.
// KNITTED_STOCK_API sends every address to a stand-in instead, as <that>/<host>/<path>: the
// end-to-end tests' fakes.

import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { STOCK_SOURCES, creditLine, type StockItem, type StockKind, type StockProvider } from "./stock-pure.ts";
import { ValidationError, type Store } from "./store.ts";
import { getSecret } from "./secrets.ts";
import { assertPublicUrl, importYarn, uploadTempPath, type ImportResult } from "./yarn.ts";

export const stockKey = (p: StockProvider) => `stock_${p}`;

export interface StockDeps {
  fetch?: typeof fetch;
  /** The key for a source; by default the person's, from the computer's secret store. */
  key?: (p: StockProvider) => Promise<string | null>;
  /** Where every address goes instead (tests). */
  base?: string;
}
export interface StockSearchResult {
  items: StockItem[];
  sources: { provider: StockProvider; name: string; state: "ok" | "error" | "no-key" | "none"; note?: string; more: boolean }[];
}

class StockError extends Error {}
const UA = "knitted.studio (https://knitted.filefreak.page)";
const PER_PAGE = 20;
const DAY = 24 * 3600_000;
const MAX_BYTES: Record<StockKind, number> = { image: 60 * 1024 ** 2, video: 400 * 1024 ** 2, audio: 80 * 1024 ** 2 };

// ── a day's memory of what each source answered ─────────────────────────────
const cache = new Map<string, { at: number; value: unknown }>();
function remembered<T>(key: string, make: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DAY) return Promise.resolve(hit.value as T);
  return make().then((value) => {
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 400) cache.delete(cache.keys().next().value!);
    return value;
  });
}
/** For tests: forget every remembered answer. */
export const forgetStock = () => cache.clear();

interface Ctx { name: string; key: string | null; get: (url: string, o?: { headers?: Record<string, string>; fresh?: boolean }) => Promise<unknown> }
interface Adapter {
  search(c: Ctx, q: string, kind: StockKind, page: number): Promise<{ items: StockItem[]; more: boolean }>;
  /** One item by its id, and the address of the file to add: the biggest that is sensible to use. */
  one(c: Ctx, id: string, kind: StockKind): Promise<{ item: StockItem; file: string }>;
  /** Where its files may come from. Null: anywhere public (Openverse finds work all over the web). */
  hosts: RegExp | null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const title = (s: string | undefined, kind: StockKind) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 100) || (kind === "image" ? "Photo" : kind === "video" ? "Video" : "Sound");
const fromTags = (tags: unknown) => String(tags ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 4).join(", ");

// ── Pixabay: photos and videos, with a free key ─────────────────────────────
type PixHit = { id: number; pageURL: string; tags?: string; user?: string; user_id?: number; previewURL?: string; webformatURL?: string; largeImageURL?: string; imageWidth?: number; imageHeight?: number; duration?: number; videos?: Record<string, { url: string; width: number; height: number; thumbnail?: string }> };
const pixItem = (h: PixHit, kind: StockKind): StockItem => {
  const v = h.videos ?? {};
  const small = v.small ?? v.tiny ?? v.medium;
  return {
    id: `pixabay:${h.id}`, provider: "pixabay", kind, title: title(fromTags(h.tags), kind),
    thumb: kind === "video" ? (v.medium?.thumbnail ?? small?.thumbnail) : h.webformatURL ?? h.previewURL,
    preview: kind === "video" ? small?.url : h.webformatURL,
    width: kind === "video" ? (v.large?.width || v.medium?.width) : h.imageWidth, height: kind === "video" ? (v.large?.height || v.medium?.height) : h.imageHeight,
    durationMs: h.duration ? h.duration * 1000 : undefined,
    author: h.user, authorUrl: h.user && h.user_id ? `https://pixabay.com/users/${encodeURIComponent(h.user)}-${h.user_id}/` : undefined,
    page: h.pageURL, license: "Pixabay Content License", licenseUrl: "https://pixabay.com/service/license-summary/",
  };
};
const pixabay: Adapter = {
  hosts: /(^|\.)pixabay\.com$/,
  async search(c, q, kind, page) {
    const path = kind === "video" ? "api/videos/" : "api/";
    const r = await c.get(`https://pixabay.com/${path}?${new URLSearchParams({ key: c.key!, q, page: String(page), per_page: String(PER_PAGE), safesearch: "true", ...(kind === "image" ? { image_type: "photo" } : {}) })}`) as { totalHits?: number; hits?: PixHit[] };
    return { items: (r.hits ?? []).map((h) => pixItem(h, kind)), more: page * PER_PAGE < (r.totalHits ?? 0) };
  },
  async one(c, id, kind) {
    const r = await c.get(`https://pixabay.com/${kind === "video" ? "api/videos/" : "api/"}?${new URLSearchParams({ key: c.key!, id })}`, { fresh: true }) as { hits?: PixHit[] };
    const h = r.hits?.[0];
    if (!h) throw new StockError("Pixabay no longer has that one.");
    const v = h.videos ?? {};
    // Video: the 1080p one when there is one, which is what a post is made at.
    const file = kind === "video" ? ((v.large?.url && (v.large.width ?? 0) <= 1920 ? v.large.url : undefined) ?? v.medium?.url ?? v.small?.url) : h.largeImageURL ?? h.webformatURL;
    if (!file) throw new StockError("Pixabay gave no file for that one.");
    return { item: pixItem(h, kind), file };
  },
};

// ── Pexels: photos and videos, with a free key ──────────────────────────────
type PexPhoto = { id: number; url: string; width: number; height: number; alt?: string; photographer?: string; photographer_url?: string; src: Record<string, string> };
type PexVideo = { id: number; url: string; width: number; height: number; duration?: number; image?: string; user?: { name?: string; url?: string }; video_files?: { quality?: string; file_type?: string; width?: number; height?: number; link: string }[] };
const pexTitle = (url: string, kind: StockKind) => title(decodeURIComponent(url.replace(/\/$/, "").split("/").pop() ?? "").replace(/-\d+$/, "").replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()), kind);
const mp4s = (v: PexVideo) => (v.video_files ?? []).filter((f) => f.file_type === "video/mp4" && f.link).sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
const pexItem = (x: PexPhoto | PexVideo, kind: StockKind): StockItem => {
  if (kind === "image") {
    const p = x as PexPhoto;
    return { id: `pexels:${p.id}`, provider: "pexels", kind, title: title(p.alt || pexTitle(p.url, kind), kind), thumb: p.src.medium ?? p.src.small, preview: p.src.large ?? p.src.medium, width: p.width, height: p.height, author: p.photographer, authorUrl: p.photographer_url, page: p.url, license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" };
  }
  const v = x as PexVideo;
  const files = mp4s(v);
  return { id: `pexels:${v.id}`, provider: "pexels", kind, title: pexTitle(v.url, kind), thumb: v.image, preview: (files.find((f) => (f.width ?? 0) >= 480) ?? files[0])?.link, width: v.width, height: v.height, durationMs: v.duration ? v.duration * 1000 : undefined, author: v.user?.name, authorUrl: v.user?.url, page: v.url, license: "Pexels License", licenseUrl: "https://www.pexels.com/license/" };
};
const pexels: Adapter = {
  hosts: /(^|\.)pexels\.com$/,
  async search(c, q, kind, page) {
    const u = kind === "video" ? "https://api.pexels.com/videos/search" : "https://api.pexels.com/v1/search";
    const r = await c.get(`${u}?${new URLSearchParams({ query: q, page: String(page), per_page: String(PER_PAGE) })}`, { headers: { authorization: c.key! } }) as { photos?: PexPhoto[]; videos?: PexVideo[]; next_page?: string };
    return { items: (kind === "video" ? r.videos ?? [] : r.photos ?? []).map((x) => pexItem(x, kind)), more: !!r.next_page };
  },
  async one(c, id, kind) {
    const x = await c.get(kind === "video" ? `https://api.pexels.com/videos/videos/${id}` : `https://api.pexels.com/v1/photos/${id}`, { headers: { authorization: c.key! }, fresh: true }) as PexPhoto & PexVideo;
    if (!x?.id) throw new StockError("Pexels no longer has that one.");
    // A photo at 2x the large size; a video at the biggest mp4 up to 1920 wide.
    const files = kind === "video" ? mp4s(x) : [];
    const file = kind === "video" ? ([...files].reverse().find((f) => (f.width ?? 0) <= 1920) ?? files[0])?.link : x.src.large2x ?? x.src.original;
    if (!file) throw new StockError("Pexels gave no file for that one.");
    return { item: pexItem(x, kind), file };
  },
};

// ── Openverse: openly licensed photos and sound from across the web, no key ─
type OvResult = { id: string; title?: string; foreign_landing_url?: string; url?: string; creator?: string; creator_url?: string; license?: string; license_version?: string; license_url?: string; thumbnail?: string; width?: number; height?: number; duration?: number; source?: string; filetype?: string; attribution?: string };
const ovLicense = (r: OvResult) => {
  const l = (r.license ?? "").toLowerCase();
  if (l === "cc0") return "CC0";
  if (l === "pdm") return "Public Domain Mark";
  return `CC ${l.toUpperCase()}${r.license_version ? ` ${r.license_version}` : ""}`.trim();
};
const ovItem = (r: OvResult, kind: StockKind): StockItem => ({
  id: `openverse:${r.id}`, provider: "openverse", kind, title: title(r.title, kind), thumb: r.thumbnail, preview: kind === "audio" ? r.url : r.thumbnail,
  width: r.width, height: r.height, durationMs: num(r.duration), author: r.creator, authorUrl: str(r.creator_url),
  page: r.foreign_landing_url ?? `https://openverse.org/${kind === "audio" ? "audio" : "image"}/${r.id}`, license: ovLicense(r), licenseUrl: str(r.license_url),
  attribution: str(r.attribution)?.replace(/\s+/g, " ").trim(),
});
const openverse: Adapter = {
  hosts: null,
  async search(c, q, kind, page) {
    // Only CC0, the public domain and CC BY: free for a business's posts, and changeable. Its
    // own "commercial" filter lets through Sampling+, which forbids advertising, and CC BY-SA,
    // which would bind the whole post to its licence. 20 a page is the most it gives with no key.
    const r = await c.get(`https://api.openverse.org/v1/${kind === "audio" ? "audio" : "images"}/?${new URLSearchParams({ q, page: String(page), page_size: String(PER_PAGE), license: "cc0,pdm,by", mature: "false" })}`) as { results?: OvResult[]; page_count?: number };
    return { items: (r.results ?? []).filter((x) => x.url).map((x) => ovItem(x, kind)), more: page < (r.page_count ?? 0) };
  },
  async one(c, id, kind) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new StockError("That is not an Openverse id.");
    const r = await c.get(`https://api.openverse.org/v1/${kind === "audio" ? "audio" : "images"}/${id}/`, { fresh: true }) as OvResult;
    if (!["cc0", "pdm", "by"].includes((r.license ?? "").toLowerCase())) throw new StockError("That one's licence does not let a business use it freely, so knitted did not add it.");
    if (!r?.url) throw new StockError("Openverse no longer has that one.");
    return { item: ovItem(r, kind), file: r.url };
  },
};

const ADAPTERS: Record<StockProvider, Adapter> = { openverse, pixabay, pexels };
/** The order results are mixed in: the sources with the most to choose from first. */
const ORDER: StockProvider[] = ["pixabay", "pexels", "openverse"];

function context(p: StockProvider, key: string | null, deps: StockDeps): Ctx {
  const f = deps.fetch ?? globalThis.fetch;
  const base = deps.base ?? process.env.KNITTED_STOCK_API;
  const name = STOCK_SOURCES[p].name;
  return {
    name, key,
    async get(url, { headers = {}, fresh = false } = {}) {
      const at = via(url, base);
      const ask = async () => {
        let res: Response;
        try { res = await f(at, { headers: { accept: "application/json", "user-agent": UA, ...headers }, signal: AbortSignal.timeout(20_000) }); }
        catch { throw new StockError(`${name} did not answer. Check the internet connection.`); }
        if (res.status === 401 || res.status === 403) throw new StockError(`${name} did not take the key. Check it in Settings, Stock.`);
        if (res.status === 429) throw new StockError(`${name} says too many searches for now. Try again in a minute.`);
        if (res.status === 404) throw new StockError(`${name} no longer has that one.`);
        if (!res.ok) throw new StockError(`${name} answered ${res.status}. Try again later.`);
        try { return await res.json(); } catch { throw new StockError(`${name} answered with something that is not a search result.`); }
      };
      // Remembered by the address without its key, so a key is never a part of anything kept.
      return fresh ? ask() : remembered(`${p} ${url.replace(/([?&]key=)[^&]*/g, "$1")}`, ask);
    },
  };
}
const keyFor = (store: Store, deps: StockDeps) => (p: StockProvider) => (deps.key ? deps.key(p) : getSecret(stockKey(p), store.paths.root));

/** Search every source that has the kind, at once. A source with no key, or one that fails, says so. */
export async function searchStock(store: Store, o: { q: string; kind: StockKind; page?: number }, deps: StockDeps = {}): Promise<StockSearchResult> {
  const q = String(o.q ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!q) throw new ValidationError("Say what to look for.");
  if (!["image", "video", "audio"].includes(o.kind)) throw new ValidationError("Look for photos, videos or sound.");
  const page = Math.max(1, Math.min(50, Math.floor(o.page ?? 1)));
  const key = keyFor(store, deps);
  const answers = await Promise.all(ORDER.map(async (p) => {
    const s = STOCK_SOURCES[p];
    const out = { provider: p, name: s.name, items: [] as StockItem[], more: false };
    if (!s.kinds.includes(o.kind)) return { ...out, state: "none" as const };
    const k = s.keyUrl ? await key(p).catch(() => null) : null;
    if (s.keyUrl && !k) return { ...out, state: "no-key" as const };
    try { return { ...out, ...(await ADAPTERS[p].search(context(p, k, deps), q, o.kind, page)), state: "ok" as const }; }
    catch (e) { return { ...out, state: "error" as const, note: e instanceof StockError ? e.message : `${s.name} could not be searched.` }; }
  }));
  // Mixed a few at a time, so the first row is not all from one source.
  const items: StockItem[] = [];
  const queues = answers.map((a) => [...a.items]);
  while (queues.some((x) => x.length)) for (const x of queues) items.push(...x.splice(0, 2));
  return { items, sources: answers.map(({ items: _i, ...a }) => a) };
}

const via = (url: string, base: string | undefined) => base ? `${base.replace(/\/$/, "")}/${url.replace(/^https?:\/\//, "")}` : url;

const EXT_OF: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "video/mp4": ".mp4", "audio/mpeg": ".mp3", "audio/mp3": ".mp3", "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/flac": ".flac", "audio/mp4": ".m4a" };

/** Add one result to a project's Yarn, or the Library's, with its credit. The same file again is the one there. */
export async function addStock(store: Store, o: { id: string; kind: StockKind; to: string; folder?: string; name?: string; tags?: string[]; actor?: "human" | "model" }, deps: StockDeps = {}): Promise<ImportResult> {
  const m = /^(openverse|pixabay|pexels):([A-Za-z0-9-]{1,64})$/.exec(String(o.id ?? ""));
  if (!m) throw new ValidationError("That is not a stock id. Use one a search gave, like pexels:2014422.");
  const p = m[1] as StockProvider, s = STOCK_SOURCES[p];
  if (!s.kinds.includes(o.kind)) throw new ValidationError(`${s.name} has no ${o.kind === "image" ? "photos" : o.kind === "video" ? "videos" : "sound"}.`);
  store.getProject(o.to);
  const k = s.keyUrl ? await keyFor(store, deps)(p).catch(() => null) : null;
  if (s.keyUrl && !k) throw new ValidationError(`${s.name} needs a free key first. Add one in Settings, Stock.`);
  let got: { item: StockItem; file: string };
  try { got = await ADAPTERS[p].one(context(p, k, deps), m[2], o.kind); }
  catch (e) { throw e instanceof StockError ? new ValidationError(e.message) : e; }

  // The file: only from the source's own hosts (or, for Openverse, anywhere public), and every
  // redirect on the way checked the same, within a size.
  const base = deps.base ?? process.env.KNITTED_STOCK_API;
  const hosts = ADAPTERS[p].hosts;
  const allowed = async (raw: string) => {
    let u: URL;
    try { u = new URL(raw); } catch { throw new ValidationError(`${s.name} gave an address knitted cannot read.`); }
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new ValidationError(`${s.name} gave an address knitted cannot read.`);
    if (hosts && !hosts.test(u.hostname)) throw new ValidationError(`${s.name} pointed somewhere other than its own site for that file, so knitted did not fetch it.`);
    if (!base) await assertPublicUrl(u.href);
    return u;
  };
  let url = await allowed(got.file);
  let res: Response | undefined;
  for (let hop = 0; hop < 5; hop++) {
    res = await (deps.fetch ?? globalThis.fetch)(via(url.href, base), { headers: { "user-agent": UA }, redirect: "manual", signal: AbortSignal.timeout(120_000) })
      .catch(() => { throw new ValidationError(`${s.name} did not send the file. Check the internet connection.`); });
    const to = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && to) { url = await allowed(new URL(to, url).href); continue; }
    break;
  }
  if (!res || !res.ok || !res.body) throw new ValidationError(`${s.name} answered ${res?.status ?? "nothing"} for the file. Try again later.`);
  const max = MAX_BYTES[o.kind];
  if (Number(res.headers.get("content-length") ?? 0) > max) throw new ValidationError("That file is too large to add.");
  const tmp = uploadTempPath(store, o.to);
  await mkdir(join(tmp, ".."), { recursive: true });
  let bytes = 0;
  const limit = new Transform({ transform(c, _e, cb) { bytes += c.length; if (bytes > max) cb(new ValidationError("That file is too large to add.")); else cb(null, c); } });
  try { await pipeline(Readable.fromWeb(res.body as never), limit, createWriteStream(tmp)); }
  catch (e) { await rm(tmp, { force: true }); throw e; }

  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  let ext = extname(basename(url.pathname)).toLowerCase();
  if (ext === ".jpeg") ext = ".jpg";
  if (!ext || ext.length > 6) ext = EXT_OF[type] ?? (o.kind === "video" ? ".mp4" : o.kind === "audio" ? ".mp3" : ".jpg");
  const item = got.item;
  const name = (o.name ?? item.title).slice(0, 100);
  return importYarn(store, o.to, tmp, `${name}${ext}`, {
    name, folder: o.folder, actor: o.actor ?? "human",
    tags: [...(o.tags ?? []), "stock", p],
    stock: { provider: p, id: item.id, page: item.page, author: item.author, authorUrl: item.authorUrl, license: item.license, licenseUrl: item.licenseUrl, credit: item.attribution ?? creditLine(item), at: new Date().toISOString() },
  });
}
