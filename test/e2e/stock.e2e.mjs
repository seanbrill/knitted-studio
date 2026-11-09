// Free stock, through the studio as a person uses it: search with no key (Openverse), add a
// Pixabay key in Settings, search again, add a photo to a project and one to the Library, and
// see its credit in Yarn. Every source here is a stand-in on this computer (KNITTED_STOCK_API),
// which checks what it is sent; nothing reaches a real source, and the key goes to the test's
// own secrets folder.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createServer } from "node:http";
import sharp from "sharp";
import { axeProblems, launchBrowser, serverHas, startStudio } from "./harness.mjs";

let studio, browser, context, page, fake, projectId;
const asked = [];
const KEY = "pix-test-key-31337";
const OV = ["4bc43a04-ef46-4544-a0c1-63c63f56e276", "5cd43a04-ef46-4544-a0c1-63c63f56e277"];
const pictures = {};
const picture = async (n) => (pictures[n] ??= await sharp({ create: { width: 80, height: 60, channels: 3, background: { r: (n * 70) % 255, g: (n * 40) % 255, b: 120 } } }).png().toBuffer());
const j = async (method, path, body) => {
  const res = await fetch(studio.url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const ov = (id, n) => ({ id, title: `Rye loaf ${n}`, url: `https://live.staticflickr.com/1/${n}.png`, creator: "Ana Lee", creator_url: "https://www.flickr.com/people/ana", license: "by", license_version: "4.0", license_url: "https://creativecommons.org/licenses/by/4.0/", thumbnail: `https://api.openverse.org/v1/images/${id}/thumb/`, width: 80, height: 60, foreign_landing_url: `https://www.flickr.com/photos/ana/${n}`, attribution: `"Rye loaf ${n}" by Ana Lee is licensed under CC BY 4.0.` });
const hit = (id) => ({ id, pageURL: `https://pixabay.com/photos/bread-${id}/`, tags: `sourdough, crust, bread ${id}`, user: "baker", user_id: 7, previewURL: `https://cdn.pixabay.com/photo/${id}_150.png`, webformatURL: `https://pixabay.com/get/${id}_640.png`, largeImageURL: `https://pixabay.com/get/${id}_1280.png`, imageWidth: 80, imageHeight: 60 });

/** The stand-in for every source: every address is /<host>/<path>, as KNITTED_STOCK_API sends it. */
function fakeSources() {
  return createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const [host, ...rest] = u.pathname.slice(1).split("/");
    const path = `/${rest.join("/")}`;
    asked.push({ host, path, search: u.search, auth: req.headers.authorization ?? "" });
    const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const png = async (n) => { const b = await picture(n); res.writeHead(200, { "content-type": "image/png", "content-length": String(b.length) }); res.end(b); };
    if (host === "api.openverse.org" && path === "/v1/images/") return send(200, { results: OV.map((id, i) => ov(id, i + 1)), page_count: 1 });
    if (host === "api.openverse.org" && path === "/v1/audio/") return send(200, { results: [{ ...ov(OV[0], 9), title: "Oven timer", url: "https://cdn.freesound.org/previews/1/timer.mp3", thumbnail: null, duration: 4200 }], page_count: 1 });
    if (host === "api.openverse.org" && path.startsWith("/v1/images/")) { const i = OV.indexOf(path.split("/")[3]); return i < 0 ? send(404, {}) : send(200, ov(OV[i], i + 1)); }
    if (host === "live.staticflickr.com") return png(Number(path.match(/(\d+)\.png$/)[1]));
    if (host === "pixabay.com" && path === "/api/") {
      if (u.searchParams.get("key") !== KEY) return send(400, "[ERROR 400] Invalid or missing API key");
      const id = u.searchParams.get("id");
      return send(200, id ? { totalHits: 1, hits: [hit(Number(id))] } : { totalHits: 3, hits: [hit(101), hit(102), hit(103)] });
    }
    if (host === "pixabay.com" && path.startsWith("/get/")) return png(Number(path.match(/(\d+)_/)[1]));
    send(404, { error: path });
  });
}

