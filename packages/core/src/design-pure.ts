// Design sheets: a whole site's UI on one board, like a Figma file, in labelled sections
// (Foundations, Components, Pages) of frames. A frame is a screen or a piece of one, written
// as HTML and CSS at a device's width, and drawn with the project's Swatch through CSS
// variables, so a change to the brand restyles every frame at once. A section can be placed
// anywhere on the board; one not placed stands in a column under those that are.
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

/** The project's own things a sheet can hold beside its frames, drawn as they are now. */
export type PieceKind = "pattern" | "yarn" | "part";
export const PIECE_KINDS: PieceKind[] = ["pattern", "yarn", "part"];
export const PIECE_NAMES: Record<PieceKind, string> = { pattern: "Pattern", yarn: "Yarn", part: "Part" };
/** Which of the project's things a piece is. */
export interface DesignPiece { kind: PieceKind; id: string }
/** A piece as it is now: its own size, and whether it is still in the project. */
export interface PieceNow extends DesignPiece { w: number; h: number; gone?: boolean }

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
  /**
   * One of the project's patterns, Yarn pictures or parts in place of code: the thing itself,
   * drawn as it is now, so a change to it shows here. Its html and css are empty, it is drawn
   * `width` wide, and its height keeps the thing's shape. Its name is the thing's.
   */
  piece?: DesignPiece;
  /** What it is for, or what to do next with it. */
  note?: string;
  /** Who changed it last. Absent for a frame the sheet started with. */
  by?: "human" | "model";
  updatedAt: string;
}
export interface DesignSection {
  id: string;
  name: string;
  note?: string;
  /** Where its top left corner is on the board, in the frames' pixels. Absent, it stands in the column. */
  x?: number;
  y?: number;
  /** How wide it is: its frames wrap into rows to fit. Absent, they stand in one row. */
  width?: number;
  frames: DesignFrame[];
}
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

// A sheet takes as many sections and frames as it is given: the board loads only what is seen.
/**
 * A frame without its code, as the board lays it out and loads it: `code` names its code (a
 * hash of it), `chars` is how long it is, and `measured` is how tall it was last drawn, when it
 * is as tall as what is in it and nothing has changed since.
 */
export type FrameMeta = Omit<DesignFrame, "html" | "css" | "piece"> & { code: string; chars: number; measured?: number; piece?: PieceNow };
export type SectionMeta = Omit<DesignSection, "frames"> & { frames: FrameMeta[] };
/** A sheet without its frames' code: what the board needs to lay it out, a small part of the whole. */
export interface DesignMeta extends Omit<Design, "sections"> {
  sections: SectionMeta[];
  /** What names how the sheet's pieces look now: it changes when one of their things does, though the sheet has not. Empty without pieces. */
  pieces?: string;
}
export interface FrameCode { code: string; html: string; css: string }
/** A frame as drawn: its code at its size. A height measured for it is kept under this. */
export const frameRev = (f: Pick<FrameMeta, "code" | "width" | "height">) => `${f.code}-${f.width}${f.height ? `x${f.height}` : ""}`;

export const DESIGN_LIMITS = { html: 200_000, css: 100_000, minWidth: 240, maxWidth: 3840, minHeight: 160, maxHeight: 20_000, far: 1_000_000 };

