// Reading a brand off its website: colours, fonts, logo and name, PROPOSED as a swatch.
//
// Pure: the page and its stylesheets arrive as text (swatch.ts fetches them), so this
// is tested with fixtures and runs nothing from the site. It reads a page the way its
// designer set it down. The page's own background and text are the background and text,
// in whichever mode (light or dark) the page is drawn. Its brand colours are the ones
// its buttons and links wear, the ones its custom properties are named after (--brand,
// --primary, --accent), and the ones its markup uses most, counted class by class, which
// is how a Tailwind site says anything. Of those, the one in its logo is the primary. A
// status colour (success, danger) or the other mode's is never taken. Each colour says
// where it came from, so a person can see what was read and what was made up.

import type { ColorRole, SwatchColor } from "./types.ts";
import { ratio } from "./contrast.ts";

export interface SiteColor extends SwatchColor { from: string }
export interface SiteProposal {
  name: string;
  /** All six roles, primary first. `from` says where each was read, or that it was made from the others. */
  colors: SiteColor[];
  /** Every family the site uses, the most used first. */
  fonts: string[];
  fontRoles: { display?: string; body?: string; mono?: string };
  logo?: SiteLogo;
  sourceUrl: string;
  notes: string[];
}
export interface PageText {
  html: string; css: string; url: string;
  /** The logo that loaded, and its colours. Left out, the likeliest is named and its colours are not known; null, there is none. */
  logo?: SiteLogo | null; logoColors?: string[];
}

// ── colour ──────────────────────────────────────────────────────────────────
type RGB = [number, number, number];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const toHex = (c: RGB) => "#" + c.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")).join("");
const fromHex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.sign(c) * Math.abs(c) ** (1 / 2.4) - 0.055);

