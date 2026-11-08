import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { LIBRARY_ID, creditLine, needsCredit } from "../src/index.ts";
import { addStock, forgetStock, openStore, searchStock } from "../src/node.ts";

const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-stock-")), "k.db"));
const p = store.createProject({ name: "Bakery" });
const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 120, b: 40 } } }).png().toBuffer();
const BASE = "http://fake.test";

const ov = (id, license = "by", extra = {}) => ({ id, title: `Loaf ${id.slice(0, 4)}`, url: `https://live.staticflickr.com/1/${id}.png`, creator: "Ana Lee", creator_url: "https://www.flickr.com/people/ana", license, license_version: license === "cc0" ? "1.0" : "4.0", license_url: `https://creativecommons.org/licenses/${license}/4.0/`, thumbnail: `https://api.openverse.org/v1/images/${id}/thumb/`, width: 64, height: 48, foreign_landing_url: `https://www.flickr.com/photos/ana/${id}`, attribution: `"Loaf" by Ana Lee is licensed under CC BY 4.0.`, ...extra });
const OV1 = "4bc43a04-ef46-4544-a0c1-63c63f56e276", OV2 = "5cd43a04-ef46-4544-a0c1-63c63f56e277";
const pixHit = (id, extra = {}) => ({ id, pageURL: `https://pixabay.com/photos/bread-${id}/`, tags: "bread, loaf, bakery", user: "baker", user_id: 7, previewURL: `https://cdn.pixabay.com/photo/${id}_150.png`, webformatURL: `https://pixabay.com/get/${id}_640.png`, largeImageURL: `https://pixabay.com/get/${id}_1280.png`, imageWidth: 64, imageHeight: 48, ...extra });

/** A stand-in for every source: answers by host and path, and writes down what was asked. */
function fake(routes) {
  const asked = [];
  const f = async (url, init = {}) => {
    const u = new URL(url);
    const [host, ...rest] = u.pathname.slice(1).split("/");
    const at = { host, path: `/${rest.join("/")}`, q: u.searchParams, headers: init.headers ?? {} };
    asked.push(at);
    const r = routes(at);
    if (r instanceof Response) return r;
    if (r === undefined) return new Response("no", { status: 404 });
    if (Buffer.isBuffer(r)) return new Response(r, { headers: { "content-type": "image/png", "content-length": String(r.length) } });
    return Response.json(r);
  };
  f.asked = asked;
  return f;
}
const keys = (have) => async (provider) => have[provider] ?? null;

test("with no keys, Openverse is searched, for only what a business may use freely, and the others say they need a key", async () => {
  forgetStock();
  const f = fake(({ host, path }) => host === "api.openverse.org" && path === "/v1/images/" ? { results: [ov(OV1)], page_count: 3 } : undefined);
  const r = await searchStock(store, { q: "  sourdough   loaf ", kind: "image" }, { fetch: f, key: keys({}), base: BASE });
  assert.equal(f.asked.length, 1, "only the source with no key was asked");
  const q = f.asked[0].q;
  assert.equal(q.get("q"), "sourdough loaf");
  assert.equal(q.get("license"), "cc0,pdm,by", "not its own commercial filter, which lets Sampling+ and BY-SA through");
  assert.equal(q.get("page_size"), "20", "the most it gives with no key");
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].id, `openverse:${OV1}`);
  assert.equal(r.items[0].license, "CC BY 4.0");
  assert.equal(r.items[0].author, "Ana Lee");
  assert.equal(r.items[0].attribution, `"Loaf" by Ana Lee is licensed under CC BY 4.0.`);
  assert.deepEqual(r.sources.map((s) => [s.provider, s.state]), [["pixabay", "no-key"], ["pexels", "no-key"], ["openverse", "ok"]]);
  assert.equal(r.sources.find((s) => s.provider === "openverse").more, true);
});

test("video comes only from the sources that have it", async () => {
  forgetStock();
  const f = fake(() => undefined);
  const r = await searchStock(store, { q: "bread", kind: "video" }, { fetch: f, key: keys({}), base: BASE });
  assert.equal(f.asked.length, 0);
  assert.equal(r.sources.find((s) => s.provider === "openverse").state, "none");
});