/** The device a width is, if it is one of them. */
export function deviceOf(width: number): DesignDevice | null {
  return (Object.keys(DESIGN_DEVICES) as DesignDevice[]).find((d) => DESIGN_DEVICES[d].width === width) ?? null;
}
/** "Desktop 1440", "Mobile 390", or "1200 wide"; a piece by what it is and its own size, "Pattern 1080 x 1350". */
export function frameSize(f: Pick<DesignFrame, "width" | "height"> & { piece?: DesignPiece & { w?: number; h?: number } }): string {
  if (f.piece) return `${PIECE_NAMES[f.piece.kind] ?? "Piece"}${f.piece.w && f.piece.h ? ` ${f.piece.w} x ${f.piece.h}` : ""}`;
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
  | { op: "addSection"; name: string; note?: string; at?: number; x?: number; y?: number; width?: number }
  | { op: "updateSection"; section: string; name?: string; note?: string; width?: number | null }
  | { op: "moveSection"; section: string; to: number }
  /** To a place on the board, its top left corner at x, y; null for both puts it back in the column. */
  | { op: "placeSection"; section: string; x: number | null; y: number | null }
  | { op: "removeSection"; section: string }
  | { op: "setFrame"; section: string; frameId?: string; name?: string; width?: number; height?: number | null; html?: string; css?: string; note?: string; at?: number }
  /**
   * One of the project's patterns, Yarn pictures or videos, or parts, onto the sheet as it is. The
   * store fills in its name and its size from the thing itself; `width` draws it that wide instead.
   */
  | { op: "addPiece"; section: string; kind: PieceKind; id: string; name?: string; width?: number; height?: number; note?: string; at?: number }
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

/** A place on the board, in whole pixels. */
function cleanAt(v: unknown, what: string): number {
  const n = Math.round(Number(v));
  if (v === null || v === undefined || v === "" || !Number.isFinite(n) || Math.abs(n) > DESIGN_LIMITS.far) throw new DesignProblem(`Give the section's ${what} on the board, in pixels: a number from -${DESIGN_LIMITS.far.toLocaleString("en")} to ${DESIGN_LIMITS.far.toLocaleString("en")}.`);
  return n;
}
/** A section's width: its frames wrap into rows to fit it. */
function cleanSectionWidth(v: unknown): number {
  const n = Math.round(Number(v));
  if (!(n >= 400 && n <= 100_000)) throw new DesignProblem("A section is 400 to 100,000 pixels wide. Leave the width out for its frames in one row.");
  return n;
}
/** A piece's size on the sheet: as wide as a frame can be, and as tall as its shape makes it. */
function cleanPieceSize(width: unknown, height: unknown): { width: number; height: number } {
  const w = Math.round(Number(width)), h = Math.round(Number(height));
  if (!(w >= 40 && w <= DESIGN_LIMITS.maxWidth)) throw new DesignProblem(`A piece is drawn 40 to ${DESIGN_LIMITS.maxWidth} pixels wide.`);
  if (!(h >= 1 && h <= DESIGN_LIMITS.maxHeight)) throw new DesignProblem(`At that width the piece would be ${h} pixels tall. Draw it narrower.`);
  return { width: w, height: h };
}
function cleanPiece(kind: unknown, id: unknown): DesignPiece {
  if (!PIECE_KINDS.includes(kind as PieceKind)) throw new DesignProblem(`A piece is a pattern, yarn or a part, not "${String(kind)}".`);
  const i = String(id ?? "").trim();
  if (!i || i.length > 64) throw new DesignProblem(`Say which ${kind === "yarn" ? "Yarn file" : kind} to add, by its id.`);
  return { kind: kind as PieceKind, id: i };
}
/** What a piece is, in words for the one who asked to change its code. */
const pieceWords = (f: DesignFrame) => `${f.name} (${f.id}) is ${f.piece!.kind === "yarn" ? "a file from Yarn" : `a ${f.piece!.kind}`} placed on the sheet, not code`;

function place2(s: DesignSection, x: unknown, y: unknown) {
  if (x === null && y === null) { delete s.x; delete s.y; return; }
  s.x = cleanAt(x, "x"); s.y = cleanAt(y, "y");
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
  for (const o of ops) {
    switch (o.op) {
      case "rename": name = cleanName(o.name, "design"); break;
      case "addSection": {
        const s: DesignSection = { id: nextId(sections, "s"), name: cleanName(o.name, "section"), frames: [] };
        const note = cleanNote(o.note); if (note) s.note = note;
        if (o.x !== undefined || o.y !== undefined) place2(s, o.x, o.y);
        if (o.width != null) s.width = cleanSectionWidth(o.width);
        place(sections, s, o.at); made.sections.push(s.id); break;
      }
      case "updateSection": {
        const s = findSection(sections, o.section);
        if (o.name !== undefined) s.name = cleanName(o.name, "section");
        if (o.note !== undefined) { const note = cleanNote(o.note); if (note) s.note = note; else delete s.note; }
        if (o.width === null) delete s.width; else if (o.width !== undefined) s.width = cleanSectionWidth(o.width);
        break;
      }
      case "moveSection": { const s = findSection(sections, o.section); sections.splice(sections.indexOf(s), 1); place(sections, s, o.to); break; }
      case "placeSection": { place2(findSection(sections, o.section), o.x, o.y); break; }
      case "removeSection": { const s = findSection(sections, o.section); sections.splice(sections.indexOf(s), 1); break; }
      case "setFrame": {
        const s = findSection(sections, o.section);
        const found = o.frameId ? findFrame(sections, o.frameId) : null;
        // A piece is the thing itself: it has no code to change, and keeps the thing's shape.
        if (found?.frame.piece) {
          const f = found.frame;
          if (o.html !== undefined || o.css !== undefined) {
            throw new DesignProblem(`${pieceWords(f)}: change the ${f.piece!.kind === "pattern" ? "pattern itself (describe_pattern, then update_stitch or apply_batch)" : f.piece!.kind === "part" ? "part itself (edit_part)" : "file in Yarn"}, and the sheet shows it as it is.`);
          }
          if (o.width !== undefined) { const size = cleanPieceSize(o.width, ((f.height ?? f.width) * Number(o.width)) / f.width); f.width = size.width; f.height = size.height; }
          if (o.note !== undefined) f.note = cleanNote(o.note);
          f.by = by; f.updatedAt = now;
          if (found.section !== s) { found.section.frames.splice(found.index, 1); place(s.frames, f, o.at); }
          break;
        }
        const size = cleanSize(o.width, o.height);
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
          const f: DesignFrame = { id: nextId(sections, "f"), name: cleanName(o.name, "frame"), width: size.width ?? DESIGN_DEVICES.desktop.width, html, css, by, updatedAt: now };
          if (size.height) f.height = size.height;
          const note = cleanNote(o.note); if (note) f.note = note;
          place(s.frames, f, o.at); made.frames.push(f.id);
          if (problems.length) lint[f.id] = problems;
        }
        break;
      }
      case "addPiece": {
        const s = findSection(sections, o.section);
        const piece = cleanPiece(o.kind, o.id);
        const size = cleanPieceSize(o.width, o.height);
        const f: DesignFrame = { id: nextId(sections, "f"), name: cleanName(o.name, "piece"), width: size.width, height: size.height, html: "", css: "", piece, by, updatedAt: now };
        const note = cleanNote(o.note); if (note) f.note = note;
        place(s.frames, f, o.at); made.frames.push(f.id);
        break;
      }
      case "moveFrame": {
        const { section, frame, index } = findFrame(sections, o.frameId);
        const to = findSection(sections, o.section);
        section.frames.splice(index, 1); place(to.frames, frame, o.at); break;
      }
      case "duplicateFrame": {
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

// ── the board ─────────────────────────────────────────────────────────────────
// Where everything is, in the frames' own pixels: the board in the studio, the sheet drawn as
// a picture and the model's view of it all lay it out here, so they agree. A section placed
// on the board is where it was put; the others stand in a column under those, in order.

/** The board's spacing, in the frames' pixels. Sections snap to `grid`. */
export const BOARD = { grid: 40, pad: 80, gap: 80, rowGap: 120, stack: 320, emptyW: 560, emptyH: 320 } as const;

export interface LaidFrame { id: string; x: number; y: number; w: number; h: number }
export interface LaidSection { id: string; x: number; y: number; w: number; h: number; placed: boolean; frames: LaidFrame[] }
export interface BoardLayout { sections: LaidSection[]; x: number; y: number; w: number; h: number }
type LayoutSection = Pick<DesignSection, "id" | "x" | "y" | "width"> & { frames: Pick<DesignFrame, "id" | "width" | "height">[] };

/** How tall a frame is drawn before it has been measured: a desktop screen's shape. */
export const guessHeight = (f: Pick<DesignFrame, "width" | "height">) => f.height ?? Math.round(f.width * 0.625);

/** A section's frames in rows, from its top left corner. */
function laySection(s: LayoutSection, heightOf: (f: Pick<DesignFrame, "id" | "width" | "height">) => number): { w: number; h: number; frames: LaidFrame[] } {
  const { pad, gap, rowGap } = BOARD;
  if (!s.frames.length) return { w: Math.max(s.width ?? 0, BOARD.emptyW), h: BOARD.emptyH, frames: [] };
  const widest = Math.max(...s.frames.map((f) => f.width));
  const room = s.width ? Math.max(s.width - 2 * pad, widest) : Infinity;
  const frames: LaidFrame[] = [];
  let x = 0, y = 0, rowH = 0, right = 0;
  for (const f of s.frames) {
    if (x > 0 && x + f.width > room) { y += rowH + rowGap; x = 0; rowH = 0; }
    const h = f.height ?? heightOf(f);
    frames.push({ id: f.id, x: pad + x, y: pad + y, w: f.width, h });
    right = Math.max(right, x + f.width);
    x += f.width + gap;
    rowH = Math.max(rowH, h);
  }
  return { w: Math.max(s.width ?? 0, right + 2 * pad), h: y + rowH + 2 * pad, frames };
}

/**
 * The whole board: each section and frame where it is drawn, and the box round them all.
 *
 * Placed sections never overlap. Taken from the top (`first`, one just put down, before the
 * rest), a section that would overlap one already laid goes under it instead, so one that grows,
 * by wrapping or by more frames, pushes those below it down rather than covering them. One being
 * dragged (`float`) is drawn where it is, over the others, and moves none of them until it is put down.
 */
export function layoutDesign(sections: LayoutSection[], heightOf: (f: Pick<DesignFrame, "id" | "width" | "height">) => number = guessHeight, { first, float }: { first?: string; float?: string } = {}): BoardLayout {
  const laid = sections.map((s) => ({ s, ...laySection(s, heightOf) }));
  const isPlaced = (l: (typeof laid)[number]) => l.s.x != null && l.s.y != null;
  const order = laid.filter((l) => isPlaced(l) && l.s.id !== float).sort((a, b) => (a.s.id === first ? -1 : b.s.id === first ? 1 : a.s.y! - b.s.y! || a.s.x! - b.s.x!));
  const put = new Map<string, { x: number; y: number }>();
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  for (const l of order) {
    const x = l.s.x!;
    let y = l.s.y!;
    for (let hit = true; hit;) {
      hit = false;
      for (const b of boxes) if (x < b.x + b.w && b.x < x + l.w && y < b.y + b.h && b.y < y + l.h) { y = b.y + b.h + BOARD.stack; hit = true; }
    }
    put.set(l.s.id, { x, y });
    boxes.push({ x, y, w: l.w, h: l.h });
  }
  const floating = laid.find((l) => l.s.id === float && isPlaced(l));
  if (floating) put.set(floating.s.id, { x: floating.s.x!, y: floating.s.y! });
  let y = boxes.length ? Math.max(...boxes.map((b) => b.y + b.h)) + BOARD.stack : 0;
  const out: LaidSection[] = laid.map((l) => {
    const p = put.get(l.s.id);
    const at = p ? { ...p, placed: true } : { x: 0, y, placed: false };
    if (!at.placed) y += l.h + BOARD.stack;
    return { id: l.s.id, x: at.x, y: at.y, w: l.w, h: l.h, placed: at.placed, frames: l.frames.map((f) => ({ ...f, x: f.x + at.x, y: f.y + at.y })) };
  });
  if (!out.length) return { sections: [], x: 0, y: 0, w: 0, h: 0 };
  const x0 = Math.min(...out.map((s) => s.x)), y0 = Math.min(...out.map((s) => s.y));
  const x1 = Math.max(...out.map((s) => s.x + s.w)), y1 = Math.max(...out.map((s) => s.y + s.h));
  return { sections: out, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The nearest point on the grid. */
export const snapToGrid = (v: number, grid: number = BOARD.grid) => Math.round(v / grid) * grid;

/**
 * Where a frame dropped at a point of the board goes in a section: the index among its frames,
 * not counting the frame being moved. The row nearest the point, then the gap nearest it; in a
 * row of one frame, before or after it by which way the point is furthest off its middle.
 */
export function dropIndex(section: LaidSection, frameId: string | null, bx: number, by: number): number {
  const others = section.frames.filter((f) => f.id !== frameId);
  if (!others.length) return 0;
  // Rows: frames that share a top.
  const rows: LaidFrame[][] = [];
  for (const f of others) { const r = rows.find((row) => row[0].y === f.y); if (r) r.push(f); else rows.push([f]); }
  const dist = (r: LaidFrame[]) => { const top = r[0].y, bottom = Math.max(...r.map((f) => f.y + f.h)); return by < top ? top - by : by > bottom ? by - bottom : 0; };
  const row = rows.reduce((a, b) => (dist(b) < dist(a) ? b : a));
  // A frame alone in its row, as in a section wrapped to one frame a row: before it or after it by
  // the way the point is furthest from its middle, for its size, across or down.
  if (row.length === 1) {
    const f = row[0], dx = (bx - (f.x + f.w / 2)) / f.w, dy = (by - (f.y + f.h / 2)) / f.h;
    return others.indexOf(f) + ((Math.abs(dy) > Math.abs(dx) ? dy : dx) > 0 ? 1 : 0);
  }
  const before = row.findIndex((f) => bx < f.x + f.w / 2);
  const at = before === -1 ? row[row.length - 1] : row[before];
  return others.indexOf(at) + (before === -1 ? 1 : 0);
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
