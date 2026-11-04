// Reading a brand off its website. The reader is pure, so most of this hands it a page
// and its CSS as text; the rest stands in for the network with a fetch that answers
// from public documentation addresses (203.0.113.x), so the address guard stays on.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { activeSwatch, createSwatchFromProposal, importYarn, listYarn, matchFonts, openStore, proposeFromWebsite, uploadTempPath } from "../src/node.ts";
import { cleanFamily, cssRules, logosOf, modeOf, nameOf, pageIsDark, parseColor, readSite, sameFamily, svgColors, varRole } from "../src/site.ts";

const store = openStore(join(mkdtempSync(join(tmpdir(), "knitted-site-")), "k.db"));
const page = (head, body = "", htmlAttrs = "") => `<!doctype html><html${htmlAttrs}><head>${head}</head><body>${body}</body></html>`;
const read = (html, css = "", extra = {}) => readSite({ html, css, url: "https://example.com/", ...extra });
const role = (p, r) => p.colors.find((c) => c.role === r);

// ── colour ──────────────────────────────────────────────────────────────────
test("every way CSS writes a colour reads as the same six digits", () => {
  assert.equal(parseColor("oklch(0.628 0.2577 29.23)"), "#ff0000", "OKLCH's pure red");
  assert.equal(parseColor("oklch(62.8% 0.2577 29.23deg)"), "#ff0000");
  assert.equal(parseColor("oklch(68.5% 0.169 237.323)"), "#00a6f4", "Tailwind 4's sky-500, as Tailwind publishes it");
  assert.equal(parseColor("hsl(262.1 83.3% 57.8%)"), "#7c3aed");
  assert.equal(parseColor("hsl(262.1, 83.3%, 57.8%)"), "#7c3aed");
  assert.equal(parseColor("rgba(10, 20, 30, 0.9)"), "#0a141e");
  assert.equal(parseColor("color(srgb 1 0.5 0)"), "#ff8000");
  assert.equal(parseColor("#abc"), "#aabbcc");
  assert.equal(parseColor("#AABBCCDD"), "#aabbcc");
  assert.equal(parseColor("white"), "#ffffff");
  for (const seeThrough of ["rgb(255 0 0 / 50%)", "#0000", "#aabbcc80", "transparent", "currentColor", "var(--x)", "red"]) assert.equal(parseColor(seeThrough), null, seeThrough);
});

// ── CSS ─────────────────────────────────────────────────────────────────────
test("an escaped quote in a Tailwind class does not swallow the rest of the sheet", () => {
  const { rules } = cssRules(String.raw`.content-\[\'\'\]{content:''}.don\'t{color:#000}.w-\[calc\(100\%-2rem\)\]{width:calc(100% - 2rem)}.after{color:#123456}`);
  assert.deepEqual(rules.map((r) => r.selector), [String.raw`.content-\[\'\'\]`, String.raw`.don\'t`, String.raw`.w-\[calc\(100\%-2rem\)\]`, ".after"]);
});

test("at-rules are flattened, keyframes and print are not rules, and fonts are collected", () => {
  const { rules, faces } = cssRules(`
    @layer base { body { color: #111 } }
    @media (min-width: 40rem) { .btn { background: #0055ff } }
    @media (prefers-color-scheme: dark) { body { color: #eee } }
    @media print { body { color: #000 } }
    @keyframes pulse { from { color: #f00 } to { color: #0f0 } }
    @font-face { font-family: "Brand Sans"; src: url(a.woff2) }
    .card { color: #222; & .title { color: #333 } }`);
  assert.deepEqual(rules.map((r) => `${r.selector} ${r.mode ?? "any"}`).sort(), [".btn any", ".card .title any", ".card any", "body any", "body dark"]);
  assert.deepEqual(faces, ["Brand Sans"]);
});

