// Reading a business's public website, for its Brief.
//
// The page the person gives, then the pages that say the most about the business: about,
// what it offers and for how much, who it serves, how to reach it, a few recent posts. The
// site's own map (its sitemap) and its links say what there is; its robots.txt says what a
// reader like this may read, and that is kept to. Each page is read as text, as site.ts
// reads one for its colours: nothing on it runs, so a page that is only drawn by JavaScript
// reads as little, and the notes say so. What every page repeats (a header, a footer) is
// kept once, apart. The agent's profile writer (packages/agent/src/profile.mjs) reads this.
//
// Pure but for `readWebsite`, which asks for pages through a Fetcher: web.ts's, or a test's.

import { gunzipSync } from "node:zlib";
import { ValidationError } from "./store.ts";
import { baseOf, decodeEntities, nameOf, tagsIn } from "./site.ts";
import { fetchPublic, siteAddress, type Fetcher } from "./web.ts";

export interface PageRead {
  url: string;
  title: string;
  description: string;
  lang?: string;
  /** The page's words, a line to a block: "# " before a heading (one # a level), "- " before an item. */
  text: string;
  /** The pages it links to on the same site. */
  links: string[];
  /** What its structured data says about the business: its schema.org JSON, trimmed. */
  structured: unknown[];
  emails: string[];
  phones: string[];
  social: string[];
  canonical?: string;
}

export interface SiteRead {
  url: string;
  name: string;
  description: string;
  lang?: string;
  /** The pages read, the one given first and the rest in the order they matter. */
  pages: PageRead[];
  /** What every page repeats, kept once: a footer's address, a header's promise. */
  siteWide: string;
  skipped: { url: string; why: string }[];
  notes: string[];
  social: string[];
  emails: string[];
  phones: string[];
  structured: unknown[];
}

// ── one page ─────────────────────────────────────────────────────────────────
const NAMED: Record<string, string> = {
  nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", sbquo: "‚", bdquo: "„",
  ndash: "–", mdash: "\u2014", hellip: "…", middot: "·", bull: "•", copy: "©", reg: "®", trade: "™", deg: "°",
  euro: "€", pound: "£", yen: "¥", cent: "¢", times: "×", divide: "÷", frac12: "½", frac14: "¼", frac34: "¾",
  eacute: "é", egrave: "è", ecirc: "ê", aacute: "á", agrave: "à", acirc: "â", auml: "ä", ouml: "ö", uuml: "ü",
  oacute: "ó", iacute: "í", uacute: "ú", ntilde: "ñ", ccedil: "ç", szlig: "ß", aring: "å", oslash: "ø", aelig: "æ",
  Eacute: "É", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", Ntilde: "Ñ", rarr: "→", larr: "←", check: "✓", star: "☆",
};
const decode = (s: string) => decodeEntities(s.replace(/&([a-zA-Z][a-zA-Z0-9]{1,8});/g, (m, n: string) => NAMED[n] ?? m));

const SOCIAL = /^https?:\/\/(?:[a-z0-9-]+\.)*(facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com|tiktok\.com|pinterest\.[a-z.]+|threads\.(?:net|com)|bsky\.app|mastodon\.social|vimeo\.com|behance\.net|dribbble\.com|github\.com|yelp\.[a-z.]+|tripadvisor\.[a-z.]+|etsy\.com|substack\.com|medium\.com|spotify\.com|soundcloud\.com|twitch\.tv|discord\.(?:gg|com)|wa\.me|t\.me)\b/i;
// Not pages: files, feeds and what a browser asks for besides.
const NOT_A_PAGE = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|heic|mp4|mov|webm|m4v|mp3|wav|m4a|ogg|zip|gz|rar|7z|dmg|exe|msi|apk|css|js|mjs|json|xml|rss|atom|txt|csv|xlsx?|docx?|pptx?|woff2?|ttf|otf|eot)(\?|$)/i;

