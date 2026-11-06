import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_PROFILE, getBrief, openStore, saveProfile, setBriefNotes, setProfile, undoProfile } from "../src/node.ts";
import { allowed, pageKey, rankOf, readPage, readRobots, readSitemap, readWebsite, textOf } from "../src/crawl.ts";

const dir = mkdtempSync(join(tmpdir(), "knitted-brief-"));
const store = openStore(join(dir, "k.db"));
const project = store.createProject({ name: "Brief tests", starter: "social" });

// ── the profile ──────────────────────────────────────────────────────────────
test("a project's brief starts empty, and a person's profile is kept as they wrote it", () => {
  const empty = getBrief(store, project.id);
  assert.equal(empty.profile, "");
  assert.equal(empty.canUndo, false);
  const b = saveProfile(store, project.id, "# Hollow Oak Bakery\r\n\nSourdough, baked daily.  ");
  assert.equal(b.profile, "# Hollow Oak Bakery\n\nSourdough, baked daily.");
  assert.equal(b.by, "human");
  assert.equal(b.source.kind, "written");
  assert.equal(b.canUndo, false, "a person's own save is not something to undo");
  assert.ok(store.activity(project.id, 5).some((a) => a.action === "brief.changed"));
});

test("a build keeps the profile from before it, and Undo puts that back once", () => {
  const before = getBrief(store, project.id).profile;
  const built = setProfile(store, project.id, "# Hollow Oak\n\nBuilt from the site.", { built: true, source: { kind: "site", url: "https://hollowoak.example", pages: [{ url: "https://hollowoak.example", title: "Home" }] } });
  assert.equal(built.by, "model");
  assert.equal(built.canUndo, true);
  assert.ok(built.builtAt);
  assert.equal(built.source.pages.length, 1);
  assert.ok(store.activity(project.id, 5).some((a) => a.action === "brief.built"));
  const back = undoProfile(store, project.id);
  assert.equal(back.profile, before);
  assert.equal(back.canUndo, false);
  assert.throws(() => undoProfile(store, project.id), /no profile from before/);
});

test("a person's edit after a build leaves Undo going back to before the build", () => {
  saveProfile(store, project.id, "Mine.");
  setProfile(store, project.id, "The model's.", { actor: "model" });
  saveProfile(store, project.id, "The model's, edited.");
  assert.equal(getBrief(store, project.id).canUndo, true);
  assert.equal(undoProfile(store, project.id).profile, "Mine.");
});

test("notes for the builder are kept apart from the profile, and a profile has a size it stays under", () => {
  const b = setBriefNotes(store, project.id, "We closed the Elm Street shop in May.");
  assert.equal(b.notes, "We closed the Elm Street shop in May.");
  assert.equal(b.profile, "Mine.");
  assert.throws(() => saveProfile(store, project.id, "x".repeat(MAX_PROFILE + 1)), /Keep it under/);
  assert.throws(() => setProfile(store, project.id, "   "), /needs something in it/);
});

test("a duplicated project brings its brief along", () => {
  const copy = store.duplicateProject(project.id);
  assert.equal(getBrief(store, copy.id).profile, "Mine.");
  assert.equal(getBrief(store, copy.id).canUndo, false);
});

// ── a page, read ─────────────────────────────────────────────────────────────
const HOME = `<!doctype html><html lang="en"><head><title>Hollow Oak Bakery | Sourdough in Portland</title>
<meta name="description" content="Naturally leavened bread &amp; pastries, baked daily.">
<link rel="canonical" href="https://hollowoak.example/">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Bakery","name":"Hollow Oak Bakery","telephone":"+1 503 555 0100","image":"https://x/y.jpg","address":{"@type":"PostalAddress","streetAddress":"12 Elm St","addressLocality":"Portland"}}</script>
<script>window.track = "do not read me";</script><style>.x{color:red}</style></head>
<body><header><nav><a href="/">Home</a><a href="/about-us">About</a><a href="/menu">Menu</a><a href="/cart">Cart</a><a href="https://instagram.com/hollowoak">Instagram</a></nav></header>
<main><h1>Bread worth waking up for</h1><p>We bake sourdough&nbsp;every morning with flour from Oregon farms.</p>
<ul><li>Country loaf</li><li>Rye</li></ul><img src="a.jpg" alt="A tray of morning buns, still steaming"><a href="mailto:hello@hollowoak.example">Email us</a> <a href="tel:+15035550100">Call</a>
<a href="/blog/2026/why-we-ferment#top">Why we ferment</a><a href="/menu.pdf">Menu as a PDF</a></main>
<footer><p>12 Elm St, Portland. Open 7 to 3.</p></footer></body></html>`;