before(async () => {
  fake = fakeSources();
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  studio = await startStudio({ env: { KNITTED_STOCK_API: `http://127.0.0.1:${fake.address().port}` } });
  browser = await launchBrowser();
  context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  // The browser shows a source's own thumbnails, as the sources allow in search results: here, stand-ins.
  await context.route(/^https:\/\/(pixabay\.com|cdn\.pixabay\.com|api\.openverse\.org|live\.staticflickr\.com|cdn\.freesound\.org)\//, async (r) => r.fulfill({ body: await picture(5), contentType: "image/png" }));
  page = await context.newPage();
  projectId = (await j("POST", "/api/projects", { name: "Stock e2e" })).body.id;
});
after(async () => { await browser?.close(); await studio?.stop(); fake?.close(); });

const search = async (words) => {
  await page.getByRole("searchbox", { name: "Search free stock" }).or(page.getByLabel("Search free stock")).first().fill(words);
  await page.getByRole("search").getByRole("button", { name: "Search" }).click();
};
const results = () => page.getByRole("list", { name: "Results" }).getByRole("listitem");

test("before a search: where finds go, where they come from, and searches to start from that run with a press", async () => {
  await page.goto(`${studio.url}/stock?to=${projectId}&kind=image`);
  await page.getByText("From Openverse. A free Pixabay key adds more.").waitFor();
  assert.equal(await page.getByRole("search").getByRole("button", { name: "Search" }).isDisabled(), true, "nothing typed, nothing to search");
  await page.getByRole("group", { name: "Start from" }).getByRole("button", { name: "coffee shop" }).click();
  await page.waitForURL(/q=coffee\+shop/);
  assert.equal(await page.getByLabel("Search free stock").inputValue(), "coffee shop");
  await results().first().waitFor();
});

test("with no key, a search finds openly licensed photos, and says Pixabay has more with a free key", async () => {
  await page.goto(`${studio.url}/stock?to=${projectId}`);
  await page.getByRole("heading", { name: "Free photos, video and sound" }).waitFor();
  await search("rye bread");
  await page.waitForURL(/q=rye\+bread/);
  await results().first().waitFor();
  assert.equal(await results().count(), 2);
  await page.getByText("CC BY 4.0, credit needed").first().waitFor();
  await page.getByText(/Pixabay has more photos with a free key/).waitFor();
  assert.equal(await page.getByText(/Pexels/).count(), 0, "Pexels, which gives out no new keys, is not suggested");
  await page.getByText(/Made using Openverse, which does not endorse or certify knitted/).waitFor();
  assert.equal(asked.some((a) => a.host === "pixabay.com"), false, "no key, so Pixabay is not asked");
});

test("Settings, Stock: a Pixabay key is saved, and never comes back", async () => {
  await page.goto(`${studio.url}/settings?tab=stock`);
  await page.getByRole("heading", { name: "Free stock" }).waitFor();
  await page.getByRole("region", { name: /^Openverse/ }).getByText("Works with no key.").waitFor();
  await page.getByRole("region", { name: /^Pexels/ }).getByText(/not giving out new keys/).waitFor();
  const pix = page.getByRole("region", { name: /^Pixabay/ });
  await pix.getByRole("link", { name: /Get a free Pixabay key/ }).waitFor();
  await pix.getByLabel("Pixabay key").fill(KEY);
  await pix.getByRole("button", { name: "Save" }).click();
  await pix.getByText(/A key is saved/).waitFor();
  const cfg = await j("GET", "/api/stock/config");
  assert.equal(cfg.body.sources.find((s) => s.provider === "pixabay").key.present, true);
  assert.doesNotMatch(JSON.stringify(cfg.body), new RegExp(KEY));
});

test("with the key, Pixabay's photos are mixed in, and the key goes only to Pixabay", async () => {
  await page.goto(`${studio.url}/stock?to=${projectId}`);
  await search("sourdough");
  await page.getByText("sourdough, crust, bread 101").waitFor();
  assert.equal(await results().count(), 5);
  await page.getByText("Photos and videos from Pixabay.").waitFor();
  assert.equal(await page.locator("footer").getByRole("link", { name: "Pixabay", exact: true }).getAttribute("href"), "https://pixabay.com");
  assert.equal(await page.getByText(/has more photos with a free key/).count(), 0);
  for (const a of asked) {
    if (a.host === "pixabay.com" && a.path === "/api/") assert.match(a.search, new RegExp(`key=${KEY}`));
    else assert.doesNotMatch(`${a.search} ${a.auth}`, new RegExp(KEY), `the key went to ${a.host}${a.path}`);
  }
  assert.doesNotMatch(await page.content(), new RegExp(KEY));
});

test("adding a photo puts it in the project's Yarn with its credit, which the drawer shows", async () => {
  await page.getByRole("button", { name: "Add sourdough, crust, bread 101 to Stock e2e" }).click();
  await page.getByText("Added sourdough, crust, bread 101 to Stock e2e.").waitFor();
  const yarn = await serverHas(studio, `/api/projects/${projectId}/yarn?library=0`, (l) => l.some((y) => y.meta.stock?.id === "pixabay:101"));
  const y = yarn.find((x) => x.meta.stock?.id === "pixabay:101");
  assert.deepEqual([...y.tags].sort(), ["pixabay", "stock"]);
  assert.equal(y.meta.stock.credit, "Photo by baker on Pixabay (Pixabay Content License)");
  await page.getByRole("link", { name: "Added, see it" }).click();
  await page.waitForURL(new RegExp(`/projects/${projectId}/yarn`));
  await page.getByRole("button", { name: /sourdough, crust, bread 101/ }).first().click();
  const credit = page.getByRole("dialog").getByRole("region", { name: "Credit" });
  await credit.getByText("Free to use, no credit needed").waitFor();
  await credit.getByText("Photo by baker on Pixabay (Pixabay Content License)").waitFor();
  await credit.getByRole("link", { name: /Its page on Pixabay/ }).waitFor();
  await credit.getByRole("button", { name: "Copy the credit" }).waitFor();
});

test("a CC BY photo goes to the Library, says to credit its maker, and keeps Openverse's own credit line", async () => {
  await page.goto(`${studio.url}/stock?to=${projectId}&q=rye`);
  await results().first().waitFor();
  await page.getByRole("combobox", { name: "Adds to" }).click();
  await page.getByRole("option", { name: "The Library, for every project" }).click();
  await page.getByRole("button", { name: "Add Rye loaf 2 to the Library" }).click();
  await page.getByText("Added Rye loaf 2 to the Library.").waitFor();
  const lib = await serverHas(studio, "/api/projects/library/yarn", (l) => l.some((y) => y.meta.stock?.id === `openverse:${OV[1]}`));
  assert.equal(lib.find((y) => y.meta.stock?.id === `openverse:${OV[1]}`).meta.stock.credit, `"Rye loaf 2" by Ana Lee is licensed under CC BY 4.0.`);
  await page.goto(`${studio.url}/library`);
  await page.getByRole("button", { name: /Rye loaf 2/ }).first().click();
  const credit = page.getByRole("dialog").getByRole("region", { name: "Credit" });
  await credit.getByText("Credit the maker where you use it").waitFor();
  await credit.getByRole("link", { name: "Its page", exact: true }).waitFor(); // on the site it came from, not Openverse
  await credit.getByRole("link", { name: /CC BY 4.0/ }).waitFor();
  // Where the next one goes is remembered.
  await page.goto(`${studio.url}/stock`);
  await page.getByRole("combobox", { name: "Adds to" }).getByText("The Library, for every project").waitFor();
});

test("sound comes from Openverse, to listen to before adding; Pixabay has none", async () => {
  await page.goto(`${studio.url}/stock?to=${projectId}&q=timer&kind=audio`);
  await page.getByText("Oven timer").waitFor();
  assert.equal(await page.getByRole("radio", { name: "Sound" }).getAttribute("aria-checked"), "true");
  assert.ok(await page.locator('audio[aria-label="Listen to Oven timer"]').count());
  assert.equal(await page.getByText(/Pixabay has more/).count(), 0);
});

for (const theme of ["day", "night"]) {
  test(`no serious accessibility problems on Stock and Settings, Stock in ${theme}`, async () => {
    await page.goto(`${studio.url}/stock?to=${projectId}&q=sourdough`);
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await results().first().waitFor();
    await page.waitForTimeout(300);
    assert.deepEqual(await axeProblems(page), []);
    await page.getByRole("button", { name: "Look at sourdough, crust, bread 102" }).click();
    await page.getByRole("dialog", { name: "sourdough, crust, bread 102" }).waitFor();
    await page.waitForTimeout(300);
    assert.deepEqual(await axeProblems(page), []);
    await page.keyboard.press("Escape");
    await page.goto(`${studio.url}/settings?tab=stock`);
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.getByRole("region", { name: /^Pixabay/ }).waitFor();
    await page.waitForTimeout(300);
    assert.deepEqual(await axeProblems(page), []);
  });
}