/** The same site: the same name, with or without "www.". */
export const sameSite = (a: URL, b: URL) => a.hostname.replace(/^www\./, "").toLowerCase() === b.hostname.replace(/^www\./, "").toLowerCase();

/** A page's address with no fragment, and no trailing slash but the root's: one page, one address. */
export function pageKey(u: URL): string {
  const v = new URL(u.href);
  v.hash = "";
  v.hostname = v.hostname.toLowerCase().replace(/^www\./, "");
  for (const k of [...v.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_[ce]id$|ref$|_ga$)/i.test(k)) v.searchParams.delete(k);
  let p = v.pathname.replace(/\/index\.(html?|php)$/i, "/").replace(/\/{2,}/g, "/");
  if (p.length > 1) p = p.replace(/\/$/, "");
  return `${v.protocol}//${v.host}${p}${v.search}`;
}

// What structured data is kept: what a business says of itself, not how its page is built.
const DROP_KEYS = new Set(["@context", "@id", "image", "logo", "thumbnailUrl", "potentialAction", "breadcrumb", "isPartOf", "primaryImageOfPage", "mainEntityOfPage", "inLanguage", "publisher", "author", "datePublished", "dateModified", "url", "contentUrl", "embedUrl", "width", "height", "encodingFormat", "caption"]);
// Every kind of business, product or offer schema.org has (a Bakery is a LocalBusiness), but
// not the page's own frame: its breadcrumbs, its pictures, the page as a page.
const FRAME_TYPES = /^(WebPage|WebSite|CollectionPage|ItemPage|AboutPage|ContactPage|SearchResultsPage|CheckoutPage|ProfilePage|QAPage|BreadcrumbList|ListItem|ItemList|ImageObject|VideoObject|MediaObject|SiteNavigationElement|WPHeader|WPFooter|WPSideBar|SearchAction|ReadAction|EntryPoint|Article|BlogPosting|NewsArticle|Blog|Comment|Person|ImageGallery)$/;
function trimLd(x: unknown, depth = 0): unknown {
  if (depth > 5) return undefined;
  if (Array.isArray(x)) { const a = x.map((v) => trimLd(v, depth + 1)).filter((v) => v !== undefined); return a.length ? a.slice(0, 20) : undefined; }
  if (x && typeof x === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) { if (DROP_KEYS.has(k)) continue; const t = trimLd(v, depth + 1); if (t !== undefined && t !== "") out[k] = t; }
    return Object.keys(out).length ? out : undefined;
  }
  if (typeof x === "string") { const s = decode(x.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); return s ? s.slice(0, 1200) : undefined; }
  return x;
}
function structuredOf(html: string): unknown[] {
  const out: unknown[] = [];
  const typeOf = (o: Record<string, unknown>) => [o["@type"]].flat().map(String);
  const visit = (x: unknown): void => {
    if (Array.isArray(x)) return x.forEach(visit);
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, unknown>;
    if (o["@graph"]) visit(o["@graph"]);
    const types = typeOf(o).filter((t) => t !== "undefined");
    if (!types.length) return;
    // A page as a page is its frame, but what it is about may be the business: an AboutPage's mainEntity.
    if (types.every((t) => FRAME_TYPES.test(t))) { if (o.mainEntity) visit(o.mainEntity); return; }
    const t = trimLd(o);
    if (t && JSON.stringify(t).length > 30) out.push(t);
  };
  for (const m of html.matchAll(/<script[^>]+type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(m[1].trim())); } catch { /* not JSON */ }
  }
  // Each kept once, and not more than a page's worth.
  const seen = new Set<string>();
  return out.filter((o) => { const k = JSON.stringify(o); if (seen.has(k)) return false; seen.add(k); return true; }).filter((o) => JSON.stringify(o).length <= 8000).slice(0, 12);
}

const BLOCK = "address|article|aside|blockquote|body|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|header|hgroup|html|legend|main|nav|ol|p|pre|section|summary|table|tbody|thead|tfoot|tr|ul|caption|center";
const cut = (html: string, tag: string) => html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), " ");