test("a selector's mode: :not(.dark) is not dark, .text-dark is a colour, night is dark", () => {
  assert.equal(modeOf(".dark .card"), "dark");
  assert.equal(modeOf(`[data-theme="night"] .card`), "dark");
  assert.equal(modeOf(".dark-mode .card"), "dark");
  assert.equal(modeOf("[data-theme=day]"), "light");
  assert.equal(modeOf("html:not(.dark) .card"), undefined);
  assert.equal(modeOf(".text-dark"), undefined);
  assert.equal(modeOf(".darken"), undefined);
});

test("a custom property's name says what it is for, and a status or a palette step says nothing", () => {
  assert.deepEqual(varRole("--primary"), { bin: "brand", hint: "primary", w: 6 });
  assert.deepEqual(varRole("--background"), { bin: "background", w: 6 });
  assert.deepEqual(varRole("--foreground"), { bin: "text", w: 6 });
  assert.deepEqual(varRole("--text-primary"), { bin: "text", w: 6 }, "the main text colour, not the brand");
  assert.equal(varRole("--primary-foreground").hint, undefined, "the text ON the primary is not a primary");
  assert.equal(varRole("--bgColor-success-emphasis"), null);
  assert.equal(varRole("--color-red-500"), null, "a palette step");
  assert.equal(varRole("--muted-foreground"), null);
  assert.equal(varRole("--accent-tint").hint, undefined, "a tint of the accent is not the accent");
  assert.equal(varRole("--brand-scrollbar-thumb-bg", new Set(["brand"])).bin, "neutral", "a design system's prefix is not a meaning");
});

// ── choosing ────────────────────────────────────────────────────────────────
test("shadcn: the variables it names are the swatch, and dark mode and danger stay out", () => {
  const css = `:root { --background: 0 0% 100%; --foreground: 222.2 84% 4.9%; --primary: 262.1 83.3% 57.8%; --primary-foreground: 210 20% 98%;
      --secondary: 220 14.3% 95.9%; --border: 220 13% 91%; --destructive: 0 84.2% 60.2% }
    .dark { --background: 224 71.4% 4.1%; --foreground: 210 20% 98%; --primary: 263.4 70% 50.4% }
    body { background-color: hsl(var(--background)); color: hsl(var(--foreground)) }
    .bg-primary { background-color: hsl(var(--primary)) } .bg-destructive { background-color: hsl(var(--destructive)) }`;
  const p = read(page("", `<button class="bg-primary">Start</button><button class="bg-destructive">Delete</button>`), css);
  assert.equal(role(p, "primary").hex, "#7c3aed");
  assert.equal(role(p, "background").hex, "#ffffff");
  assert.equal(role(p, "text").hex, "#020817");
  assert.equal(role(p, "background").from, "the page background");
  assert.ok(!p.colors.some((c) => c.hex === "#ef4444" || c.hex === "#f04848"), `no danger red in ${p.colors.map((c) => c.hex)}`);
});

test("Tailwind: a utility counts as much as the page uses it, on what it uses it", () => {
  const css = `:root { --color-sky-500: oklch(68.5% 0.169 237.323); --color-gray-950: oklch(13% 0.028 261.692); --color-red-500: oklch(63.7% 0.237 25.331); --color-gray-200: oklch(92.8% 0.006 264.531) }
    .bg-sky-500 { background-color: var(--color-sky-500) } .text-gray-950 { color: var(--color-gray-950) }
    .bg-red-500 { background-color: var(--color-red-500) } .border-gray-200 { border-color: var(--color-gray-200) }
    .dark\\:bg-gray-950:where(.dark, .dark *) { background-color: var(--color-gray-950) }`;
  const links = Array.from({ length: 4 }, () => `<a class="rounded bg-sky-500 px-4" href="/start">Start</a>`).join("");
  const p = read(page("", `${links}<div class="border border-gray-200">Card</div>`, ` class="dark:bg-gray-950"`).replace("<body>", `<body class="text-gray-950">`), css);
  assert.equal(role(p, "primary").hex, "#00a6f4");
  assert.equal(role(p, "primary").from, "buttons", "a link with a background is a button");
  assert.equal(role(p, "text").hex, "#030712", "the class on <body> is the page's text");
  assert.equal(role(p, "neutral").hex, "#e5e7eb");
  assert.ok(!p.colors.some((c) => c.hex === "#fb2c36"), "red-500 is in the sheet but nowhere on the page");
  assert.equal(role(p, "background").hex, "#ffffff", "dark:bg-gray-950 is the dark mode's");
});