function oklabToRgb(L: number, a: number, b: number): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}
const labs = new Map<string, [number, number, number]>();
function oklab(hex: string): [number, number, number] {
  const known = labs.get(hex);
  if (known) return known;
  if (labs.size > 50_000) labs.clear();
  const [r, g, b] = fromHex(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lab: [number, number, number] = [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  labs.set(hex, lab);
  return lab;
}
function hslToRgb(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) as RGB;
}
/** How colourful, 0 for a grey (OKLCH chroma). */
export const chroma = (hex: string) => { const [, a, b] = oklab(hex); return Math.hypot(a, b); };
const lightness = (hex: string) => oklab(hex)[0];
/** How different two colours look, in OKLab. */
export const distance = (x: string, y: string) => { const p = oklab(x), q = oklab(y); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const mix = (a: string, b: string, t: number) => { const p = fromHex(a), q = fromHex(b); return toHex(p.map((v, i) => v + (q[i] - v) * t) as RGB); };

const num = (s: string, scale = 1) => (s.endsWith("%") ? (parseFloat(s) / 100) * scale : parseFloat(s));
const angle = (s: string) => (s.endsWith("turn") ? parseFloat(s) * 360 : s.endsWith("rad") ? (parseFloat(s) * 180) / Math.PI : parseFloat(s));
const N = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?`;
const COLOR_TOKEN = new RegExp(String.raw`#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|color)\([^()]*\)|\b(?:white|black)\b`, "gi");

/** One CSS colour, as six-digit hex. Null for anything see-through, unknown, or not a colour. */
export function parseColor(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (v === "white") return "#ffffff";
  if (v === "black") return "#000000";
  let m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (m) {
    const h = m[1];
    if (h.length === 5 || h.length === 7) return null;
    const full = h.length <= 4 ? [...h].map((x) => x + x).join("") : h;
    if (full.length === 8 && parseInt(full.slice(6), 16) < 217) return null;
    return "#" + full.slice(0, 6);
  }
  m = /^([a-z]+)\((.*)\)$/.exec(v);
  if (!m) return null;
  const [fn, body] = [m[1], m[2]];
  const [main, alphaPart] = body.includes("/") ? body.split("/") : [body, undefined];
  let parts = main.split(/[\s,]+/).filter(Boolean);
  let alpha = alphaPart?.trim() ? num(alphaPart.trim()) : 1;
  if ((fn === "rgba" || fn === "hsla" || fn === "rgb" || fn === "hsl") && parts.length === 4 && alphaPart === undefined) { alpha = num(parts[3]); parts = parts.slice(0, 3); }
  if (!(alpha >= 0.85) || parts.length < 3) return null;
  if (!parts.slice(fn === "color" ? 1 : 0, fn === "color" ? 4 : 3).every((p) => new RegExp(`^${N}(%|deg|turn|rad)?$`, "i").test(p))) return null;
  if (fn === "rgb" || fn === "rgba") return toHex(parts.slice(0, 3).map((p) => num(p, 255) / 255) as RGB);
  if (fn === "hsl" || fn === "hsla") return toHex(hslToRgb(angle(parts[0]), clamp01(num(parts[1].endsWith("%") ? parts[1] : `${parts[1]}%`)), clamp01(num(parts[2].endsWith("%") ? parts[2] : `${parts[2]}%`))));
  if (fn === "oklch") { const L = num(parts[0]), C = num(parts[1], 0.4), H = (angle(parts[2]) * Math.PI) / 180; return toHex(oklabToRgb(L, C * Math.cos(H), C * Math.sin(H))); }
  if (fn === "oklab") return toHex(oklabToRgb(num(parts[0]), num(parts[1], 0.4), num(parts[2], 0.4)));
  if (fn === "color" && /^(srgb|display-p3|srgb-linear)$/.test(parts[0])) {
    const c = parts.slice(1, 4).map((p) => num(p)) as RGB;
    return toHex(parts[0] === "srgb-linear" ? (c.map(gam) as RGB) : c);
  }
  return null;
}
/** Every colour written in a CSS value, in order. */
export const colorsIn = (value: string) => [...value.matchAll(COLOR_TOKEN)].map((m) => parseColor(m[0])).filter((x): x is string => !!x);

// ── CSS, read as text ───────────────────────────────────────────────────────
type Mode = "dark" | "light";
/** A rule, flattened out of its at-rules. `mode`: an at-rule keeps it to dark or light mode. */
export interface Rule { selector: string; decls: [string, string][]; mode?: Mode }
const DARK_AT = /prefers-color-scheme\s*:\s*dark/i;
const LIGHT_AT = /prefers-color-scheme\s*:\s*light/i;
// .dark, html.dark, [data-theme="night"], .theme-dark: a dark mode. Not .text-dark, which is a dark text colour.
const modeSel = (words: string) => new RegExp(String.raw`(^|[\s>+~(])(?:html|body|:root)?\.(?:${words})(?=$|[\s:.[)>+~])|\[data-[\w-]*(?:theme|mode|scheme|appearance)[\w-]*\s*[~|^$*]?=\s*["']?(?:${words})\b|\.(?:theme-|theme--)?(?:${words})(?:-theme|-mode)?(?=$|[\s:.[)>+~])`, "i");
const DARK_SEL = modeSel("dark|night|dim|midnight"), LIGHT_SEL = modeSel("light|day");
/** The mode one selector (not a list) is written for. :not(.dark) is not dark. */
export function modeOf(part: string): Mode | undefined {
  const bare = part.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, "");
  return DARK_SEL.test(bare) ? "dark" : LIGHT_SEL.test(bare) ? "light" : undefined;
}
const KEEP_AT = /^@(media|supports|layer|container|scope|document|-moz-document)\b/i;

/** Rules and their declarations, with at-rules flattened. Nothing in @keyframes or print. */
export function cssRules(css: string): { rules: Rule[]; imports: string[]; faces: string[] } {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = []; const imports: string[] = []; const faces: string[] = [];
  type Frame = { kind: "at" | "rule" | "skip" | "face"; selector: string; mode?: Mode; decls: [string, string][] };
  const stack: Frame[] = [];
  const top = () => stack[stack.length - 1];
  const declsOf = (text: string) => text.split(";").map((d) => { const i = d.indexOf(":"); return i > 0 ? [d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).replace(/!important\s*$/i, "").trim()] as [string, string] : null; }).filter((d): d is [string, string] => !!d && !!d[0] && !!d[1]);
  let seg = ""; let paren = 0; let quote = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    // An escaped character is never syntax: Tailwind writes .content-\[\'\'\] and .w-\[calc\(100\%\)\].
    if (ch === "\\") { seg += ch + (src[i + 1] ?? ""); i++; continue; }
    if (quote) { seg += ch; if (ch === quote) quote = ""; continue; }
    if (ch === '"' || ch === "'") { quote = ch; seg += ch; continue; }
    if (ch === "(") paren++;
    if (ch === ")") paren = Math.max(0, paren - 1);
    if (paren > 0 || (ch !== "{" && ch !== "}" && ch !== ";")) { seg += ch; continue; }
    const f = top();
    if (ch === ";") {
      if (f?.kind === "rule" || f?.kind === "face") { seg += ch; continue; }
      const stmt = seg.trim(); seg = "";
      const imp = /^@import\s+(?:url\(\s*)?["']?([^"')\s]+)["']?/i.exec(stmt);
      if (imp && !/\bprint\b/i.test(stmt.slice(imp[0].length))) imports.push(imp[1]);
      continue;
    }
    if (ch === "{") {
      let prelude = seg.trim();
      if (f?.kind === "rule") {
        // Nested CSS: declarations before the nested selector belong to the parent.
        const cut = prelude.lastIndexOf(";");
        if (cut >= 0) { f.decls.push(...declsOf(prelude.slice(0, cut))); prelude = prelude.slice(cut + 1).trim(); }
      }
      seg = "";
      const mode = f?.mode;
      if (f?.kind === "skip") { stack.push({ kind: "skip", selector: "", mode, decls: [] }); continue; }
      if (prelude.startsWith("@")) {
        if (/^@font-face/i.test(prelude)) stack.push({ kind: "face", selector: prelude, mode, decls: [] });
        else if (KEEP_AT.test(prelude) && !/^@media[^{]*\bprint\b/i.test(prelude)) stack.push({ kind: "at", selector: prelude, mode: mode ?? (DARK_AT.test(prelude) ? "dark" : LIGHT_AT.test(prelude) ? "light" : undefined), decls: [] });
        else stack.push({ kind: "skip", selector: prelude, mode, decls: [] });
        continue;
      }
      const selector = f?.kind === "rule" ? (prelude.includes("&") ? prelude.replace(/&/g, f.selector) : `${f.selector} ${prelude}`) : prelude;
      stack.push({ kind: "rule", selector, mode, decls: [] });
      continue;
    }
    // "}"
    const done = stack.pop();
    if (done && (done.kind === "rule" || done.kind === "face")) {
      done.decls.push(...declsOf(seg));
      if (done.kind === "rule" && done.decls.length) rules.push({ selector: done.selector, decls: done.decls, mode: done.mode });
      if (done.kind === "face") { const fam = done.decls.find(([p]) => p === "font-family")?.[1]; if (fam) faces.push(unquote(fam)); }
    }
    seg = "";
  }
  return { rules, imports, faces };
}
const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "").trim();