/** Words out of markup: a line to a block, headings and items marked as markdown marks them. */
export function textOf(html: string): string {
  let s = html;
  s = s.replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_, h: string, inner: string) => `\n\n${"#".repeat(Number(h[1]))} ${inner.replace(/<[^>]+>/g, " ")}\n\n`);
  s = s.replace(/<li\b[^>]*>/gi, "\n- ");
  s = s.replace(/<(td|th)\b[^>]*>/gi, " | ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<img\b[^>]*\balt\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi, (_, _q, a?: string, b?: string) => { const alt = (a ?? b ?? "").trim(); return alt.length > 2 && !/^(the |a )?(logo|icon|image|img|photo|picture|avatar|spacer|banner|graphic)s?$/i.test(alt) && !/\.(png|jpe?g|gif|svg|webp|avif)$/i.test(alt) ? ` [picture: ${alt}] ` : " "; });
  s = s.replace(new RegExp(`<\\/?(?:${BLOCK})\\b[^>]*>`, "gi"), "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decode(s);
  const lines: string[] = [];
  for (const raw of s.split("\n")) {
    const line = raw.replace(/[\s ​]+/g, " ").replace(/^\s*-\s*$/, "").replace(/^ \| /, "").trim();
    if (!line || /^[|\s]+$/.test(line)) continue;
    if (lines.at(-1) === line) continue;
    lines.push(line);
  }
  return lines.join("\n");
}

/** One page, read as text: its words, what it is called and says it is, where it leads. */
export function readPage(html: string, url: string): PageRead {
  const base = baseOf(html, url);
  const metas = tagsIn(html, ["meta"]);
  const meta = (key: string) => metas.find((t) => (t.attrs.property ?? t.attrs.name ?? "").toLowerCase() === key)?.attrs.content?.trim() ?? "";
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim() || meta("og:title");
  const description = decode(meta("description") || meta("og:description")).replace(/\s+/g, " ").trim();
  const lang = /<html\b[^>]*\blang\s*=\s*["']?([a-zA-Z-]{2,12})/i.exec(html)?.[1]?.toLowerCase();
  const canonicalHref = tagsIn(html, ["link"]).find((t) => (t.attrs.rel ?? "").toLowerCase().split(/\s+/).includes("canonical"))?.attrs.href;
  let canonical: string | undefined;
  try { if (canonicalHref) canonical = pageKey(new URL(canonicalHref, base)); } catch { /* not an address */ }

  const links: string[] = [], emails = new Set<string>(), phones = new Set<string>(), social = new Set<string>();
  const here = new URL(url);
  for (const t of tagsIn(html, ["a"])) {
    const href = (t.attrs.href ?? "").trim();
    if (!href || href.startsWith("#") || /^javascript:/i.test(href)) continue;
    if (/^mailto:/i.test(href)) { const e = decodeURIComponent(href.slice(7).split("?")[0]).trim().toLowerCase(); if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)) emails.add(e); continue; }
    if (/^tel:/i.test(href)) { const p = decodeURIComponent(href.slice(4)).replace(/[^\d+()\s.-]/g, "").trim(); if (p.replace(/\D/g, "").length >= 6) phones.add(p); continue; }
    let u: URL;
    try { u = new URL(href, base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    if (SOCIAL.test(u.href) && !sameSite(u, here)) { social.add(u.href.replace(/\/$/, "")); continue; }
    if (!sameSite(u, here) || NOT_A_PAGE.test(u.pathname)) continue;
    const k = pageKey(u);
    if (!links.includes(k)) links.push(k);
  }

  const structured = structuredOf(html);
  // The words: from the page's main part when it marks one, without what every page has around it.
  let body = html.replace(/<!--[\s\S]*?-->/g, " ");
  for (const tag of ["script", "style", "noscript", "template", "svg", "iframe", "canvas", "select", "button", "object", "video", "audio", "map"]) body = cut(body, tag);
  body = body.replace(/<head\b[\s\S]*?<\/head\s*>/i, " ");
  const main = /<main\b[^>]*>([\s\S]*)<\/main\s*>/i.exec(body)?.[1] ?? /<[^>]+\brole\s*=\s*["']main["'][^>]*>([\s\S]*)/i.exec(body)?.[1];
  let text = main ? textOf(main) : "";
  if (text.length < 200) {
    let rest = body;
    for (const tag of ["nav", "header", "footer", "aside", "form", "dialog"]) rest = cut(rest, tag);
    text = textOf(rest);
    if (text.length < 200) text = textOf(body);
  }
  return { url: pageKey(here), title, description, lang, text, links, structured, emails: [...emails], phones: [...phones], social: [...social], canonical };
}

// ── robots.txt and the sitemap ───────────────────────────────────────────────
export interface Robots { rules: { allow: boolean; path: string }[]; sitemaps: string[] }

/** What robots.txt asks of a reader called `agent`, or of any reader when it names none like it. */
export function readRobots(txt: string, agent = "knitted"): Robots {
  const groups: { agents: string[]; rules: Robots["rules"] }[] = [];
  const sitemaps: string[] = [];
  let cur: { agents: string[]; rules: Robots["rules"] } | null = null;
  let last: "agent" | "rule" | null = null;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === "sitemap") { if (value) sitemaps.push(value); continue; }
    if (key === "user-agent") {
      if (last !== "agent" || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase()); last = "agent"; continue;
    }
    if ((key === "allow" || key === "disallow") && cur) { if (value || key === "allow") cur.rules.push({ allow: key === "allow", path: value || "/" }); else cur.rules.push({ allow: true, path: "/" }); last = "rule"; }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)));
  const any = groups.filter((g) => g.agents.includes("*"));
  return { rules: (mine.length ? mine : any).flatMap((g) => g.rules), sitemaps };
}