test("a page is read as text: its main part, marked as markdown marks it, with nothing on it run", () => {
  const p = readPage(HOME, "https://hollowoak.example/");
  assert.equal(p.title, "Hollow Oak Bakery | Sourdough in Portland");
  assert.equal(p.description, "Naturally leavened bread & pastries, baked daily.");
  assert.equal(p.lang, "en");
  assert.match(p.text, /^# Bread worth waking up for$/m);
  assert.match(p.text, /^We bake sourdough every morning with flour from Oregon farms\.$/m);
  assert.match(p.text, /^- Country loaf$/m);
  assert.match(p.text, /\[picture: A tray of morning buns, still steaming\]/);
  assert.doesNotMatch(p.text, /do not read me|color:red|Cart/);
  assert.deepEqual(p.emails, ["hello@hollowoak.example"]);
  assert.deepEqual(p.social, ["https://instagram.com/hollowoak"]);
  assert.ok(p.links.includes("https://hollowoak.example/about-us"));
  assert.ok(p.links.includes("https://hollowoak.example/blog/2026/why-we-ferment"), "a link's fragment is not another page");
  assert.ok(!p.links.some((l) => l.endsWith(".pdf")), "a file is not a page");
  assert.equal(p.structured[0].name, "Hollow Oak Bakery");
  assert.equal(p.structured[0].image, undefined, "how the page is built is left out");
  assert.equal(p.structured[0].address.streetAddress, "12 Elm St");
});

test("a page with no main part is read without its header and footer, and a thin one with them", () => {
  assert.equal(textOf("<p>One</p><p>One</p><div>Two&amp;three</div>"), "One\nTwo&three");
  const bare = readPage("<html><body><nav>Menu Links</nav><div>" + "A good long paragraph about the business. ".repeat(8) + "</div><footer>Footer bits</footer></body></html>", "https://a.example/x");
  assert.doesNotMatch(bare.text, /Menu Links|Footer bits/);
  const thin = readPage("<html><body><header>Shop name</header><div>Hi</div><footer>Call 555</footer></body></html>", "https://a.example/");
  assert.match(thin.text, /Shop name/);
});

test("robots.txt is read for this reader, or any reader, and the longest rule wins", () => {
  const r = readRobots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\nAllow: /private/menu\nDisallow: /*.json$\nSitemap: https://a.example/map.xml\n");
  assert.deepEqual(r.sitemaps, ["https://a.example/map.xml"]);
  assert.equal(allowed(r, "/"), true);
  assert.equal(allowed(r, "/private/notes"), false);
  assert.equal(allowed(r, "/private/menu"), true);
  assert.equal(allowed(r, "/data.json"), false);
  assert.equal(allowed(r, "/data.json?x=1"), true);
  const mine = readRobots("User-agent: knitted\nDisallow: /\n\nUser-agent: *\nAllow: /\n");
  assert.equal(allowed(mine, "/about"), false, "a rule for this reader by name is the one kept to");
  assert.equal(allowed(readRobots("User-agent: *\nDisallow:\n"), "/x"), true, "an empty Disallow allows everything");
});

test("pages are taken in the order they matter, and pages that say nothing about the business are not", () => {
  const start = new URL("https://a.example/");
  const score = (p) => rankOf(new URL(p, start), start)?.score ?? null;
  assert.ok(score("/about") < score("/pricing"));
  assert.ok(score("/pricing") < score("/blog/hello"));
  assert.ok(score("/blog/hello") < score("/careers"));
  assert.ok(score("/wholesale") < score("/contact"), "a page at the top of the site says what it offers");
  assert.ok(score("/some/other/page") < score("/careers"));
  for (const p of ["/cart", "/login", "/privacy-policy", "/tag/bread", "/blog/page/3", "/search?q=x", "/fr/a-propos", "/menu.pdf"]) assert.equal(score(p), null, p);
  assert.notEqual(rankOf(new URL("https://a.example/fr/menu"), new URL("https://a.example/fr/")), null, "the language given is the site's own");
  assert.equal(pageKey(new URL("https://www.a.example/About/?utm_source=x#team")), "https://a.example/About");
  assert.deepEqual(readSitemap("<sitemapindex><sitemap><loc>https://a.example/pages.xml</loc></sitemap></sitemapindex>"), { pages: [], sitemaps: ["https://a.example/pages.xml"] });
});

// ── a site, read ─────────────────────────────────────────────────────────────
/** A website made of strings: what each address answers. */
function site(raw) {
  const pages = Object.fromEntries(Object.entries(raw).map(([k, v]) => [pageKey(new URL(k)), v]));
  const asked = [];
  const fetcher = async (url, { what = "page" } = {}) => {
    asked.push(pageKey(new URL(url)));
    const u = new URL(url);
    const key = pageKey(u);
    const p = pages[key];
    if (!p) throw new Error(`That ${what} is not there (it answered 404).`);
    if (p.redirect) return fetcher(new URL(p.redirect, u).href, { what });
    return { buf: Buffer.from(p.body ?? p), url: u, type: p.type ?? (key.endsWith(".xml") || key.endsWith(".txt") ? "text/plain" : "text/html"), truncated: false, status: 200 };
  };
  return { fetcher, asked };
}
const page = (title, body, links = "") => `<html><head><title>${title}</title></head><body><header><a href="/">Hollow Oak</a> Fresh bread daily</header><main>${body}${links}</main><footer>12 Elm St, Portland. Open 7 to 3.</footer></body></html>`;

test("a website is read from the page given, its map and its links, about it first, and its frame kept once", async () => {
  const blog = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`https://hollowoak.example/blog/post-${i}`, page(`Post ${i}`, `<p>Post number ${i} about our bread and our bakers and what we make.</p>`)]));
  const { fetcher, asked } = site({
    "https://hollowoak.example": page("Hollow Oak Bakery", "<h1>Bread worth waking up for</h1><p>Sourdough, baked daily in Portland since 2011.</p>", '<a href="/about">About</a><a href="/secret">Secret</a>'),
    "https://hollowoak.example/robots.txt": "User-agent: *\nDisallow: /secret\nSitemap: https://hollowoak.example/map.xml\n",
    "https://hollowoak.example/map.xml": `<urlset>${["/menu", "/contact", "/wholesale", "/cart", ...Object.keys(blog).map((u) => new URL(u).pathname)].map((p) => `<url><loc>https://hollowoak.example${p}</loc></url>`).join("")}</urlset>`,
    "https://hollowoak.example/about": page("About us", "<h1>About</h1><p>Two bakers who left their office jobs to bake bread for their neighbours.</p>"),
    "https://hollowoak.example/menu": page("Menu", "<h1>Menu</h1><ul><li>Country loaf, 9 dollars</li><li>Rye, 10 dollars</li></ul>"),
    "https://hollowoak.example/contact": page("Contact", '<p>Write to <a href="mailto:hello@hollowoak.example">hello@hollowoak.example</a> any time you like.</p>'),
    "https://hollowoak.example/wholesale": { redirect: "/menu" },
    "https://hollowoak.example/secret": page("Secret", "<p>Not for readers.</p>"),
    ...blog,
  });
  const seen = [];
  const s = await readWebsite("hollowoak.example", { fetcher, maxPages: 12, onPage: (p) => seen.push(p.url) });
  const urls = s.pages.map((p) => p.url);
  assert.equal(urls[0], "https://hollowoak.example/", "the page given comes first");
  assert.ok(urls.includes("https://hollowoak.example/about"));
  assert.ok(urls.includes("https://hollowoak.example/menu"));
  assert.ok(urls.includes("https://hollowoak.example/contact"));
  assert.ok(!urls.includes("https://hollowoak.example/secret"), "robots.txt is kept to");
  assert.ok(!asked.includes("https://hollowoak.example/secret"), "and not even asked for");
  assert.ok(!urls.includes("https://hollowoak.example/cart"));
  assert.equal(urls.filter((u) => u.includes("/blog/")).length, 6, "only so many posts");
  assert.equal(urls.filter((u) => u.endsWith("/menu")).length, 1, "a redirect to a page already read is not read twice");
  assert.ok(s.skipped.some((x) => x.url.endsWith("/secret") && /robots/.test(x.why)));
  assert.match(s.siteWide, /12 Elm St, Portland/);
  assert.ok(s.pages.every((p) => !p.text.includes("12 Elm St")), "what every page repeats is kept once, apart");
  assert.equal(s.name, "Hollow Oak Bakery");
  assert.deepEqual(s.emails, ["hello@hollowoak.example"]);
  assert.ok(seen.length >= urls.length);
});

test("a site that asks readers not to read it is read no further than the page given", async () => {
  const { fetcher } = site({
    "https://shy.example": page("Shy", "<p>Hello there, this is a shy little website with a few words.</p>", '<a href="/about">About</a>'),
    "https://shy.example/robots.txt": "User-agent: *\nDisallow: /\n",
    "https://shy.example/about": page("About", "<p>About us</p>"),
  });
  const s = await readWebsite("https://shy.example/", { fetcher });
  assert.equal(s.pages.length, 1);
  assert.ok(s.notes.some((n) => /robots\.txt asks/.test(n)));
});

test("a link that is not a web page is turned away, and a site's words are kept to a size", async () => {
  const { fetcher } = site({ "https://img.example/x.png": { body: "PNG", type: "image/png" } });
  await assert.rejects(readWebsite("https://img.example/x.png", { fetcher }), /not a web page/);
  const long = site({ "https://long.example": page("Long", `<p>${"Lots of words about the business. ".repeat(2000)}</p>`) });
  const s = await readWebsite("https://long.example", { fetcher: long.fetcher, maxChars: 5000 });
  assert.ok(s.pages[0].text.length <= 5000);
});