test("a status colour is never the brand, however much it is used", () => {
  const css = `a { color: #0969da } .alert-danger { background: #cf222e } .flash-success { background: #1f883d } .badge-shipped { color: #1c5a36 }`;
  const alerts = Array.from({ length: 20 }, () => `<div class="alert-danger flash-success badge-shipped">!</div>`).join("");
  const p = read(page("", `<a href="/">Home</a>${alerts}`), css);
  assert.equal(role(p, "primary").hex, "#0969da");
  for (const status of ["#cf222e", "#1f883d", "#1c5a36"]) assert.ok(!p.colors.some((c) => c.hex === status), status);
});

test("a page drawn in dark mode reads its dark rules; a selector list that is only partly dark still counts in light", () => {
  const css = `:root { --bg: #ffffff; --text: #111111 } [data-theme="dark"] { --bg: #0b0b10; --text: #f5f5f5 }
    body { background: var(--bg); color: var(--text) } .btn { background: #7c5cff }`;
  const dark = read(page("", `<button class="btn">Go</button>`, ` data-theme="dark"`), css);
  assert.deepEqual([role(dark, "background").hex, role(dark, "text").hex], ["#0b0b10", "#f5f5f5"]);
  const light = read(page("", `<button class="btn">Go</button>`, ` data-theme="light"`), css);
  assert.deepEqual([role(light, "background").hex, role(light, "text").hex], ["#ffffff", "#111111"]);
  assert.equal(pageIsDark(page("", "", ` class="dark"`)), true);
  assert.equal(pageIsDark(page("", "", ` data-theme="day"`)), false);
  const listed = read(page(""), `:root, .light-theme, .dark .invert { --background: #fafafa } .dark, .dark-theme, .invert { --background: #000000 } body { background: var(--background) }`);
  assert.equal(role(listed, "background").hex, "#fafafa", "`.dark, .invert` is a dark rule and an inverted one, not the page");
  const day = read(page("", "", ` data-theme="day"`), `[data-theme="day"] { --surface: #fffbf6 } [data-theme="night"] { --surface: #17130f } body { background: var(--surface) }`);
  assert.equal(role(day, "background").hex, "#fffbf6", "the page's own theme attribute decides which block is global");
});

test("of the colours a page uses, the one in its logo is the primary", () => {
  // notch.fm's shape: cyan links outnumber the violet, and the logo is violet.
  const css = `body { background: #150829; color: #ffffff } a { color: #22d3ee } .panel { background: #b16cf8 }`;
  const html = page("", Array.from({ length: 12 }, () => `<a class="nav" href="/">x</a>`).join("") + `<div class="panel">y</div><div class="panel">z</div>`);
  const plain = read(html, css);
  assert.equal(role(plain, "primary").hex, "#22d3ee", "without the logo, usage decides");
  const withLogo = read(html, css, { logoColors: ["#150828", "#aa57f9", "#e879f9"] });
  assert.equal(role(withLogo, "primary").hex, "#b16cf8");
  assert.equal(role(withLogo, "primary").from, "backgrounds and the logo");
  assert.equal(role(withLogo, "accent").hex, "#22d3ee", "the colour of another hue is the accent");
});