const ruleRe = (path: string) => new RegExp("^" + path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
/** Whether robots.txt lets a reader see `path` (with its query): the longest rule that matches wins, and Allow wins a tie. */
export function allowed(robots: Robots, pathAndQuery: string): boolean {
  let best: { allow: boolean; len: number } | null = null;
  for (const r of robots.rules) {
    if (!ruleRe(r.path).test(pathAndQuery)) continue;
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
  }
  return best?.allow ?? true;
}

/** The addresses a sitemap lists, and the sitemaps a sitemap index lists. */
export function readSitemap(xml: string): { pages: string[]; sitemaps: string[] } {
  const locs = (scope: string) => [...scope.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decode(m[1].trim()));
  if (/<sitemapindex\b/i.test(xml)) return { pages: [], sitemaps: locs(xml) };
  return { pages: locs(xml), sitemaps: [] };
}

// ── which pages, in what order ───────────────────────────────────────────────
// What a page's address says it is about. The lower, the more it says about the business.
const RANKS: [RegExp, number, string][] = [
  [/^\/?$/, 0, "home"],
  [/\b(about|about-us|company|our-story|story|who-we-are|team|our-team|people|mission|values|history|founders?|manifesto|why-us|why)\b/, 1, "about"],
  [/\b(products?|services?|solutions?|offerings?|what-we-do|shop|store|collections?|catalog(ue)?|menu|pricing|prices|plans|packages|features|platform|programs?|courses?|classes|treatments|rooms|work|portfolio|projects|capabilities|industries|use-cases)\b/, 2, "offer"],
  [/\b(customers?|clients|case-stud(y|ies)|testimonials?|reviews?|success-stories|results|partners)\b/, 3, "proof"],
  [/\b(faqs?|questions|help|support|how-it-works|process|approach|method|guide)\b/, 3, "questions"],
  [/\b(contact|contact-us|locations?|visit|find-us|hours|stores|where)\b/, 3, "contact"],
  [/\b(press|news|media|newsroom|announcements|events)\b/, 5, "news"],
  [/\b(blog|journal|stories|articles|insights|resources|learn|posts?|updates|magazine)\b/, 5, "posts"],
  [/\b(careers?|jobs|join-us|hiring|work-with-us)\b/, 6, "careers"],
];
const SKIP = /\/(log-?in|sign-?in|sign-?up|register|account|my-account|cart|basket|bag|checkout|wishlist|search|wp-admin|wp-login\.php|wp-json|admin|cdn-cgi|tags?|author|category|categories|feed|rss|amp|print|share|attachment|cookies?|privacy(-policy)?|terms([-_].*)?|legal|gdpr|ccpa|disclaimer|accessibility-statement|sitemap|unsubscribe|preferences|auth|oauth|callback|api|graphql|xmlrpc\.php)(\/|$)|\/page\/\d+|[?&](page|paged|p|s|q|query|sort|filter|replytocom|add-to-cart|variant)=/i;
// How many of a kind: a site with three hundred posts is not three hundred pages about the business.
const AT_MOST: Record<string, number> = { posts: 6, news: 3, careers: 1, proof: 6, offer: 18 };

/** What kind of page an address is, and how soon to read it. */
export function rankOf(u: URL, start: URL): { score: number; kind: string } | null {
  const path = decodeURIComponent(u.pathname).toLowerCase();
  if (SKIP.test(path + u.search)) return null;
  if (NOT_A_PAGE.test(path)) return null;
  // Another language's copy of the site, beside the one given.
  const lang = /^\/([a-z]{2}(?:[-_][a-z]{2})?)(\/|$)/.exec(path)?.[1];
  const startLang = /^\/([a-z]{2}(?:[-_][a-z]{2})?)(\/|$)/i.exec(start.pathname)?.[1]?.toLowerCase();
  if (lang && lang !== startLang && /^(en|fr|de|es|it|nl|pt|sv|da|no|nb|fi|pl|cs|ja|zh|ko|ru|tr|ar|he|el|hu|ro|uk|id|th|vi)([-_][a-z]{2})?$/.test(lang)) return null;
  const words = path.replace(/[_.]/g, "-");
  const depth = path.split("/").filter(Boolean).length;
  for (const [re, rank, kind] of RANKS) if (re.test(words)) return { score: rank * 10 + Math.min(depth, 6) + (u.search ? 3 : 0), kind };
  // A page whose address says nothing: one at the top of the site is most often something it
  // offers (catering, wholesale); one deep in it, a thing it sells, or anything at all.
  return { score: (depth <= 1 ? 25 : 40) + Math.min(depth, 6) * 2 + (u.search ? 5 : 0), kind: "other" };
}

// ── the whole site ───────────────────────────────────────────────────────────
export interface ReadOptions {
  fetcher?: Fetcher;
  /** The most pages read, the one given included. */
  maxPages?: number;
  /** The most characters of words kept, across every page: what a model is sent. */
  maxChars?: number;
  /** How long it may take in all. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Each page as it is read. */
  onPage?: (p: { url: string; title: string; read: number; of: number }) => void;
}

const PAGE_CHARS = 12_000;
const HTML = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5";

/**
 * Read a business's public website: the page given, and as many more as `maxPages` allows,
 * those that say the most about it first. Nothing is saved: the profile writer reads this.
 */
export async function readWebsite(raw: string, o: ReadOptions = {}): Promise<SiteRead> {
  const get = o.fetcher ?? fetchPublic;
  const maxPages = Math.max(1, Math.min(80, o.maxPages ?? 40));
  const maxChars = o.maxChars ?? 240_000;
  const until = Date.now() + (o.timeoutMs ?? 4 * 60_000);
  const notes: string[] = [];
  const skipped: SiteRead["skipped"] = [];
  const stop = () => { if (o.signal?.aborted) throw new ValidationError("Stopped."); };

  const first = await get(siteAddress(raw), { max: 3_000_000, accept: HTML, signal: o.signal });
  const html = first.buf.toString("utf8");
  if (!/html|xml/.test(first.type) && !/<(html|head|body|meta|title)\b/i.test(html.slice(0, 4000))) throw new ValidationError("That link is not a web page. Paste the address of the site itself, like https://example.com.");
  const start = first.url;
  const home = readPage(html, start.href);
  if (first.truncated) notes.push("Its first page is very large, so knitted read the first 3MB of it.");
  const pages: PageRead[] = [home];
  const seen = new Set<string>([home.url, ...(home.canonical ? [home.canonical] : [])]);
  const texts = new Set<string>([home.text]);

  // What the site asks of readers, and its map.
  let robots: Robots = { rules: [], sitemaps: [] };
  try {
    const r = await get(new URL("/robots.txt", start).href, { max: 500_000, accept: "text/plain,*/*;q=0.5", what: "robots.txt", timeoutMs: 8000, signal: o.signal });
    if (!/html/.test(r.type)) robots = readRobots(r.buf.toString("utf8"));
  } catch { /* none: every page may be read */ }
  stop();
  const ok = (u: URL) => allowed(robots, u.pathname + u.search);
  let refused = 0;

  const found = new Map<string, { u: URL; score: number; kind: string }>();
  const consider = (href: string) => {
    let u: URL;
    try { u = new URL(href, start); } catch { return; }
    if (!/^https?:$/.test(u.protocol) || !sameSite(u, start)) return;
    const k = pageKey(u);
    if (seen.has(k) || found.has(k)) return;
    const rank = rankOf(u, start);
    if (!rank) return;
    if (!ok(u)) { refused++; if (skipped.length < 200) skipped.push({ url: k, why: "Its robots.txt asks readers not to." }); return; }
    found.set(k, { u, ...rank });
  };
  home.links.forEach(consider);

  // The maps robots.txt names, then where sites usually keep one, until one is found. An index
  // of maps leads to the maps it lists: the first few, which on most sites list pages before posts.
  const mapped: string[] = [];
  const usual = new Set(["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"].map((p) => new URL(p, start).href));
  const maps = [...new Set([...robots.sitemaps, ...usual])];
  const visited = new Set<string>();
  for (let reads = 0; maps.length && reads < 8 && mapped.length < 3000 && Date.now() < until;) {
    const href = maps.shift()!;
    if (visited.has(href) || (usual.has(href) && mapped.length)) continue;
    visited.add(href);
    let m: URL;
    try { m = new URL(href); } catch { continue; }
    if (!sameSite(m, start)) continue;
    try {
      const r = await get(m.href, { max: 8_000_000, accept: "application/xml,text/xml,*/*;q=0.5", what: "sitemap", timeoutMs: 12_000, signal: o.signal });
      const buf = r.buf[0] === 0x1f && r.buf[1] === 0x8b ? gunzipSync(r.buf) : r.buf;
      const xml = buf.toString("utf8");
      if (!/<(urlset|sitemapindex)\b/i.test(xml)) continue;
      reads++;
      const s = readSitemap(xml);
      mapped.push(...s.pages);
      maps.unshift(...s.sitemaps.filter((c) => !visited.has(c)).slice(0, 5));
    } catch { /* that map is not there */ }
    stop();
  }
  mapped.slice(0, 3000).forEach(consider);

  // The best next page; each kind only so many times.
  const taken: Record<string, number> = {};
  const next = () => {
    let best: { k: string; u: URL; score: number; kind: string } | null = null;
    for (const [k, c] of found) {
      if ((taken[c.kind] ?? 0) >= (AT_MOST[c.kind] ?? Infinity)) continue;
      if (!best || c.score < best.score) best = { k, ...c };
    }
    if (best) { found.delete(best.k); taken[best.kind] = (taken[best.kind] ?? 0) + 1; }
    return best;
  };

  let timedOut = false;
  const workers = Array.from({ length: 4 }, async () => {
    for (;;) {
      if (pages.length >= maxPages) return;
      if (Date.now() > until) { timedOut = true; return; }
      if (o.signal?.aborted) return;
      const c = next();
      if (!c) return;
      seen.add(c.k);
      try {
        const r = await get(c.u.href, { max: 2_000_000, accept: HTML, timeoutMs: 15_000, signal: o.signal });
        const k = pageKey(r.url);
        if (k !== c.k && seen.has(k)) continue;
        seen.add(k);
        if (!sameSite(r.url, start)) { skipped.push({ url: c.k, why: "It leads off the site." }); continue; }
        const body = r.buf.toString("utf8");
        if (!/html|xml/.test(r.type) && !/<(html|head|body)\b/i.test(body.slice(0, 4000))) { skipped.push({ url: c.k, why: "It is not a web page." }); continue; }
        const p = readPage(body, r.url.href);
        if (p.canonical && p.canonical !== p.url && seen.has(p.canonical)) continue;
        if (texts.has(p.text)) continue;
        texts.add(p.text);
        if (pages.length >= maxPages) return;
        pages.push(p);
        o.onPage?.({ url: p.url, title: p.title, read: pages.length, of: Math.min(maxPages, pages.length + found.size) });
        p.links.forEach(consider);
      } catch (e) {
        if (o.signal?.aborted) return;
        skipped.push({ url: c.k, why: (e as Error).message || "It could not be read." });
      }
    }
  });
  o.onPage?.({ url: home.url, title: home.title, read: 1, of: Math.min(maxPages, 1 + found.size) });
  await Promise.all(workers);
  stop();
  if (timedOut) notes.push("Reading took long, so it stopped before every page it meant to read.");

  // What most pages repeat is the site's frame: kept once, apart, not on every page.
  let siteWide = "";
  if (pages.length >= 3) {
    const count = new Map<string, number>();
    for (const p of pages) for (const l of new Set(p.text.split("\n"))) count.set(l, (count.get(l) ?? 0) + 1);
    const frame = new Set([...count].filter(([l, n]) => n >= Math.max(3, Math.ceil(pages.length * 0.5)) && l.length > 2).map(([l]) => l));
    siteWide = home.text.split("\n").filter((l) => frame.has(l)).join("\n").slice(0, 4000);
    for (const p of pages) p.text = p.text.split("\n").filter((l) => !frame.has(l)).join("\n");
  }
  // And what is left, each page so long at most, all so long at most, the pages that matter most first.
  let budget = maxChars - siteWide.length;
  let short = 0;
  for (const p of pages) {
    if (p.text.length > PAGE_CHARS) { p.text = p.text.slice(0, PAGE_CHARS).replace(/\n[^\n]*$/, "") + "\n(The rest of this page was left out.)"; }
    if (p.text.length > budget) { p.text = budget > 500 ? p.text.slice(0, budget).replace(/\n[^\n]*$/, "") : ""; short++; }
    budget -= p.text.length;
  }
  if (short) notes.push(`${short === 1 ? "One page was" : `${short} pages were`} cut short, to keep what your model is sent to a size it reads well.`);
  const thin = pages.filter((p) => p.text.length < 120).length;
  if (thin && thin >= Math.ceil(pages.length / 2)) notes.push("Many of its pages have few words in them as they arrive. A site drawn by JavaScript reads as little here: add a write-up, or the pages' words, for the builder to go on.");
  if (pages.length === 1 && refused) notes.push("Its robots.txt asks readers like this one not to read more of the site, so only the page you gave was read.");
  else if (pages.length === 1 && !notes.length) notes.push("It found no other pages on the site to read.");

  const all = <T,>(f: (p: PageRead) => T[]) => [...new Set(pages.flatMap(f))];
  return {
    url: home.url, name: nameOf(html, start), description: home.description, lang: home.lang,
    pages: pages.filter((p) => p.text || p === home), siteWide, skipped: skipped.slice(0, 100), notes,
    social: all((p) => p.social).slice(0, 20), emails: all((p) => p.emails).slice(0, 10), phones: all((p) => p.phones).slice(0, 10),
    structured: all((p) => p.structured.map((s) => JSON.stringify(s))).slice(0, 20).map((s) => JSON.parse(s)),
  };
}