// ── HTML, read as text ──────────────────────────────────────────────────────
type Tag = { name: string; attrs: Record<string, string> };
export function tagsIn(html: string, names: string[]): Tag[] {
  const out: Tag[] = [];
  for (const m of html.matchAll(new RegExp(`<(${names.join("|")})\\b([^>]*)>`, "gi"))) {
    const attrs: Record<string, string> = {};
    for (const a of m[2].matchAll(/([^\s=/>"']+)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) attrs[a[1].toLowerCase()] = decodeEntities((a[2] ?? "").replace(/^["']|["']$/g, ""));
    out.push({ name: m[1].toLowerCase(), attrs });
  }
  return out;
}
const decodeEntities = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
const relTokens = (t: Tag) => (t.attrs.rel ?? "").toLowerCase().split(/\s+/);

/** The stylesheets a page links to, in order, as absolute addresses. */
export function stylesheetsOf(html: string, base: URL): string[] {
  const out: string[] = [];
  for (const t of tagsIn(html, ["link"])) {
    const rel = relTokens(t);
    const sheet = (rel.includes("stylesheet") && !rel.includes("alternate")) || (rel.includes("preload") && t.attrs.as === "style");
    if (!sheet || !t.attrs.href || /\bprint\b/i.test(t.attrs.media ?? "")) continue;
    try { const u = new URL(t.attrs.href, base).href; if (!out.includes(u)) out.push(u); } catch { /* not an address */ }
  }
  return out;
}
export function baseOf(html: string, url: string): URL {
  const href = tagsIn(html, ["base"]).find((t) => t.attrs.href)?.attrs.href;
  try { return new URL(href ?? url, url); } catch { return new URL(url); }
}

export interface SiteLogo { url: string; use: "full" | "mark" }

/**
 * Where the logo might be, likeliest first: the one the site names as its logo (in its
 * structured data, or an image called a logo), then its touch icons and SVG icon, which
 * are a mark, not the full logo. The caller takes the first that loads: a site's own
 * structured data can point at a file that is not there.
 */
export function logosOf(html: string, base: URL): SiteLogo[] {
  const out: SiteLogo[] = [];
  const add = (href: string | undefined, use: SiteLogo["use"]) => {
    if (!href || href.startsWith("data:")) return;
    try { const url = new URL(href, base).href; if (/^https?:/.test(url) && !out.some((l) => l.url === url)) out.push({ url, use }); } catch { /* not an address */ }
  };
  for (const m of html.matchAll(/<script[^>]+type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const visit = (x: unknown): void => {
        if (Array.isArray(x)) return x.forEach(visit);
        if (!x || typeof x !== "object") return;
        const o = x as Record<string, unknown>;
        const logo = o.logo as unknown;
        if (typeof logo === "string") add(logo, "full");
        else if (logo && typeof logo === "object" && typeof (logo as { url?: unknown }).url === "string") add((logo as { url: string }).url, "full");
        if (o["@graph"]) visit(o["@graph"]);
      };
      visit(JSON.parse(m[1]));
    } catch { /* not JSON */ }
  }
  for (const t of tagsIn(html, ["img"])) if (/logo/i.test(`${t.attrs.class ?? ""} ${t.attrs.id ?? ""} ${t.attrs.alt ?? ""} ${t.attrs.src ?? ""}`)) add(t.attrs.src, "full");
  const links = tagsIn(html, ["link"]).filter((t) => t.attrs.href);
  const size = (t: Tag) => Math.max(0, ...(t.attrs.sizes ?? "").split(/\s+/).map((s) => parseInt(s, 10) || 0));
  for (const t of links.filter((t) => relTokens(t).some((r) => r.startsWith("apple-touch-icon"))).sort((x, y) => size(y) - size(x))) add(t.attrs.href, "mark");
  for (const t of links.filter((t) => relTokens(t).includes("icon") && (t.attrs.type === "image/svg+xml" || /\.svg(\?|$)/i.test(t.attrs.href ?? "")))) add(t.attrs.href, "mark");
  for (const t of links.filter((t) => relTokens(t).includes("icon") && !/\.ico(\?|$)/i.test(t.attrs.href ?? "")).sort((x, y) => size(y) - size(x))) add(t.attrs.href, "mark");
  return out.slice(0, 6);
}
export const logoOf = (html: string, base: URL): SiteLogo | undefined => logosOf(html, base)[0];

/** The colours an SVG paints with, the most used first. */
export function svgColors(svg: string): string[] {
  const counts = new Map<string, number>();
  const take = (v: string) => { const c = parseColor(v); if (c) counts.set(c, (counts.get(c) ?? 0) + 1); };
  for (const m of svg.matchAll(/\b(?:fill|stroke|stop-color|color)\s*=\s*["']([^"']+)["']/gi)) take(m[1]);
  for (const m of svg.matchAll(/\b(?:fill|stroke|stop-color)\s*:\s*([^;"'}]+)/gi)) take(m[1]);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 5);
}

/** What the site calls itself: og:site_name, then the app name, then the title's shortest part that is not a slogan. */
export function nameOf(html: string, url: URL): string {
  const metas = tagsIn(html, ["meta"]);
  const meta = (key: string) => metas.find((t) => (t.attrs.property ?? t.attrs.name ?? "").toLowerCase() === key)?.attrs.content?.trim();
  const host = url.hostname.replace(/^www\./, "");
  const named = meta("og:site_name") || meta("application-name") || meta("apple-mobile-web-app-title");
  if (named && named.length <= 60) return named;
  const title = decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "").trim();
  const parts = title.split(/\s+[|\u2013\u2014\u00b7:\u2022-]\s+/).map((p) => p.trim()).filter(Boolean);
  const root = host.split(".")[0].toLowerCase();
  const match = parts.find((p) => p.toLowerCase().replace(/[^a-z0-9]/g, "").includes(root.replace(/[^a-z0-9]/g, "")));
  const pick = match ?? parts.sort((a, b) => a.length - b.length)[0];
  return pick && pick.length <= 60 ? pick : host;
}

// ── what the page uses ──────────────────────────────────────────────────────
type Bin = "brand" | "background" | "text" | "neutral" | "mono";
/** One piece of evidence for a colour, and what it was. */
export interface Clue { hex: string; w: number; from: string; hint?: ColorRole; sources?: string[] }

const STATUS = new Set(["success", "danger", "error", "errors", "warning", "warn", "info", "positive", "negative", "critical", "caution", "alert", "destructive", "notice", "attention", "severe", "done", "closed", "merged", "sponsors", "sponsor", "draft", "upsell", "valid", "invalid", "pending", "new", "open", "added", "removed", "deleted", "diff", "shipped", "planned", "beta", "soon", "deprecated", "ok", "fail", "failed", "passed"]);
// Written into one token as often as not: --action-bg-subduedhover.
const STATE = /hover|active|focus|pressed|visited|disabled|selected|checked|placeholder|^rest$/;
// A palette's steps (--blue-500, --color-ruby-400) say what colours exist, not which the page uses.
const HUES = new Set(["red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose", "ruby", "slate", "gray", "grey", "zinc", "stone", "magenta", "crimson", "tomato", "jade", "grass", "mint", "plum", "iris", "gold", "bronze", "brown", "sand", "olive", "sage", "mauve", "coral", "navy", "lavender", "lemon", "salmon", "aqua", "turquoise", "black", "white"]);
const TEXT_W = new Set(["text", "fg", "fgcolor", "foreground", "ink", "copy"]);
const BG_W = new Set(["bg", "bgcolor", "background", "surface", "canvas", "page"]);
const BRAND_W: Record<string, { w: number; hint?: ColorRole }> = { brand: { w: 6, hint: "primary" }, primary: { w: 6, hint: "primary" }, action: { w: 4, hint: "primary" }, cta: { w: 4, hint: "primary" }, accent: { w: 4, hint: "accent" }, highlight: { w: 3, hint: "accent" }, secondary: { w: 3, hint: "secondary" }, interactive: { w: 3 }, link: { w: 2 } };
const MAIN = new Set(["primary", "default", "base", "main", "body", "1"]);
const SIDE = new Set(["secondary", "tertiary", "muted", "subtle", "alt", "2", "3", "4", "card", "panel", "raised", "elevated", "sunken", "inset", "overlay", "popover", "emphasis", "strong", "inverse", "inverted", "invert", "contrast", "light", "dark", "code", "header", "footer", "nav", "sidebar", "menu", "input", "tooltip", "modal", "dialog"]);
// A part of the page, not the page: --scrollbar-thumb-bg is not the background.
const COMPONENT = new Set(["scrollbar", "thumb", "track", "tooltip", "menu", "actionmenu", "dropdown", "select", "input", "field", "button", "btn", "badge", "chip", "tag", "label", "avatar", "skeleton", "kbd", "toast", "banner", "table", "row", "cell", "tab", "tabs", "switch", "toggle", "checkbox", "radio", "slider", "progress", "selection", "highlight", "mark", "icon", "iconbutton", "cursor", "caret", "shadow", "ring", "focus", "hero", "callout", "notification", "popover", "modal", "dialog", "overlay", "header", "footer", "nav", "navbar", "sidebar", "card", "panel", "code", "pre", "diff", "syntax"]);
// A shade of a brand colour, not the colour: --accent-tint, --brand-soft.
const SHADE = new Set(["tint", "tinted", "wash", "soft", "faint", "weak", "subtle", "muted", "light", "lighter", "lightest", "dark", "darker", "darkest", "pale", "alpha", "translucent", "transparent", "bg", "background", "surface", "border", "fg", "text", "foreground", "contrast", "inverse", "on"]);
const NEUTRAL_W = new Set(["border", "line", "divider", "muted", "neutral", "gray", "grey", "stroke", "outline", "separator", "card", "panel"]);
const tokensOf = (name: string) => name.replace(/^--/, "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase().split(/[-_]+/).filter(Boolean);

/** What a custom property's name says it is for, if anything. */
export function varRole(name: string, prefixes: Set<string> = new Set()): { bin: Bin; hint?: ColorRole; w: number } | null {
  const all = tokensOf(name);
  const t = all.length > 1 && prefixes.has(all[0]) ? all.slice(1) : all;
  if (t.some((x) => STATUS.has(x))) return null;
  const k = (t.some((x) => STATE.test(x)) ? 0.4 : 1) * (t.some((x) => HUES.has(x)) || /^\d{2,4}$/.test(t[t.length - 1]) ? 0.15 : 1);
  const palette = k < 1;
  const at = (set: Set<string>) => t.findIndex((x) => set.has(x));
  const iText = at(TEXT_W), iBg = at(BG_W);
  const iBrand = t.findIndex((x, i) => x in BRAND_W && !((x === "primary" || x === "secondary") && (i > iText && iText >= 0 || i > iBg && iBg >= 0)));
  const side = t.some((x, i) => SIDE.has(x) && !(x === "secondary" && i === iBrand));
  const brand = iBrand >= 0 ? BRAND_W[t[iBrand]] : undefined;
  const part = t.some((x) => COMPONENT.has(x));
  // How plainly it names the thing: --bg is the background, --page-bg nearly, --hero-card-bg not.
  const plainness = (i: number) => { const rest = t.filter((x, j) => j !== i && x !== "color" && !MAIN.has(x)).length; return rest === 0 ? 6 : rest === 1 ? 2 : 0.5; };
  if (iBg >= 0) {
    if (brand) return { bin: "brand", w: 4 * k * (part ? 0.3 : 1) };
    if (side || part || /^[2-9]$/.test(t[t.length - 1])) return { bin: "neutral", w: (part ? 1 : 2) * k };
    return { bin: "background", w: plainness(iBg) * k };
  }
  if (iText >= 0) {
    // --primary-foreground is the text ON the primary; --text-brand is the brand AS text.
    // Either way an on-colour is white or near black, which never passes for a brand colour.
    if (brand) return { bin: "brand", w: (iBrand < iText ? 1 : 2) * k };
    if (side || part || t.some((x) => ["link", "on", "white", "black", "placeholder"].includes(x))) return null;
    return { bin: "text", w: plainness(iText) * k };
  }
  if (brand) {
    const shade = t.some((x, i) => i !== iBrand && (SHADE.has(x) || /tint|wash|subdued|faint|pale|alpha/.test(x)));
    return { bin: "brand", hint: palette || shade || part ? undefined : brand.hint, w: brand.w * k * (shade || part ? 0.3 : 1) };
  }
  if (t.some((x) => NEUTRAL_W.has(x))) return { bin: "neutral", w: 2 * k };
  return null;
}

const PAGE = /^(html|body|:root|html\s+body|:root\s+body|body\s*>\s*main|main)$/i;
const BUTTON = /\bbutton\b|\bbtn\b|[-_]btn\b|\bbtn[-_]|\bcta\b|[-_]cta\b|\[type=["']?(submit|button)|\.button|\bbutton[-_]/i;
const LINK = /(^|[\s>+~(])a(?=$|[\s:.[#>+~)])|\.link\b|\blink[-_]|[-_]link\b/i;
const HEADING = /(^|[\s>+~(])h[1-3](?=$|[\s:.[#>+~)])|\b(title|heading|headline|display|hero)\b/i;
const CODE = /(^|[\s>+~(])(code|pre|kbd|samp)(?=$|[\s:.[#>+~)])|\bmono/i;
const STATE_SEL = /:(hover|focus|focus-visible|focus-within|active|visited|disabled)\b/i;
const unescapeIdent = (s: string) => s.replace(/\\([0-9a-f]{1,6}\s?|.)/gi, (_, x: string) => (/^[0-9a-f]{1,6}\s?$/i.test(x) && x.trim().length > 1 ? String.fromCodePoint(parseInt(x, 16)) : x.trim() || x));

/** Where the page puts each class: how often, and on its buttons, links, headings or the page itself. */
export interface ClassUse { n: number; button: number; link: number; heading: number; page: number; code: number }
export function classUse(html: string): Map<string, ClassUse> {
  const use = new Map<string, ClassUse>();
  for (const m of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*?)\sclass(?:name)?\s*=\s*(?:"([^"]*)"|'([^']*)')([^>]*)>/gi)) {
    const tag = m[1].toLowerCase(); const attrs = `${m[2]} ${m[5]}`;
    const button = tag === "button" || /\brole\s*=\s*["']?button/i.test(attrs) || (tag === "input" && /\btype\s*=\s*["']?(submit|button)/i.test(attrs));
    for (const c of (m[3] ?? m[4] ?? "").split(/\s+/)) {
      if (!c) continue;
      const u = use.get(c) ?? { n: 0, button: 0, link: 0, heading: 0, page: 0, code: 0 };
      u.n++;
      if (button) u.button++;
      if (tag === "a") u.link++;
      if (/^h[1-3]$/.test(tag)) u.heading++;
      if (tag === "html" || tag === "body") u.page++;
      if (tag === "code" || tag === "pre" || tag === "kbd") u.code++;
      use.set(c, u);
    }
  }
  return use;
}

const NOT_A_FONT = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong|inherit|initial|unset|revert|revert-layer|-apple-system|blinkmacsystemfont|segoe ui|roboto|helvetica neue|helvetica|arial|noto sans|liberation sans|liberation mono|ubuntu|cantarell|fira sans|droid sans|oxygen|oxygen-sans|sfmono-regular|sf mono|menlo|monaco|consolas|courier new|courier|lucida grande|lucida console|tahoma|verdana|georgia|times new roman|times|apple color emoji|segoe ui emoji|segoe ui symbol|noto color emoji|android emoji|emojisymbols|font ?awesome.*|material (symbols|icons).*|glyphicons.*|icomoon|swiper-icons|dashicons|bootstrap-icons|ionicons|feather|remixicon|tabler-icons)$/i;
/** A family name as a person would say it: next/font's `__Inter_d65c78` is Inter, fontsource's "Geist Variable" is Geist. */
export function cleanFamily(raw: string): string | null {
  let f = unquote(raw);
  const nf = /^__(.+?)_[0-9a-f]{5,}$/i.exec(f);
  if (nf) f = nf[1].replace(/_/g, " ");
  f = f.replace(/[\s_-]+(variable|var|vf)$/i, "").trim();
  if (!f || f.length > 60 || !/[a-z]/i.test(f) || /[/():;{}<>]/.test(f) || /fallback|polyfill|placeholder/i.test(f) || /\b(fix|icons?|symbols?|emoji)\b/i.test(f) || NOT_A_FONT.test(f)) return null;
  return f;
}
/** Which of `known` a site's name for a font means: "Geist Variable", "GeistSans" and "geist" are all Geist. */
export function sameFamily(name: string, known: string[]): string | undefined {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const n = norm(cleanFamily(name) ?? name);
  return known.find((k) => norm(k) === n) ?? known.find((k) => `${norm(k)}sans` === n);
}
const familiesIn = (value: string) => value.split(",").map(cleanFamily).filter((f): f is string => !!f);
const fontShorthandFamily = (v: string) => /(?:^|\s)(?:[\d.]+(?:px|r?em|%|pt|vw|vh|ch)|xx?-(?:small|large)|small|medium|large|larger|smaller)(?:\s*\/\s*\S+)?\s+([^/]+)$/i.exec(v)?.[1] ?? "";

/** Whether the page is drawn in its dark mode: `<html class="dark">`, `data-theme="dark"`, `color-scheme: dark`. */
export function pageIsDark(html: string): boolean {
  return tagsIn(html.slice(0, 200_000), ["html", "body"]).some((t) => /(^|\s)(dark|night|theme-dark|dark-theme|dark-mode)(\s|$)/i.test(t.attrs.class ?? "")
    || Object.entries(t.attrs).some(([k, v]) => /^data-[\w-]*(theme|mode|scheme|appearance)/.test(k) && /^(dark|night|dim|midnight)\b/i.test(v))
    || /color-scheme\s*:\s*dark\b/i.test(t.attrs.style ?? ""));
}

/** Everything the page says about its colours and fonts, weighed. */
export function evidence({ html, css, url, logoColors = [] }: PageText) {
  const parsed = cssRules(css);
  const inline = cssRules([...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n"));
  const rules = [...parsed.rules, ...inline.rules];
  const faces = [...parsed.faces, ...inline.faces];
  const classes = classUse(html);
  // A page in dark mode reads its dark rules and skips its light ones, and the other way round.
  // Each part of a selector list is judged on its own: ":root, .dark" is half a light rule.
  const root = tagsIn(html.slice(0, 200_000), ["html", "body"]);
  const mode: Mode = pageIsDark(html) ? "dark" : "light";
  const partsOf = (r: Rule) => (r.mode && r.mode !== mode ? [] : r.selector.split(",").map((x) => x.trim()).filter((x) => x && (modeOf(x) ?? mode) === mode));
  const own = (r: Rule, parts: string[]) => r.mode === mode || parts.some((x) => modeOf(x) === mode); // written for this mode: it wins
  // :root, html, body, or the page root with a class or attribute it really has, like [data-theme="day"].
  const onRoot = (part: string): boolean => {
    if (/^(:root|html|body|\*|:host|:where\(:root\)|:root:root)$/i.test(part) || (classes.get(part.replace(/^\./, ""))?.page ?? 0) > 0) return true;
    const m = /^(?::root|html|body)?((?:\.[\w-]+|\[[^\]]+\]|:not\([^()]*\))+)$/i.exec(part);
    if (!m) return false;
    return [...m[1].matchAll(/\.([\w-]+)|\[([\w-]+)(?:\s*=\s*["']?([^"'\]]*)["']?)?\]|:not\(([^()]*)\)/g)].every(([, cls, attr, value, not]) =>
      not !== undefined ? !onRoot(not) : cls ? root.some((t) => (t.attrs.class ?? "").split(/\s+/).includes(cls)) : root.some((t) => attr.toLowerCase() in t.attrs && (value === undefined || t.attrs[attr.toLowerCase()] === value)));
  };

  // Custom properties: the global ones for this mode win; a scoped one is a fallback. A
  // design system's own prefix (--brand-*, --hds-*) is a namespace, not a meaning.
  const globals = new Map<string, string>(); const scoped = new Map<string, string>();
  for (const pass of [false, true]) for (const r of rules) {
    const parts = partsOf(r);
    if (!parts.length || own(r, parts) !== pass) continue;
    const global = parts.some(onRoot);
    for (const [p, v] of r.decls) if (p.startsWith("--")) { if (global) globals.set(p, v); else if (pass || !scoped.has(p)) scoped.set(p, v); }
  }
  const firsts = new Map<string, number>();
  for (const name of globals.keys()) { const t0 = tokensOf(name)[0]; if (t0) firsts.set(t0, (firsts.get(t0) ?? 0) + 1); }
  const prefixes = new Set([...firsts].filter(([t, n]) => n >= 12 && n >= globals.size * 0.25 && t !== "color").map(([t]) => t));
  const resolve = (value: string, local?: Map<string, string>, depth = 0): string => (depth > 8 || !value.includes("var(") ? value
    : resolve(value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\((?:[^()]|\([^()]*\))*\))*))?\)/g, (_, name: string, fb?: string) => local?.get(name) ?? globals.get(name) ?? scoped.get(name) ?? fb ?? ""), local, depth + 1));
  const colorOf = (v: string, local?: Map<string, string>) => {
    const r = resolve(v, local).trim();
    if (/^[\d.]+(deg)?\s+[\d.]+%\s+[\d.]+%$/.test(r)) return parseColor(`hsl(${r})`); // shadcn: --primary: 262 83% 58%
    return parseColor(r);
  };

  const clues: Record<Bin, Clue[]> = { brand: [], background: [], text: [], neutral: [], mono: [] };
  const add = (bin: Bin, hex: string | null | undefined, w: number, from: string, hint?: ColorRole) => { if (hex && w > 0) clues[bin].push({ hex, w, from, hint }); };
  const colorful = (h: string) => chroma(h) >= 0.04;

  for (const [name, v] of globals) { const role = varRole(name, prefixes); if (role) add(role.bin, colorOf(v), role.w, name, role.hint); }

  const fonts = { body: new Map<string, number>(), display: new Map<string, number>(), mono: new Map<string, number>(), any: new Map<string, number>() };
  const bump = (m: Map<string, number>, k: string, w: number) => m.set(k, (m.get(k) ?? 0) + w);

  for (const r of rules) {
    const sels = partsOf(r);
    if (!sels.length) continue;
    const modeW = own(r, sels) ? 1.5 : 1;
    const selector = sels.join(", ");
    const lastOf = (s: string) => s.split(/[\s>+~]+/).pop() ?? "";
    const cls = sels.flatMap((s) => [...lastOf(s).matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) => unescapeIdent(m[1])));
    if (cls.length && cls.every((c) => /^(dark|print|forced-colors|contrast-more):/.test(c))) continue;
    // A status keeps its own colours: .badge-shipped, .alert-danger, .text-success.
    if (cls.some((c) => tokensOf(c.replace(/^.*:/, "")).some((x) => STATUS.has(x)))) continue;
    const uses = cls.map((c) => classes.get(c)).filter((u): u is ClassUse => !!u);
    const most = (k: keyof ClassUse) => Math.max(0, ...uses.map((u) => u[k]));
    const n = most("n");
    const reach = !cls.length ? 1 : n === 0 ? 0.15 : 1 + Math.log2(1 + n);
    const stateW = sels.every((s) => STATE_SEL.test(s)) || (cls.length > 0 && cls.every((c) => /^(group-|peer-)?(hover|focus|active|focus-visible|focus-within):/.test(c))) ? 0.4 : 1;
    const isPage = sels.some((s) => PAGE.test(s)) || most("page") > 0;
    const isButton = BUTTON.test(selector) || most("button") > 0;
    const onLink = LINK.test(selector) || most("link") > 0;
    const isHeading = HEADING.test(selector) || most("heading") > 0;
    const isCode = CODE.test(selector) || most("code") > 0;
    const local = new Map(r.decls.filter(([p]) => p.startsWith("--")));
    for (const [prop, raw] of r.decls) {
      if (prop.startsWith("--")) continue;
      if (prop === "font-family" || prop === "font") {
        if (/:lang\(|\[lang/i.test(selector)) continue;
        const f = familiesIn(prop === "font" ? fontShorthandFamily(resolve(raw, local)) : resolve(raw, local))[0];
        if (!f) continue;
        if (isPage) bump(fonts.body, f, 8);
        else if (isCode) bump(fonts.mono, f, 5 * reach);
        else if (isHeading) bump(fonts.display, f, 4 * stateW * reach);
        bump(fonts.any, f, (isPage ? 4 : 1) * reach);
        continue;
      }
      const value = resolve(raw, local);
      const cols = prop === "color" ? [colorOf(raw, local)].filter((x): x is string => !!x) : colorsIn(value);
      if (!cols.length) continue;
      const w = reach * stateW * modeW;
      if (prop === "background" || prop === "background-color" || prop === "background-image") {
        const solid = !/gradient\(/i.test(value);
        if (isPage && solid) { add("background", cols[0], 10 * modeW, "the page background"); continue; }
        // A link with a background is a button, the way most sites draw one.
        const button = isButton || (onLink && solid);
        for (const c of cols) {
          if (colorful(c)) add("brand", c, (button ? (solid ? 4 : 2) : solid ? 0.6 : 0.4) * w, button ? "buttons" : solid ? "backgrounds" : "gradients");
          else if (button && solid) add("mono", c, 4 * w, "buttons");
          else if (solid) add("neutral", c, 0.3 * w, "backgrounds");
        }
      } else if (prop === "color") {
        const c = cols[0];
        if (isPage) add("text", c, 10 * modeW, "the page text");
        else if (onLink && colorful(c) && !isButton) add("brand", c, 2 * w, "links");
        else if (isHeading) { if (chroma(c) >= 0.08) add("brand", c, w, "headings"); else add("text", c, 0.5 * w, "headings"); }
        else if (colorful(c) && !isButton) add("brand", c, 0.3 * w, "text");
        else if (!colorful(c) && !isButton) add("text", c, 0.3 * w, "text");
      } else if (prop.startsWith("border") || prop.startsWith("outline")) {
        for (const c of cols) { if (colorful(c)) add("brand", c, (isButton ? 1 : 0.2) * w, "borders"); else add("neutral", c, w, "borders"); }
      } else if (prop === "fill" || prop === "stroke") {
        for (const c of cols) if (colorful(c)) add("brand", c, 0.5 * w, "icons");
      }
    }
  }
  // Colours written on the page itself.
  for (const m of html.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    for (const [prop, v] of cssRules(`x{${decodeEntities(m[1] ?? m[2] ?? "")}}`).rules[0]?.decls ?? []) {
      if (/^(background|background-color|color|fill)$/.test(prop)) for (const c of colorsIn(resolve(v))) if (colorful(c)) add("brand", c, 0.5, "the page");
    }
  }
  for (const t of tagsIn(html, ["meta"])) {
    const key = (t.attrs.name ?? "").toLowerCase();
    if ((key === "theme-color" || key === "msapplication-tilecolor") && !(mode === "dark" ? LIGHT_AT : DARK_AT).test(t.attrs.media ?? "")) {
      const c = parseColor(t.attrs.content ?? "");
      if (c && colorful(c)) add("brand", c, key === "theme-color" ? 3 : 2, "the theme colour");
      else if (c) add("background", c, 3, "the theme colour");
    }
  }
  logoColors.forEach((c, i) => { if (colorful(c)) add("brand", c, i === 0 ? 5 : 3, "the logo"); });

  // Families from @font-face and Google Fonts links count too, a little.
  for (const f of faces.map(cleanFamily)) if (f) bump(fonts.any, f, 1);
  const base = baseOf(html, url);
  for (const t of tagsIn(html, ["link"])) {
    const href = t.attrs.href ?? "";
    if (!/fonts\.googleapis\.com\/css/.test(href)) continue;
    try { for (const fam of new URL(href, base).searchParams.getAll("family")) { const f = cleanFamily(fam.split(":")[0].replace(/\+/g, " ")); if (f) bump(fonts.any, f, 2); } } catch { /* not an address */ }
  }

  const ranked = (bin: Bin): Clue[] => {
    const groups: { hex: string; w: number; by: Map<string, number>; hint?: ColorRole; hintW: number }[] = [];
    for (const u of clues[bin]) {
      let g = groups.find((x) => distance(x.hex, u.hex) < 0.02);
      if (!g) { g = { hex: u.hex, w: 0, by: new Map(), hintW: 0 }; groups.push(g); }
      g.w += u.w; g.by.set(u.from, (g.by.get(u.from) ?? 0) + u.w);
      if (u.hint && u.w > g.hintW) { g.hint = u.hint; g.hintW = u.w; }
    }
    return groups.map((g) => ({ hex: g.hex, w: g.w, from: [...g.by].sort((a, b) => b[1] - a[1])[0][0], hint: g.hint, sources: [...g.by.keys()] })).sort((a, b) => b.w - a.w);
  };
  const order = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  return {
    colors: { brand: ranked("brand"), background: ranked("background"), text: ranked("text"), neutral: ranked("neutral"), mono: ranked("mono") },
    fonts: { body: order(fonts.body), display: order(fonts.display), mono: order(fonts.mono), any: order(fonts.any) },
  };
}

const hue = (hex: string) => { const [, a, b] = oklab(hex); return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360; };
const hueGap = (x: string, y: string) => { const d = Math.abs(hue(x) - hue(y)); return Math.min(d, 360 - d); };

/** Read a page and its stylesheets, and propose a swatch from them. */
export function readSite(page: PageText): SiteProposal {
  const ev = evidence(page);
  const notes: string[] = [];
  const made = "made from the others";
  // What the page itself declares on html and body is the background and the text; usage only fills in.
  const declared = (list: Clue[], from: string) => list.find((c) => c.sources?.includes(from));
  const background = declared(ev.colors.background, "the page background") ?? ev.colors.background[0] ?? { hex: "#ffffff", w: 0, from: "the browser's default" };
  const pageText = declared(ev.colors.text, "the page text");
  const readable = (min: number) => (pageText && ratio(pageText.hex, background.hex) >= min ? pageText : undefined) ?? ev.colors.text.find((t) => ratio(t.hex, background.hex) >= min);
  const text = readable(4.5) ?? readable(3) ?? { hex: ratio("#111111", background.hex) >= ratio("#ffffff", background.hex) ? "#111111" : "#ffffff", w: 0, from: made };
  const apart = (b: Clue) => distance(b.hex, background.hex) > 0.06 && distance(b.hex, text.hex) > 0.06;
  const brand = ev.colors.brand.filter((b) => chroma(b.hex) >= 0.04 && apart(b));
  const top = brand[0]?.w ?? 0;
  // The brand colour is the one in its logo, when the page uses it at all.
  const logo = (page.logoColors ?? []).filter((c) => chroma(c) >= 0.04);
  // The page's own hex beats the logo's pixels, which are an average: prefer a colour the page uses.
  const nearLogo = (b: Clue) => logo.some((c) => distance(c, b.hex) < 0.1) && b.w >= top * 0.15;
  const inLogo = brand.find((b) => nearLogo(b) && b.sources?.some((x) => x !== "the logo")) ?? brand.find(nearLogo);
  // A black and white brand: its buttons are black (or white), and outweigh every colour it has.
  const mono = ev.colors.mono.find((m) => apart(m) || distance(m.hex, text.hex) <= 0.06);
  const chosen: Partial<Record<ColorRole, Clue>> = {};
  if (inLogo) chosen.primary = { ...inLogo, from: inLogo.from === "the logo" ? "the logo" : `${inLogo.from} and the logo` };
  else if (mono && mono.w > top * 2 && !logo.length) chosen.primary = mono;
  else chosen.primary = brand[0];
  const distinct = (hex: string) => Object.values(chosen).every((c) => !c || distance(c.hex, hex) > 0.08);
  const enough = (b: Clue, share: number) => b.w >= top * share;
  const rest = () => brand.filter((b) => distinct(b.hex));
  // A colour named secondary or accent is that; otherwise the accent is the next colour of
  // a different hue, a colour that stands out, and the secondary is the next after that.
  for (const role of ["secondary", "accent"] as const) { const named = rest().find((b) => b.hint === role && enough(b, 0.1)); if (named) chosen[role] = named; }
  if (!chosen.accent && chosen.primary) chosen.accent = rest().find((b) => enough(b, 0.05) && chroma(b.hex) >= 0.08 && (chroma(chosen.primary!.hex) < 0.04 || hueGap(b.hex, chosen.primary!.hex) > 40));
  if (!chosen.secondary) chosen.secondary = rest().find((b) => enough(b, 0.05));
  if (!chosen.accent) chosen.accent = rest().find((b) => enough(b, 0.05));
  // A neutral sits between the page and its text: a border, a card, a quiet panel.
  const [lo, hi] = [lightness(background.hex), lightness(text.hex)].sort((x, y) => x - y);
  const between = ev.colors.neutral.filter((n) => chroma(n.hex) < 0.14 && lightness(n.hex) > lo + 0.02 && lightness(n.hex) < hi - 0.02 && distance(n.hex, background.hex) > 0.03);
  const neutral = between.find((n) => Math.abs(lightness(n.hex) - lightness(background.hex)) < 0.3) ?? between[0];

  if (!chosen.primary) {
    chosen.primary = { hex: text.hex, w: 0, from: "the page text" };
    notes.push("knitted found no brand colour on this site, so its text colour stands in. If the brand has a colour, pick it from its logo.");
  }
  const P = chosen.primary.hex;
  const grey = chroma(P) < 0.04;
  const light = lightness(background.hex) > 0.6;
  const colors: SiteColor[] = [
    { role: "primary", name: "Primary", hex: P, from: chosen.primary.from },
    { role: "secondary", name: "Secondary", hex: chosen.secondary?.hex ?? (grey ? mix(text.hex, background.hex, 0.4) : mix(P, light ? "#000000" : "#ffffff", 0.35)), from: chosen.secondary?.from ?? made },
    { role: "accent", name: "Accent", hex: chosen.accent?.hex ?? (grey ? mix(text.hex, background.hex, 0.65) : mix(P, background.hex, 0.55)), from: chosen.accent?.from ?? made },
    { role: "neutral", name: "Neutral", hex: neutral?.hex ?? mix(background.hex, text.hex, 0.14), from: neutral?.from ?? made },
    { role: "background", name: "Background", hex: background.hex, from: background.from },
    { role: "text", name: "Text", hex: text.hex, from: text.from },
  ];

  const f = ev.fonts;
  const body = f.body[0] ?? f.any[0];
  const display = f.display[0] ?? f.any.find((x) => x !== body) ?? body;
  return {
    name: nameOf(page.html, new URL(page.url)), colors, fonts: f.any.slice(0, 6), fontRoles: { display, body, mono: f.mono[0] },
    logo: page.logo === undefined ? logoOf(page.html, baseOf(page.html, page.url)) : page.logo ?? undefined, sourceUrl: page.url, notes,
  };
}