test("each key goes only to its own source, results are mixed a couple at a time, and one source failing leaves the others", async () => {
  forgetStock();
  const f = fake(({ host, path, q }) => {
    if (host === "pixabay.com" && path === "/api/") return { totalHits: 100, hits: [pixHit(1), pixHit(2), pixHit(3)] };
    if (host === "api.pexels.com") return new Response("down", { status: 503 });
    if (host === "api.openverse.org") return { results: [ov(OV1), ov(OV2, "cc0")], page_count: 1 };
    return q && undefined;
  });
  const r = await searchStock(store, { q: "bread", kind: "image" }, { fetch: f, key: keys({ pixabay: "PIXKEY-123", pexels: "PEXKEY-456" }), base: BASE });
  for (const a of f.asked) {
    const sent = `${a.q}${JSON.stringify(a.headers)}`;
    if (a.host === "pixabay.com") assert.match(sent, /PIXKEY-123/); else assert.doesNotMatch(sent, /PIXKEY-123/);
    if (a.host === "api.pexels.com") assert.equal(a.headers.authorization, "PEXKEY-456"); else assert.doesNotMatch(sent, /PEXKEY-456/);
  }
  assert.deepEqual(r.items.map((i) => i.id), ["pixabay:1", "pixabay:2", `openverse:${OV1}`, `openverse:${OV2}`, "pixabay:3"]);
  const pex = r.sources.find((s) => s.provider === "pexels");
  assert.equal(pex.state, "error");
  assert.match(pex.note, /Pexels answered 503/);
  assert.doesNotMatch(JSON.stringify(r), /PIXKEY|PEXKEY/, "no key in what the browser gets");
  const pix = r.items[0];
  assert.equal(pix.title, "bread, loaf, bakery");
  assert.equal(pix.authorUrl, "https://pixabay.com/users/baker-7/");
  assert.equal(pix.license, "Pixabay Content License");
});

test("a key a source refuses says to check it, without the key", async () => {
  forgetStock();
  const f = fake(({ host }) => host === "pixabay.com" ? new Response("[ERROR 400] Invalid or missing API key", { status: 401 }) : { results: [] });
  const r = await searchStock(store, { q: "bread", kind: "image" }, { fetch: f, key: keys({ pixabay: "WRONG-KEY" }), base: BASE });
  const pix = r.sources.find((s) => s.provider === "pixabay");
  assert.match(pix.note, /did not take the key/);
  assert.doesNotMatch(pix.note, /WRONG-KEY/);
});

test("the same search again is answered from memory, for a day", async () => {
  forgetStock();
  const f = fake(({ host }) => host === "api.openverse.org" ? { results: [ov(OV1)], page_count: 1 } : undefined);
  await searchStock(store, { q: "rye", kind: "image" }, { fetch: f, key: keys({}), base: BASE });
  await searchStock(store, { q: "rye", kind: "image" }, { fetch: f, key: keys({}), base: BASE });
  assert.equal(f.asked.length, 1);
  await searchStock(store, { q: "rye", kind: "image", page: 2 }, { fetch: f, key: keys({}), base: BASE });
  assert.equal(f.asked.length, 2, "another page is another search");
});

test("a search needs words and a kind", async () => {
  await assert.rejects(searchStock(store, { q: "   ", kind: "image" }, { fetch: fake(() => undefined), key: keys({}), base: BASE }), /Say what to look for/);
  await assert.rejects(searchStock(store, { q: "bread", kind: "font" }, { fetch: fake(() => undefined), key: keys({}), base: BASE }), /photos, videos or sound/);
});

test("adding one asks its source for it again by id, and keeps its credit, licence and tags", async () => {
  forgetStock();
  const f = fake(({ host, path, q }) => {
    if (host === "pixabay.com" && path === "/api/" && q.get("id") === "42") return { hits: [pixHit(42)] };
    if (host === "pixabay.com" && path === "/get/42_1280.png") return png;
    return undefined;
  });
  const r = await addStock(store, { id: "pixabay:42", kind: "image", to: p.id, tags: ["bread"] }, { fetch: f, key: keys({ pixabay: "PIXKEY" }), base: BASE });
  assert.equal(r.existing, false);
  assert.equal(r.yarn.kind, "image");
  assert.equal(r.yarn.name, "bread, loaf, bakery");
  assert.deepEqual([...r.yarn.tags].sort(), ["bread", "pixabay", "stock"]);
  const s = r.yarn.meta.stock;
  assert.equal(s.provider, "pixabay");
  assert.equal(s.id, "pixabay:42");
  assert.equal(s.page, "https://pixabay.com/photos/bread-42/");
  assert.equal(s.credit, "Photo by baker on Pixabay (Pixabay Content License)");
  assert.doesNotMatch(JSON.stringify(r.yarn), /PIXKEY/);
  const again = await addStock(store, { id: "pixabay:42", kind: "image", to: p.id }, { fetch: f, key: keys({ pixabay: "PIXKEY" }), base: BASE });
  assert.equal(again.existing, true, "the same file twice is the one there");
  assert.equal(again.yarn.id, r.yarn.id);
  assert.equal(f.asked.filter((a) => a.q.get("id") === "42").length, 2, "looked up fresh each time: Pixabay's file addresses expire");
});

test("an Openverse one goes to the Library with the source's own credit line", async () => {
  forgetStock();
  const f = fake(({ host, path }) => {
    if (host === "api.openverse.org" && path === `/v1/images/${OV1}/`) return ov(OV1);
    if (host === "live.staticflickr.com") return png;
    return undefined;
  });
  const r = await addStock(store, { id: `openverse:${OV1}`, kind: "image", to: LIBRARY_ID }, { fetch: f, key: keys({}), base: BASE });
  assert.equal(r.yarn.projectId, LIBRARY_ID);
  assert.equal(r.yarn.meta.stock.credit, `"Loaf" by Ana Lee is licensed under CC BY 4.0.`);
  assert.equal(r.yarn.meta.stock.license, "CC BY 4.0");
  assert.equal(needsCredit(r.yarn.meta.stock.license), true);
});

