// Design sheets: a whole site's UI on one board, like a Figma file, in labelled sections
// (Foundations, Components, Pages) of frames. A frame is a screen or a piece of one, written
// as HTML and CSS at a device's width, and drawn with the project's Swatch through CSS
// variables, so a change to the brand restyles every frame at once.
//
// Browser-safe and pure: the board, the store, the engine and the model's tools all build a
// frame's page and apply changes through the same functions here.

import { readableOn } from "./contrast.ts";
import { colorFor, fontFor } from "./tokens.ts";
import { COLOR_ROLES, type Swatch } from "./types.ts";

export type DesignDevice = "desktop" | "tablet" | "mobile";
export const DESIGN_DEVICES: Record<DesignDevice, { name: string; width: number; height: number }> = {
  desktop: { name: "Desktop", width: 1440, height: 900 },
  tablet: { name: "Tablet", width: 834, height: 1194 },
  mobile: { name: "Mobile", width: 390, height: 844 },
};

/** One screen, or one piece of a screen: a header, a card, the buttons. */
export interface DesignFrame {
  id: string;
  name: string;
  /** In CSS pixels: 1440 for a desktop screen, 390 for a phone. */
  width: number;
  /** Fixed, like one screen of a phone; absent, it is as tall as what is in it. */
  height?: number;
  html: string;
  css: string;
  /** What it is for, or what to do next with it. */
  note?: string;
  /** Who changed it last. Absent for a frame the sheet started with. */
  by?: "human" | "model";
  updatedAt: string;
}
export interface DesignSection { id: string; name: string; note?: string; frames: DesignFrame[] }
export interface Design {
  id: string;
  projectId: string;
  name: string;
  sections: DesignSection[];
  version: number;
  /** Whether Undo has a version to go back to. */
  canUndo: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export const DESIGN_LIMITS = { sections: 40, frames: 200, html: 200_000, css: 100_000, minWidth: 240, maxWidth: 3840, minHeight: 160, maxHeight: 20_000 };

/** The device a width is, if it is one of them. */
export function deviceOf(width: number): DesignDevice | null {
  return (Object.keys(DESIGN_DEVICES) as DesignDevice[]).find((d) => DESIGN_DEVICES[d].width === width) ?? null;
}
/** "Desktop 1440", "Mobile 390", or "1200 wide". */
export function frameSize(f: Pick<DesignFrame, "width" | "height">): string {
  const d = deviceOf(f.width);
  return `${d ? `${DESIGN_DEVICES[d].name} ${f.width}` : `${f.width} wide`}${f.height ? ` x ${f.height}` : ""}`;
}

// ── what a frame's code may do ────────────────────────────────────────────────
// A design is a picture of a site, drawn the same way every time and on any computer: no
// scripts, and nothing from the web. Forms and links are fine; they go nowhere here.
export interface DesignLint { level: "error" | "warning"; message: string }
const RULES: [RegExp, "error" | "warning", string][] = [
  [/<\s*script\b/i, "error", "Scripts do not run in a design. Show each state as a frame of its own: the menu open, the menu closed."],
  [/\son[a-z]+\s*=/i, "error", "Event handlers (onclick and friends) do nothing in a design. Show each state as a frame of its own."],
  [/javascript:/i, "error", "javascript: links are not allowed in a design."],
  [/<\s*(iframe|object|embed|link|meta|base|frame|frameset)\b/i, "error", "That element is not allowed in a design. Fonts come from the Swatch, and pictures from Yarn as yarn:<id>."],
  [/@import\b/i, "error", "@import is not allowed in a design. Fonts come from the Swatch."],
  [/\b(src|srcset|poster|data|background)\s*=\s*["']?\s*(https?:)?\/\//i, "error", "A design cannot load anything from the web. Add the picture to Yarn and use yarn:<id> instead."],
  [/url\(\s*["']?\s*(https?:)?\/\//i, "error", "A design cannot load anything from the web. Add the picture to Yarn and use url(yarn:<id>) instead."],
];
export function lintDesignCode(html: string, css: string): DesignLint[] {
  const text = `${html}\n${css}`;
  const out: DesignLint[] = RULES.filter(([re]) => re.test(text)).map(([, level, message]) => ({ level, message }));
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  if (imgs.some((t) => !/\balt\s*=/.test(t))) out.push({ level: "warning", message: "A picture has no alt text. Say what it shows, or alt=\"\" when it is only decoration." });
  if (html.length > DESIGN_LIMITS.html) out.push({ level: "error", message: `The HTML is ${Math.round(html.length / 1000)} KB. Keep a frame under ${DESIGN_LIMITS.html / 1000} KB: split it into frames.` });
  if (css.length > DESIGN_LIMITS.css) out.push({ level: "error", message: `The CSS is ${Math.round(css.length / 1000)} KB. Keep it under ${DESIGN_LIMITS.css / 1000} KB.` });
  return out;
}

// ── the brand, as CSS variables ───────────────────────────────────────────────
const quote = (f: string) => `"${f.replace(/"/g, "")}"`;
/** The Swatch as CSS variables: what every frame draws with, so the brand can change under it. */
export function tokensCss(swatch: Swatch): string {
  const text = colorFor(swatch, "text");
  const bg = colorFor(swatch, "background");
  const colors = COLOR_ROLES.map((r) => `--color-${r}:${colorFor(swatch, r)};`).join("");
  const on = (["primary", "secondary", "accent", "neutral"] as const).map((r) => `--color-on-${r}:${readableOn(colorFor(swatch, r), text, bg)};`).join("");
  const radius = Math.max(0, Math.min(48, Math.round((swatch.rules?.cornerRadius ?? 0.012) * 1080)));
  return `:root{${colors}${on}--font-display:${quote(fontFor(swatch, "display"))},system-ui,sans-serif;--font-body:${quote(fontFor(swatch, "body"))},system-ui,sans-serif;--font-mono:${quote(fontFor(swatch, "mono"))},ui-monospace,monospace;--radius:${radius}px;--radius-sm:${Math.round(radius / 2)}px;--radius-lg:${radius * 2}px}`;
}
/** The variables, as a model or a person reads them. */
export const TOKEN_NAMES = [
  ...COLOR_ROLES.map((r) => `--color-${r}`), "--color-on-primary", "--color-on-secondary", "--color-on-accent", "--color-on-neutral",
  "--font-display", "--font-body", "--font-mono", "--radius", "--radius-sm", "--radius-lg",
];

// ── a frame as a page ─────────────────────────────────────────────────────────
const YARN_REF = /yarn:(logo|yn_[0-9A-Z]{20})/g;
/** The Yarn a frame's code uses, by id, and whether it asks for the logo. */
export function yarnIn(html: string, css: string): string[] {
  return [...new Set([...`${html}\n${css}`.matchAll(YARN_REF)].map((m) => m[1]))];
}
/** What stands in for a picture that is not in Yarn any more. */
const MISSING = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#d8d2c8"/><path d="M150 190l40-50 30 35 20-20 40 35z" fill="#b0a798"/></svg>')}`;

export interface FrameCtx {
  swatch: Swatch;
  /** Where a Yarn file is, for this page: a URL in the studio, a file in a render, a path in a download. */
  yarnUrl: (id: string) => string | undefined;
  /** @font-face rules, or a stylesheet that has them. */
  fontFaces?: string;
  fontsHref?: string;
  /** A stylesheet with the tokens, in place of putting them in the page. */
  tokensHref?: string;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A frame as a whole page, at its width: the brand's tokens and fonts, then its own code. */
export function framePage(f: Pick<DesignFrame, "name" | "width" | "height" | "html" | "css">, ctx: FrameCtx): string {
  const logo = ctx.swatch.logos.find((l) => l.use === "full")?.yarnId ?? ctx.swatch.logos[0]?.yarnId;
  const withYarn = (s: string) => s.replace(YARN_REF, (_, id: string) => (id === "logo" ? (logo && ctx.yarnUrl(logo)) : ctx.yarnUrl(id)) ?? MISSING);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=${f.width}">
<title>${esc(f.name)}</title>
${ctx.fontsHref ? `<link rel="stylesheet" href="${esc(ctx.fontsHref)}">` : ""}${ctx.tokensHref ? `<link rel="stylesheet" href="${esc(ctx.tokensHref)}">` : ""}
<style>${ctx.fontFaces ?? ""}
${ctx.tokensHref ? "" : tokensCss(ctx.swatch)}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;width:${f.width}px${f.height ? `;height:${f.height}px` : ""}}
body{background:var(--color-background);color:var(--color-text);font-family:var(--font-body);line-height:1.5;-webkit-font-smoothing:antialiased;overflow:hidden}
img,svg,video{max-width:100%;display:block}
</style>
<style>${withYarn(f.css)}</style>
<style>*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent}</style>
</head><body>
${withYarn(f.html)}
</body></html>`;
}

// ── changes ───────────────────────────────────────────────────────────────────
/** A change to a sheet. Sections and frames are named by id, or a section by its name. */
export type DesignOp =
  | { op: "rename"; name: string }
  | { op: "addSection"; name: string; note?: string; at?: number }
  | { op: "updateSection"; section: string; name?: string; note?: string }
  | { op: "moveSection"; section: string; to: number }
  | { op: "removeSection"; section: string }
  | { op: "setFrame"; section: string; frameId?: string; name?: string; width?: number; height?: number | null; html?: string; css?: string; note?: string; at?: number }
  | { op: "moveFrame"; frameId: string; section: string; at?: number }
  | { op: "duplicateFrame"; frameId: string; name?: string }
  | { op: "removeFrame"; frameId: string };

/** A change that cannot be made, in words for the person or the model who asked. */
export class DesignProblem extends Error {}

const cleanName = (s: unknown, what: string) => {
  const n = String(s ?? "").trim().replace(/\s+/g, " ");
  if (!n) throw new DesignProblem(`Give the ${what} a name.`);
  if (n.length > 80) throw new DesignProblem(`That ${what} name is too long. Keep it under 80 characters.`);
  return n;
};
const cleanNote = (s: unknown) => { const n = String(s ?? "").trim(); if (n.length > 1000) throw new DesignProblem("Keep a note under 1,000 characters."); return n || undefined; };
const nextId = (sections: DesignSection[], p: "s" | "f") => {
  const ids = p === "s" ? sections.map((s) => s.id) : sections.flatMap((s) => s.frames.map((f) => f.id));
  return `${p}${1 + Math.max(0, ...ids.map((i) => Number(i.slice(1)) || 0))}`;
};
const place = <T,>(list: T[], item: T, at?: number) => { const i = at == null ? list.length : Math.max(0, Math.min(list.length, Math.round(at))); list.splice(i, 0, item); };

/** The section an op names: by id, or by name when no id matches. */
export function findSection(sections: DesignSection[], ref: string): DesignSection {
  const s = sections.find((x) => x.id === ref) ?? sections.find((x) => x.name.toLowerCase() === String(ref ?? "").trim().toLowerCase());
  if (!s) throw new DesignProblem(`There is no section "${ref}". The sections are ${sections.map((x) => `${x.name} (${x.id})`).join(", ") || "none yet"}.`);
  return s;
}
function findFrame(sections: DesignSection[], id: string): { section: DesignSection; frame: DesignFrame; index: number } {
  for (const section of sections) {
    const index = section.frames.findIndex((f) => f.id === id);
    if (index >= 0) return { section, frame: section.frames[index], index };
  }
  throw new DesignProblem(`There is no frame "${id}" in this design.`);
}
function cleanSize(width: unknown, height: unknown): { width?: number; height?: number | null } {
  const out: { width?: number; height?: number | null } = {};
  if (width !== undefined) {
    const w = Math.round(Number(width));
    if (!(w >= DESIGN_LIMITS.minWidth && w <= DESIGN_LIMITS.maxWidth)) throw new DesignProblem(`A frame is ${DESIGN_LIMITS.minWidth} to ${DESIGN_LIMITS.maxWidth} pixels wide: 1440 for desktop, 834 for a tablet, 390 for a phone.`);
    out.width = w;
  }
  if (height === null) out.height = null;
  else if (height !== undefined) {
    const h = Math.round(Number(height));
    if (!(h >= DESIGN_LIMITS.minHeight && h <= DESIGN_LIMITS.maxHeight)) throw new DesignProblem(`A fixed height is ${DESIGN_LIMITS.minHeight} to ${DESIGN_LIMITS.maxHeight} pixels. Leave it out for a frame as tall as what is in it.`);
    out.height = h;
  }
  return out;
}

/**
 * Apply changes in order, all or none. Returns the sheet as it is after them, and the ids of
 * the sections and frames they made, so the caller can say where its work went.
 */
export function applyDesignOps(design: { name: string; sections: DesignSection[] }, ops: DesignOp[], by: "human" | "model", now = new Date().toISOString()):
  { name: string; sections: DesignSection[]; made: { sections: string[]; frames: string[] }; lint: Record<string, DesignLint[]> } {
  let name = design.name;
  const sections: DesignSection[] = structuredClone(design.sections);
  const made = { sections: [] as string[], frames: [] as string[] };
  const lint: Record<string, DesignLint[]> = {};
  const count = () => sections.reduce((n, s) => n + s.frames.length, 0);
  for (const o of ops) {
    switch (o.op) {
      case "rename": name = cleanName(o.name, "design"); break;
      case "addSection": {
        if (sections.length >= DESIGN_LIMITS.sections) throw new DesignProblem(`A design has up to ${DESIGN_LIMITS.sections} sections. Start another design for the rest.`);
        const s: DesignSection = { id: nextId(sections, "s"), name: cleanName(o.name, "section"), note: cleanNote(o.note), frames: [] };
        place(sections, s, o.at); made.sections.push(s.id); break;
      }
      case "updateSection": {
        const s = findSection(sections, o.section);
        if (o.name !== undefined) s.name = cleanName(o.name, "section");
        if (o.note !== undefined) s.note = cleanNote(o.note);
        break;
      }
      case "moveSection": { const s = findSection(sections, o.section); sections.splice(sections.indexOf(s), 1); place(sections, s, o.to); break; }
      case "removeSection": { const s = findSection(sections, o.section); sections.splice(sections.indexOf(s), 1); break; }
      case "setFrame": {
        const s = findSection(sections, o.section);
        const size = cleanSize(o.width, o.height);
        const found = o.frameId ? findFrame(sections, o.frameId) : null;
        const html = o.html ?? found?.frame.html ?? "";
        const css = o.css ?? found?.frame.css ?? "";
        const problems = lintDesignCode(html, css);
        const errors = problems.filter((p) => p.level === "error");
        if (errors.length) throw new DesignProblem(errors.map((p) => p.message).join(" "));
        if (found) {
          const f = found.frame;
          if (o.name !== undefined) f.name = cleanName(o.name, "frame");
          if (size.width) f.width = size.width;
          if (size.height === null) delete f.height; else if (size.height) f.height = size.height;
          f.html = html; f.css = css;
          if (o.note !== undefined) f.note = cleanNote(o.note);
          f.by = by; f.updatedAt = now;
          if (found.section !== s) { found.section.frames.splice(found.index, 1); place(s.frames, f, o.at); }
          if (problems.length) lint[f.id] = problems;
        } else {
          if (o.frameId) throw new DesignProblem(`There is no frame "${o.frameId}" in this design.`);
          if (count() >= DESIGN_LIMITS.frames) throw new DesignProblem(`A design has up to ${DESIGN_LIMITS.frames} frames. Start another design for the rest.`);
          const f: DesignFrame = { id: nextId(sections, "f"), name: cleanName(o.name, "frame"), width: size.width ?? DESIGN_DEVICES.desktop.width, html, css, by, updatedAt: now };
          if (size.height) f.height = size.height;
          const note = cleanNote(o.note); if (note) f.note = note;
          place(s.frames, f, o.at); made.frames.push(f.id);
          if (problems.length) lint[f.id] = problems;
        }
        break;
      }
      case "moveFrame": {
        const { section, frame, index } = findFrame(sections, o.frameId);
        const to = findSection(sections, o.section);
        section.frames.splice(index, 1); place(to.frames, frame, o.at); break;
      }
      case "duplicateFrame": {
        if (count() >= DESIGN_LIMITS.frames) throw new DesignProblem(`A design has up to ${DESIGN_LIMITS.frames} frames.`);
        const { section, frame, index } = findFrame(sections, o.frameId);
        const copy: DesignFrame = { ...structuredClone(frame), id: nextId(sections, "f"), name: o.name ? cleanName(o.name, "frame") : `${frame.name} copy`, by, updatedAt: now };
        section.frames.splice(index + 1, 0, copy); made.frames.push(copy.id); break;
      }
      case "removeFrame": { const { section, index } = findFrame(sections, o.frameId); section.frames.splice(index, 1); break; }
      default: throw new DesignProblem(`"${(o as { op: string }).op}" is not a change a design takes.`);
    }
  }
  return { name, sections, made, lint };
}

// ── a sheet to start from ─────────────────────────────────────────────────────
// Foundations, Components and Pages, drawn only with the tokens, so they follow the Swatch.

const SHEET_CSS = `.sheet{padding:96px 120px}
.eyebrow{font:600 13px/1 var(--font-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--color-primary);margin:0 0 16px}
.title{font:700 64px/1.05 var(--font-display);letter-spacing:-.02em;margin:0 0 16px}
.lede{font-size:20px;line-height:1.5;max-width:680px;margin:0 0 56px;color:color-mix(in srgb,var(--color-text) 78%,transparent)}
code{font:13px/1.4 var(--font-mono);color:color-mix(in srgb,var(--color-text) 70%,transparent)}`;

const SITE_CSS = `.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:48px;padding:0 24px;border-radius:var(--radius);font:600 16px/1 var(--font-body);text-decoration:none;border:1.5px solid transparent;white-space:nowrap}
.btn.primary{background:var(--color-primary);color:var(--color-on-primary)}
.btn.secondary{background:var(--color-secondary);color:var(--color-on-secondary)}
.btn.ghost{border-color:currentColor;color:var(--color-text)}
.btn.on{background:var(--color-on-primary);color:var(--color-primary)}
h1,h2,h3{font-family:var(--font-display);letter-spacing:-.02em;margin:0}
.eyebrow{font:600 13px/1 var(--font-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--color-primary);margin:0 0 16px}
.top{display:flex;align-items:center;gap:48px;padding:24px 120px;border-bottom:1px solid color-mix(in srgb,var(--color-text) 10%,transparent)}
.top nav{display:flex;gap:32px;margin-right:auto}
.top nav a,.foot nav a{color:inherit;text-decoration:none;font-weight:500}
.brand{display:flex;align-items:center;font:700 24px/1 var(--font-display);color:var(--color-text);text-decoration:none}
.brand img{height:32px;width:auto}
.menu{display:none;margin-left:auto;width:44px;height:44px;border-radius:var(--radius);border:1.5px solid color-mix(in srgb,var(--color-text) 25%,transparent);align-content:center;justify-items:center;gap:5px}
.menu i{display:block;width:18px;height:2px;border-radius:2px;background:currentColor}
.hero{display:grid;grid-template-columns:1.1fr 1fr;gap:64px;align-items:center;padding:96px 120px}
.hero h1{font-size:64px;line-height:1.05;margin-bottom:24px}
.lede{font-size:20px;line-height:1.5;margin:0 0 32px;color:color-mix(in srgb,var(--color-text) 78%,transparent)}
.actions{display:flex;gap:16px;flex-wrap:wrap}
.art{aspect-ratio:4/3;border-radius:var(--radius-lg);background:linear-gradient(135deg,var(--color-primary),var(--color-accent))}
.features{padding:96px 120px;background:color-mix(in srgb,var(--color-neutral) 6%,var(--color-background))}
.features h2{font-size:44px;line-height:1.1;margin-bottom:48px;max-width:720px}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.cards article{padding:32px;border-radius:var(--radius);background:var(--color-background);box-shadow:0 1px 0 color-mix(in srgb,var(--color-text) 8%,transparent),0 12px 32px -16px color-mix(in srgb,var(--color-text) 30%,transparent)}
.cards h3{font-size:24px;margin:20px 0 8px}
.cards p{margin:0;color:color-mix(in srgb,var(--color-text) 78%,transparent)}
.icon{display:block;width:48px;height:48px;border-radius:var(--radius);background:color-mix(in srgb,var(--color-primary) 16%,transparent)}
.band{display:flex;align-items:center;justify-content:space-between;gap:32px;margin:96px 120px;padding:56px 64px;border-radius:var(--radius-lg);background:var(--color-primary);color:var(--color-on-primary)}
.band h2{font-size:40px;line-height:1.1}
.foot{display:flex;align-items:center;gap:48px;padding:48px 120px;border-top:1px solid color-mix(in srgb,var(--color-text) 10%,transparent)}
.foot nav{display:flex;gap:24px;margin-right:auto}
.foot small{font-size:14px;color:color-mix(in srgb,var(--color-text) 70%,transparent)}
@media (max-width:600px){
.top{padding:16px 20px;gap:16px}
.top nav,.top .btn{display:none}
.menu{display:grid}
.hero{grid-template-columns:1fr;padding:48px 20px;gap:32px}
.hero h1{font-size:40px}
.lede{font-size:18px}
.features{padding:56px 20px}
.features h2{font-size:32px;margin-bottom:32px}
.cards{grid-template-columns:1fr}
.band{flex-direction:column;align-items:flex-start;margin:56px 20px;padding:40px 24px}
.band h2{font-size:30px}
.foot{flex-direction:column;align-items:flex-start;gap:24px;padding:40px 20px}
.foot nav{flex-wrap:wrap}
}`;

/** The sections a new sheet starts with, from the brand: "brand", or nothing for "blank". */
export function designStarter(start: "brand" | "blank", o: { brand: string; hasLogo: boolean; now: string }): DesignSection[] {
  if (start === "blank") return [{ id: "s1", name: "Pages", frames: [] }];
  const b = esc(o.brand || "Your brand");
  const brand = o.hasLogo ? `<a class="brand" href="#"><img src="yarn:logo" alt="${b}"></a>` : `<a class="brand" href="#">${b}</a>`;
  const header = `<header class="top">\n  ${brand}\n  <nav aria-label="Main"><a href="#">Product</a><a href="#">Pricing</a><a href="#">About</a><a href="#">Contact</a></nav>\n  <a class="btn primary" href="#">Get started</a>\n  <span class="menu" role="img" aria-label="Menu"><i></i><i></i><i></i></span>\n</header>`;
  const footer = `<footer class="foot">\n  ${brand.replace('class="brand" href="#"', 'class="brand" href="#" aria-label="Home"')}\n  <nav aria-label="Footer"><a href="#">Product</a><a href="#">Pricing</a><a href="#">About</a><a href="#">Contact</a><a href="#">Privacy</a></nav>\n  <small>&copy; ${o.now.slice(0, 4)} ${b}</small>\n</footer>`;
  const card = (h: string, p: string) => `<article><span class="icon" aria-hidden="true"></span><h3>${h}</h3><p>${p}</p></article>`;
  const home = `${header}
<main>
  <section class="hero">
    <div>
      <p class="eyebrow">New</p>
      <h1>A headline that says what ${b} does</h1>
      <p class="lede">One or two sentences on who it is for and what they get. Plain words, no jargon.</p>
      <div class="actions"><a class="btn primary" href="#">Get started</a><a class="btn ghost" href="#">See how it works</a></div>
    </div>
    <div class="art" role="img" aria-label="A picture of the product"></div>
  </section>
  <section class="features">
    <h2>Why people choose ${b}</h2>
    <div class="cards">
      ${card("The first reason", "What it does for them, in a sentence they would say themselves.")}
      ${card("The second reason", "A number, a promise or a result, said simply.")}
      ${card("The third reason", "What makes it different from the others they could choose.")}
    </div>
  </section>
  <section class="band"><h2>Ready when you are</h2><a class="btn on" href="#">Start today</a></section>
</main>
${footer}`;
  const frame = (id: string, name: string, width: number, html: string, css: string, note?: string): DesignFrame => ({ id, name, width, html, css, ...(note ? { note } : {}), updatedAt: o.now });
  const swatchChip = (role: string, label: string) => `<figure><div class="chip" style="background:var(--color-${role})"></div><figcaption><b>${label}</b><code>--color-${role}</code></figcaption></figure>`;
  const pair = (role: string, label: string) => `<div class="pair" style="background:var(--color-${role});color:var(--color-on-${role})"><b>Aa</b> Text on ${label.toLowerCase()}</div>`;
  return [
    {
      id: "s1", name: "Foundations", note: "The brand as the site uses it. The colours and fonts follow the Swatch.",
      frames: [
        frame("f1", "Colours", 1440,
          `<main class="sheet">\n  <p class="eyebrow">Foundations</p>\n  <h1 class="title">Colours</h1>\n  <p class="lede">Every colour in this design comes from the Swatch. Change the Swatch, and the whole design follows.</p>\n  <div class="grid">\n    ${[["primary", "Primary"], ["secondary", "Secondary"], ["accent", "Accent"], ["neutral", "Neutral"], ["background", "Background"], ["text", "Text"]].map(([r, l]) => swatchChip(r, l)).join("\n    ")}\n  </div>\n  <div class="pairs">\n    ${[["primary", "Primary"], ["secondary", "Secondary"], ["accent", "Accent"], ["neutral", "Neutral"]].map(([r, l]) => pair(r, l)).join("\n    ")}\n  </div>\n</main>`,
          `${SHEET_CSS}\n.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:24px}\nfigure{margin:0}\n.chip{height:160px;border-radius:var(--radius);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--color-text) 12%,transparent)}\nfigcaption{display:grid;gap:4px;margin-top:12px;font-size:15px}\n.pairs{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;margin-top:48px}\n.pair{padding:28px 24px;border-radius:var(--radius);font-size:16px}\n.pair b{font:700 32px/1 var(--font-display);margin-right:8px}`),
        frame("f2", "Type", 1440,
          `<main class="sheet">\n  <p class="eyebrow">Foundations</p>\n  <h1 class="title">Type</h1>\n  <p class="lede">Headings in the display font, everything else in the body font.</p>\n  <div class="row"><span>Display 72</span><p class="d1">${b}, said big</p></div>\n  <div class="row"><span>Heading 48</span><p class="h2">A heading for a section</p></div>\n  <div class="row"><span>Heading 32</span><p class="h3">A heading for a card</p></div>\n  <div class="row"><span>Body 18</span><p class="b">Body text for the paragraphs that explain. It reads easily at length, with room between the lines.</p></div>\n  <div class="row"><span>Small 14</span><p class="s">Small print, captions and labels.</p></div>\n  <div class="row"><span>Mono 14</span><p class="m">Numbers and code: 1,240 orders</p></div>\n</main>`,
          `${SHEET_CSS}\n.row{display:grid;grid-template-columns:200px 1fr;align-items:baseline;gap:32px;padding:28px 0;border-top:1px solid color-mix(in srgb,var(--color-text) 10%,transparent)}\n.row span{font:500 14px/1 var(--font-mono);color:color-mix(in srgb,var(--color-text) 65%,transparent)}\n.row p{margin:0}\n.d1{font:700 72px/1.05 var(--font-display);letter-spacing:-.02em}\n.h2{font:700 48px/1.1 var(--font-display);letter-spacing:-.02em}\n.h3{font:600 32px/1.2 var(--font-display)}\n.b{font-size:18px;line-height:1.6;max-width:720px}\n.s{font-size:14px}\n.m{font:14px/1.4 var(--font-mono)}`),
        frame("f3", "Buttons and fields", 1440,
          `<main class="sheet">\n  <p class="eyebrow">Foundations</p>\n  <h1 class="title">Buttons and fields</h1>\n  <p class="lede">One main action on a screen, in the primary colour. The rest are quieter.</p>\n  <div class="actions"><a class="btn primary" href="#">Get started</a><a class="btn secondary" href="#">Learn more</a><a class="btn ghost" href="#">Contact us</a></div>\n  <div class="split">\n    <form class="form" action="#">\n      <label>Email<input type="email" placeholder="you@example.com"></label>\n      <label>Message<textarea rows="3" placeholder="How can we help?"></textarea></label>\n      <button class="btn primary" type="button">Send</button>\n    </form>\n    <article class="card"><div class="pic" role="img" aria-label="A picture"></div><h3>A card</h3><p>A short line on what this is, and why it matters.</p><a href="#">Read more</a></article>\n  </div>\n</main>`,
          `${SHEET_CSS}\n${SITE_CSS.split("\n").filter((l) => l.startsWith(".btn") || l.startsWith("h1,h2,h3") || l.startsWith(".actions")).join("\n")}\n.split{display:grid;grid-template-columns:1fr 1fr;gap:48px;margin-top:56px;align-items:start}\n.form{display:grid;gap:20px}\nlabel{display:grid;gap:8px;font-weight:600;font-size:14px}\ninput,textarea{font:16px/1.4 var(--font-body);padding:12px 14px;border-radius:var(--radius-sm);border:1.5px solid color-mix(in srgb,var(--color-text) 25%,transparent);background:var(--color-background);color:var(--color-text)}\n.form .btn{justify-self:start;border:0}\n.card{border-radius:var(--radius);overflow:hidden;box-shadow:0 1px 0 color-mix(in srgb,var(--color-text) 8%,transparent),0 12px 32px -16px color-mix(in srgb,var(--color-text) 30%,transparent)}\n.pic{aspect-ratio:16/9;background:linear-gradient(135deg,var(--color-accent),var(--color-primary))}\n.card h3{font-size:24px;margin:24px 24px 8px}\n.card p{margin:0 24px 16px;color:color-mix(in srgb,var(--color-text) 78%,transparent)}\n.card a{display:inline-block;margin:0 24px 24px;color:var(--color-primary);font-weight:600}`),
      ],
    },
    {
      id: "s2", name: "Components", note: "Pieces every page shares.",
      frames: [
        frame("f4", "Header", 1440, header, SITE_CSS),
        frame("f5", "Header, mobile", 390, header, SITE_CSS),
        frame("f6", "Footer", 1440, footer, SITE_CSS),
      ],
    },
    {
      id: "s3", name: "Pages", note: "Whole pages, on a computer and on a phone. Replace the words with the business's own.",
      frames: [
        frame("f7", "Home", 1440, home, SITE_CSS),
        frame("f8", "Home, mobile", 390, home, SITE_CSS),
      ],
    },
  ];
}
