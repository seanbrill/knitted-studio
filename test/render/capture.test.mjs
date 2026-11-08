// Pictures of a website, in a REAL browser: the size of each, where they go, that taking
// them again replaces them, and that the page's own scripts reach nothing they may not.
// Not part of `npm test` (it needs Chromium); `npm run test:render` runs it.

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { listYarn, openStore, yarnPath } from "@knitted/core/node";
import { captureSite, openBrowser } from "@knitted/engine";

const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-capture-")), "k.db"));
const project = store.createProject({ name: "Capture tests", starter: "social" });
const browser = await openBrowser();

// What the page tries to reach that it must not: another address, standing in for the person's own network.
let reached = 0;
const inside = createServer((_, res) => { reached++; res.end("secret"); });
await new Promise((r) => inside.listen(0, "127.0.0.1", r));
const secret = `http://localhost:${inside.address().port}/secret`;

let colour = "#ff5a0f";
const site = createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  if (req.url === "/") return res.end(`<!doctype html><title>Home | Hollow Oak</title><body style="margin:0;background:${colour}"><div style="height:2400px">Hello</div><script>fetch(${JSON.stringify(secret)}).catch(()=>{}); new Image().src=${JSON.stringify(secret)};</script></body>`);
  if (req.url === "/about") return res.end('<!doctype html><title>About us | Hollow Oak</title><body style="margin:0"><h1>About</h1></body>');
  res.statusCode = 404; res.end("no");
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${site.address().port}`;
const allow = async (u) => u.host === new URL(base).host;
after(async () => { await browser.close(); site.close(); inside.close(); });

test("each page is pictured at a desktop's width and a phone's, the whole way down, into the reference", async () => {
  const pages = [{ url: `${base}/`, title: "Home | Hollow Oak" }, { url: `${base}/about`, title: "About us | Hollow Oak" }, { url: `${base}/gone`, title: "Gone" }];
  const seen = [];
  const r = await captureSite(store, project.id, pages, { browser, allow, siteName: "Hollow Oak", onShot: (s) => seen.push(s.done) });
  assert.equal(r.shots.length, 4);
  assert.deepEqual(r.skipped.map((s) => [s.url.endsWith("/gone"), /404/.test(s.why)]), [[true, true], [true, true]]);
  assert.equal(seen.at(-1), 6);
  const files = listYarn(store, project.id, { shelf: "reference" });
  const home = files.find((y) => y.meta.site?.device === "desktop" && y.meta.site.url.endsWith("/"));
  const phone = files.find((y) => y.meta.site?.device === "mobile" && y.meta.site.url.endsWith("/"));
  assert.equal(home.name, "Home, desktop");
  assert.equal(home.folder, "Website/Desktop");
  assert.deepEqual(home.tags, ["website", "desktop"]);
  assert.deepEqual([home.width, home.height], [2880, 4800], "the whole page, not the window, at twice its pixels so a crop of it stays sharp");
  assert.equal(phone.width, 780, "a phone's width, drawn at twice its pixels");
  assert.equal(phone.folder, "Website/Mobile");
  assert.equal(files.find((y) => y.meta.site?.url.endsWith("/about") && y.meta.site.device === "desktop").name, "About us (about), desktop");
  const { data } = await sharp(yarnPath(store, home)).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 230 && data[1] > 70 && data[1] < 110, "it looks like the page");
  assert.equal(reached, 0, "the page's own scripts reached nothing outside the site");
  assert.equal(store.activity(project.id, 10).filter((a) => a.action === "yarn.imported").length, 0, "pictures taken together are not said one by one");
});

test("taken again, a page's picture is replaced where it is, and shows the page as it is now", async () => {
  const before = listYarn(store, project.id, { shelf: "reference" }).find((y) => y.meta.site?.device === "desktop" && y.meta.site.url.endsWith("/"));
  colour = "#1d4ed8";
  const r = await captureSite(store, project.id, [{ url: `${base}/`, title: "Home | Hollow Oak" }], { browser, allow, devices: ["desktop"] });
  assert.equal(r.shots[0].replaced, true);
  const now = listYarn(store, project.id, { shelf: "reference" }).filter((y) => y.meta.site?.device === "desktop" && y.meta.site.url.endsWith("/"));
  assert.equal(now.length, 1);
  assert.equal(now[0].id, before.id, "the same file, with a new picture");
  assert.notEqual(now[0].hash, before.hash);
  const { data } = await sharp(yarnPath(store, now[0])).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[2] > 180 && data[0] < 60, "blue now");
});

test("the site reader reads a page as it is drawn: a section its script fills in is there to read", async () => {
  const drawn = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    if (req.url === "/robots.txt") { res.setHeader("content-type", "text/plain"); return res.end("User-agent: *\nAllow: /\n"); }
    // As notch.fm's "Works with" band arrives: an empty box its script fills in.
    res.end(`<!doctype html><title>Works with</title><body><main><h2>Nothing to connect</h2><section id="works-with"></section></main>
      <script>document.querySelector("#works-with").innerHTML = "<p>Apple Music <b>Ready now</b></p><p>Spotify <b>Planned</b></p>";</script></body>`);
  });
  await new Promise((r) => drawn.listen(0, "127.0.0.1", r));
  const at = `http://127.0.0.1:${drawn.address().port}/`;
  const { readWebsite } = await import("@knitted/core/node");
  const { renderingFetcher } = await import("@knitted/engine");
  // The test's server is on this computer, which the real reader refuses: a stand-in that lets it through.
  const plain = async (url) => { const r = await fetch(url); return { buf: Buffer.from(await r.arrayBuffer()), url: new URL(r.url), type: r.headers.get("content-type") ?? "", truncated: false, status: r.status }; };
  try {
    const before = await readWebsite(at, { fetcher: plain, maxPages: 1 });
    assert.doesNotMatch(before.pages[0].text, /Spotify/, "as it arrives, the band is empty");
    const r = await renderingFetcher({ browser, allow: async (u) => u.host === new URL(at).host, fetcher: plain });
    const after_ = await readWebsite(at, { fetcher: r.fetcher, maxPages: 1 });
    await r.close();
    assert.match(after_.pages[0].text, /Spotify Planned/);
    assert.match(after_.pages[0].text, /Apple Music Ready now/);
  } finally { drawn.close(); }
});