test("a black and white brand gets a black primary, and a page with nothing says so", () => {
  const css = `body { background: #ffffff; color: #171717 } .btn { background: #171717; color: #fff } .promo { background: #0b57d0 }`;
  const p = read(page("", Array.from({ length: 6 }, () => `<button class="btn">Deploy</button>`).join("") + `<div class="promo">a</div>`), css);
  assert.equal(role(p, "primary").hex, "#171717");
  assert.equal(role(p, "primary").from, "buttons");
  assert.deepEqual(p.notes, []);
  const bare = read(page("<title>Plain</title>"));
  assert.equal(role(bare, "primary").from, "the page text");
  assert.match(bare.notes[0], /no brand colour/);
  assert.equal(bare.colors.length, 6, "every role is still filled, and says it was made up");
  assert.equal(role(bare, "accent").from, "made from the others");
});

// ── fonts, name, logo ───────────────────────────────────────────────────────
test("fonts: the names bundlers give them are cleaned, and system, icon and fallback faces are dropped", () => {
  assert.equal(cleanFamily("__Inter_d65c78"), "Inter");
  assert.equal(cleanFamily(`"Geist Variable"`), "Geist");
  assert.equal(cleanFamily("sohne-var"), "sohne");
  for (const not of ["__Inter_Fallback_d65c78", "MonaSansFallback", "-apple-system", "Segoe UI", "Font Awesome 6 Free", "Material Symbols Outlined", "Noto Color Emoji", "<value>", "/"]) assert.equal(cleanFamily(not), null, not);
  assert.equal(sameFamily("GeistSans", ["Geist", "Inter"]), "Geist");
  assert.equal(sameFamily("inter", ["Geist", "Inter"]), "Inter");
  assert.equal(sameFamily("Open Sans", ["Geist", "Inter"]), undefined);
  const css = `:root { --font-sans: "__Inter_d65c78", "__Inter_Fallback_d65c78", system-ui } body { font-family: var(--font-sans) }
    h1, .display { font-family: "Fraunces", serif } code { font-family: "JetBrains Mono", monospace }
    :lang(ja) body { font-family: "Noto Sans JP" } .icon { font-family: "Font Awesome 6 Free" }`;
  const p = read(page(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:wght@400;700&family=Inter">`, "<h1>Hi</h1>"), css);
  assert.deepEqual(p.fontRoles, { body: "Inter", display: "Fraunces", mono: "JetBrains Mono" });
  assert.ok(!p.fonts.includes("Noto Sans JP") && !p.fonts.some((f) => /awesome/i.test(f)), p.fonts.join(", "));
});

test("a site's name: what it calls itself, else the part of its title that is its name", () => {
  const url = new URL("https://www.acme.dev/");
  assert.equal(nameOf(page(`<meta property="og:site_name" content="Acme &amp; Co">`), url), "Acme & Co");
  assert.equal(nameOf(page(`<title>Build faster with less | Acme</title>`), url), "Acme");
  assert.equal(nameOf(page(`<title>Welcome</title>`), url), "Welcome");
  assert.equal(nameOf(page(""), url), "acme.dev");
});

test("the logo: the one the site names first, then its icons, biggest first; never a data: address", () => {
  const html = page(`<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","logo":{"url":"/brand/logo.svg"}}]}</script>
    <link rel="icon" href="/favicon.ico"><link rel="icon" type="image/svg+xml" href="/icon.svg">
    <link rel="apple-touch-icon" sizes="120x120" href="/touch-120.png"><link rel="apple-touch-icon" sizes="180x180" href="/touch-180.png">`,
  `<img class="site-logo" src="data:image/png;base64,AAAA"><img alt="Acme logo" src="/img/wordmark.png">`);
  assert.deepEqual(logosOf(html, new URL("https://acme.dev/")).map((l) => `${l.use} ${new URL(l.url).pathname}`),
    ["full /brand/logo.svg", "full /img/wordmark.png", "mark /touch-180.png", "mark /touch-120.png", "mark /icon.svg"]);
});

test("an SVG's colours are the ones it paints with most", () => {
  assert.deepEqual(svgColors(`<svg><path fill="#df5a0f"/><path fill="#DF5A0F"/><circle style="fill: #1a0e05"/><path fill="none" stroke="currentColor"/></svg>`), ["#df5a0f", "#1a0e05"]);
});

// ── over the network, with the guard on ─────────────────────────────────────
const png = (color) => sharp({ create: { width: 180, height: 180, channels: 3, background: color } }).png().toBuffer();
async function withSite(routes, fn) {
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u) => {
    const url = String(u); asked.push(url);
    const r = routes[new URL(url).pathname];
    if (!r) return new Response("not here", { status: 404, headers: { "content-type": "text/html" } });
    return typeof r === "function" ? r(url) : new Response(r.body, { status: r.status ?? 200, headers: r.headers ?? {} });
  };
  try { return await fn(asked); } finally { globalThis.fetch = real; }
}
const html = (body) => ({ body, headers: { "content-type": "text/html; charset=utf-8" } });
const css = (body) => ({ body, headers: { "content-type": "text/css" } });

test("a website is read with its stylesheets in order, an @import first, and its first logo that loads", async () => {
  const violet = await png({ r: 177, g: 108, b: 248 });
  await withSite({
    "/": html(page(`<title>Notchy</title><script type="application/ld+json">{"logo":"https://203.0.113.9/icon.png"}</script>
      <link rel="apple-touch-icon" href="/apple-icon"><link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/broken.css"><link rel="stylesheet" href="/b.css">`,
    `<a class="cta" href="/x">Go</a><div class="panel">a</div>`)),
    "/a.css": css(`@import url("/base.css"); body { color: #ffffff }`),
    "/base.css": css(`body { background: #150829; color: #000000 }`),
    "/broken.css": { status: 500, body: "oops" },
    "/b.css": css(`.cta { color: #22d3ee } .panel { background: #b16cf8 } body { font-family: "Open Sans" } h1 { font-family: Chango }`),
    "/apple-icon": { body: violet, headers: { "content-type": "image/png" } },
  }, async (asked) => {
    const p = await proposeFromWebsite("203.0.113.9");
    assert.equal(asked[0], "https://203.0.113.9/", "a bare address is read over https");
    assert.equal(role(p, "background").hex, "#150829");
    assert.equal(role(p, "text").hex, "#ffffff", "the importing sheet comes after what it imports");
    assert.equal(role(p, "primary").hex, "#b16cf8", "the logo that loaded is violet");
    assert.deepEqual(p.logo, { url: "https://203.0.113.9/apple-icon", use: "mark" }, "the structured data's logo was a 404, so the touch icon stands in");
    assert.ok(asked.indexOf("https://203.0.113.9/icon.png") < asked.indexOf("https://203.0.113.9/apple-icon"));
    assert.match(p.notes.join(" "), /One of its stylesheets could not be read/);
    assert.equal(p.name, "Notchy");
  });
});

test("a website that turns knitted away, or is not a page, says so plainly; a redirect inward is refused", async () => {
  await withSite({ "/": { status: 403, body: "no" } }, () => assert.rejects(proposeFromWebsite("https://203.0.113.9/"), /turned knitted away \(it answered 403\)/));
  await withSite({ "/": { body: "{}", headers: { "content-type": "application/json" } } }, () => assert.rejects(proposeFromWebsite("https://203.0.113.9/"), /not a web page/));
  await withSite({ "/": { status: 302, body: "", headers: { location: "http://10.0.0.1/admin" } } }, () => assert.rejects(proposeFromWebsite("https://203.0.113.9/"), /your own computer or network/));
  await withSite({
    "/": html(page(`<link rel="stylesheet" href="https://203.0.113.9/s.css">`)),
    "/s.css": { status: 301, body: "", headers: { location: "http://127.0.0.1/s.css" } },
  }, async (asked) => {
    const p = await proposeFromWebsite("https://203.0.113.9/");
    assert.match(p.notes.join(" "), /One of its stylesheets could not be read/);
    assert.ok(!asked.some((u) => u.includes("127.0.0.1")), "the inward address is never fetched");
  });
});

test("a very large page is read as far as 3MB, not refused", async () => {
  const big = page(`<title>Big | Big</title><style>body { background: #fefefe } .btn { background: #e11d48 }</style>`, `<button class="btn">Buy</button>${"<p>filler</p>".repeat(320_000)}`);
  await withSite({ "/": html(big) }, async () => {
    const p = await proposeFromWebsite("https://203.0.113.9/");
    assert.equal(role(p, "primary").hex, "#e11d48");
    assert.match(p.notes.join(" "), /first 3MB/);
  });
});

// ── saving it ───────────────────────────────────────────────────────────────
test("a proposal's fonts become the project's own font or a bundled one; the rest are named", async () => {
  const p = store.createProject({ name: "Fonts" });
  const tmp = uploadTempPath(store, p.id);
  (await import("node:fs")).mkdirSync(join(tmp, ".."), { recursive: true });
  (await import("node:fs")).writeFileSync(tmp, readFileSync(join(process.cwd(), "node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff")));
  const { yarn: own } = await importYarn(store, p.id, tmp, "brand-serif.woff");
  const m = matchFonts(store, p.id, { display: "Instrument Serif", body: "Geist Variable", mono: "Berkeley Mono" });
  assert.deepEqual(m.matched.display, { family: "Instrument Serif", yarnId: own.id, from: "yarn" }, "the project's own file wins over the bundled copy");
  assert.deepEqual(m.matched.body, { family: "Geist", from: "bundled" });
  assert.equal(m.matched.mono, null);
  assert.deepEqual(m.fonts, { display: { family: "Instrument Serif", yarnId: own.id }, body: { family: "Geist" } });
  assert.match(m.notes.join(" "), /Berkeley Mono is not bundled/);
  const neither = matchFonts(store, p.id, { display: "Chango", body: "Open Sans" });
  assert.deepEqual(neither.fonts, { display: { family: "Inter" }, body: { family: "Inter" } });
  assert.equal(neither.notes.length, 2);
});

test("a model's proposal is saved as a new swatch, never made the project's, and its logo comes in as Yarn", async () => {
  const p = store.createProject({ name: "Proposed" });
  const before = activeSwatch(store, p.id).id;
  const logo = await png({ r: 177, g: 108, b: 248 });
  const { swatch, notes } = await withSite({ "/icon.png": { body: logo, headers: { "content-type": "image/png" } } }, () =>
    createSwatchFromProposal(store, p.id, {
      name: "notch.fm",
      colors: [{ role: "primary", name: "Violet", hex: "#b16cf8" }, { role: "background", name: "Ink", hex: "#150829" }, { role: "text", name: "White", hex: "#ffffff" }],
      fonts: { display: "Chango", body: "Inter" },
      logo: { url: "https://203.0.113.9/icon.png", use: "mark" },
    }, { actor: "model", activate: false }));
  assert.equal(activeSwatch(store, p.id).id, before, "the person decides");
  assert.equal(swatch.name, "notch.fm");
  assert.equal(swatch.fonts.body.family, "Inter");
  assert.equal(swatch.logos.length, 1);
  const y = listYarn(store, p.id).find((x) => x.id === swatch.logos[0].yarnId);
  assert.deepEqual([y.kind, y.tags, swatch.logos[0].use], ["image", ["logo"], "mark"]);
  assert.match(notes.join(" "), /Chango is not bundled/);
  assert.ok(store.activity(p.id).some((a) => a.action === "swatch.created" && a.actor === "model"), "the activity says a model made it");
  // A logo that will not come in is a note, not a failure.
  const again = await withSite({}, () => createSwatchFromProposal(store, p.id, { name: "No logo", colors: swatch.colors, logo: { url: "https://203.0.113.9/missing.png", use: "full" } }, { actor: "model", activate: false }));
  assert.equal(again.swatch.logos.length, 0);
  assert.match(again.notes.join(" "), /logo could not be brought in/);
});