test("a file from somewhere other than the source's own site is not fetched, nor is a redirect away from it", async () => {
  forgetStock();
  const elsewhere = fake(({ host, q }) => host === "pixabay.com" && q.get("id") ? { hits: [pixHit(9, { largeImageURL: "https://evil.example/x.png" })] } : host === "evil.example" ? png : undefined);
  await assert.rejects(addStock(store, { id: "pixabay:9", kind: "image", to: p.id }, { fetch: elsewhere, key: keys({ pixabay: "K" }), base: BASE }), /other than its own site/);
  assert.equal(elsewhere.asked.some((a) => a.host === "evil.example"), false);

  const bounced = fake(({ host, path, q }) => {
    if (host === "pixabay.com" && q.get("id")) return { hits: [pixHit(10)] };
    if (host === "pixabay.com" && path === "/get/10_1280.png") return new Response(null, { status: 302, headers: { location: "https://evil.example/y.png" } });
    if (host === "evil.example") return png;
    return undefined;
  });
  await assert.rejects(addStock(store, { id: "pixabay:10", kind: "image", to: p.id }, { fetch: bounced, key: keys({ pixabay: "K" }), base: BASE }), /other than its own site/);
  assert.equal(bounced.asked.some((a) => a.host === "evil.example"), false);
});

test("an Openverse one whose licence is not free for a business is refused, even by id", async () => {
  forgetStock();
  const f = fake(({ host, path }) => host === "api.openverse.org" && path === `/v1/images/${OV2}/` ? ov(OV2, "by-nc") : host === "live.staticflickr.com" ? png : undefined);
  await assert.rejects(addStock(store, { id: `openverse:${OV2}`, kind: "image", to: p.id }, { fetch: f, key: keys({}), base: BASE }), /does not let a business use it freely/);
  assert.equal(f.asked.some((a) => a.host === "live.staticflickr.com"), false);
});

test("a Pexels photo comes at twice its large size, with the key in the header", async () => {
  forgetStock();
  const other = await sharp({ create: { width: 60, height: 40, channels: 3, background: { r: 20, g: 90, b: 160 } } }).png().toBuffer();
  const f = fake(({ host, path }) => {
    if (host === "api.pexels.com" && path === "/v1/photos/2014422") return { id: 2014422, url: "https://www.pexels.com/photo/brown-bread-on-table-2014422/", width: 64, height: 48, alt: "", photographer: "Joe", photographer_url: "https://www.pexels.com/@joe", src: { original: "https://images.pexels.com/photos/2014422/o.png", large2x: "https://images.pexels.com/photos/2014422/l2.png", large: "https://images.pexels.com/photos/2014422/l.png", medium: "https://images.pexels.com/photos/2014422/m.png" } };
    if (host === "images.pexels.com" && path === "/photos/2014422/l2.png") return other;
    return undefined;
  });
  const r = await addStock(store, { id: "pexels:2014422", kind: "image", to: p.id }, { fetch: f, key: keys({ pexels: "PEX" }), base: BASE });
  assert.equal(r.yarn.name, "Brown bread on table");
  assert.equal(r.yarn.meta.stock.credit, "Photo by Joe on Pexels (Pexels License)");
  assert.equal(f.asked[0].headers.authorization, "PEX");
});

test("adding needs a real id, the right kind, and the source's key", async () => {
  const deps = { fetch: fake(() => undefined), key: keys({}), base: BASE };
  await assert.rejects(addStock(store, { id: "https://pixabay.com/get/1.png", kind: "image", to: p.id }, deps), /not a stock id/);
  await assert.rejects(addStock(store, { id: "freesound:123", kind: "audio", to: p.id }, deps), /not a stock id/);
  await assert.rejects(addStock(store, { id: "pixabay:1", kind: "audio", to: p.id }, deps), /Pixabay has no sound/);
  await assert.rejects(addStock(store, { id: "pixabay:1", kind: "image", to: p.id }, deps), /needs a free key first/);
});

test("the credit line names the kind, the maker, the source and the licence", () => {
  assert.equal(creditLine({ provider: "pexels", kind: "video", author: "Joe", license: "Pexels License" }), "Video by Joe on Pexels (Pexels License)");
  assert.equal(creditLine({ provider: "openverse", kind: "audio", license: "CC0 1.0" }), "Sound on Openverse (CC0 1.0)");
  assert.equal(needsCredit("CC0 1.0"), false);
  assert.equal(needsCredit("Public Domain Mark"), false);
  assert.equal(needsCredit("CC BY 4.0"), true);
});
