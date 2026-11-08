// Drawing: SVG a model writes, kept as Yarn. A mascot in a new pose, an icon set for a website,
// a badge. The model writes the markup; this checks it is an SVG that draws something, cleans
// it as an upload is cleaned, keeps what it was asked and drawn from (YarnMeta.made), and draws
// it back as a picture, on light and dark and at icon sizes, so the model sees what it made
// before anyone else does. A drawing can be drawn again in place: it keeps its id, so every
// pattern that uses it shows the new one.
//
// And a sheet: several pictures side by side at one size, on light and dark, named, to see
// that a set belongs together (the same stroke, the same weight, the same character).

import sharp, { type OverlayOptions } from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LIBRARY_ID, type MadeBy, type Yarn } from "./types.ts";
import { ValidationError, type Store } from "./store.ts";
import { sanitiseSvg } from "./svg.ts";
import { getYarn, importYarn, listYarn, updateYarn, uploadTempPath, yarnPath, type ImportResult } from "./yarn.ts";

const MAX_SVG = 400 * 1024;
const LIGHT = "#ffffff", DARK = "#1c1b1a";

export interface DrawResult extends ImportResult {
  /** The drawing, drawn: on light and dark, and at icon sizes when it is square. PNG. */
  preview: Buffer;
  /** The colours it uses, as written. */
  colors: string[];
  /** What to look at again: text that needs a font, a picture inside, nothing much drawn. */
  notes: string[];
}

const xmlEscape = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

/** The root <svg> tag's attributes. */
function rootOf(svg: string): { tag: string; attrs: Record<string, string> } {
  const m = /<svg\b([^>]*)>/i.exec(svg);
  if (!m) throw new ValidationError("That is not an SVG: it has no <svg> tag. Send the whole markup, from <svg to </svg>.");
  const attrs: Record<string, string> = {};
  for (const a of m[1].matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[a[1].toLowerCase()] = a[3] ?? a[4] ?? "";
  return { tag: m[0], attrs };
}

const num = (v: string | undefined) => { const n = parseFloat(v ?? ""); return Number.isFinite(n) && n > 0 && !/%$/.test(v ?? "") ? n : undefined; };

/**
 * The markup made ready: an XML namespace, and a viewBox (from its width and height when it
 * has none), so it scales. Its size: the viewBox's.
 */
export function prepareSvg(raw: string): { svg: string; w: number; h: number; notes: string[] } {
  let svg = String(raw ?? "").trim().replace(/^```(?:svg|xml)?\s*|\s*```$/g, "");
  if (!svg) throw new ValidationError("Send the SVG's markup, from <svg to </svg>.");
  if (Buffer.byteLength(svg) > MAX_SVG) throw new ValidationError(`That SVG is ${Math.round(Buffer.byteLength(svg) / 1024)}KB. Keep a drawing under ${MAX_SVG / 1024}KB: fewer points, shapes used again with <use>, no pictures inside.`);
  if (!/<svg\b/i.test(svg)) rootOf(svg);
  if (!/<\/svg\s*>\s*$/i.test(svg)) throw new ValidationError("The SVG does not end with </svg>: it may have been cut off. Send all of it.");
  const notes: string[] = [];
  const { tag, attrs } = rootOf(svg);
  let next = tag;
  if (!attrs.xmlns) next = next.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (/xlink:href/.test(svg) && !attrs["xmlns:xlink"]) next = next.replace(/^<svg\b/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  let w: number, h: number;
  const vb = (attrs.viewbox ?? "").trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) { w = vb[2]; h = vb[3]; }
  else {
    const W = num(attrs.width), H = num(attrs.height);
    if (!W || !H) throw new ValidationError('Give the <svg> a viewBox, like viewBox="0 0 24 24" for an icon or viewBox="0 0 512 512" for a drawing, so it can be drawn at any size.');
    w = W; h = H;
    next = next.replace(/^<svg\b/i, `<svg viewBox="0 0 ${W} ${H}"`);
    notes.push(`It had no viewBox, so it was given viewBox="0 0 ${W} ${H}" from its width and height.`);
  }
  if (w / h > 20 || h / w > 20) throw new ValidationError(`Its viewBox is ${w} by ${h}: far too thin to be a drawing. Check the four numbers: x, y, width, height.`);
  svg = svg.replace(tag, next);
  if (/<text\b/i.test(svg)) notes.push("It has <text>, which is drawn in whatever font the viewer has. Turn the words into paths, or leave them out and set them in the pattern.");
  if (/<image\b/i.test(svg)) notes.push("It has a picture inside it (<image>), so it will not stay sharp when it is made bigger.");
  return { svg, w, h, notes };
}

/** The colours written in it: fills, strokes and stops, as hex where they are hex. */
export function svgColors(svg: string): string[] {
  const out = new Set<string>();
  for (const m of svg.matchAll(/\b(?:fill|stroke|stop-color|color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|[a-z]+)/gi)) {
    let c = m[1].toLowerCase();
    if (["none", "transparent", "inherit", "currentcolor", "url", "context"].includes(c)) continue;
    if (/^#[0-9a-f]{3}$/.test(c)) c = "#" + [...c.slice(1)].map((x) => x + x).join("");
    out.add(c);
  }
  return [...out].slice(0, 16);
}

/** Draw an SVG to a PNG that fits `size`, sharp at any scale. */
async function drawSvg(svg: string | Buffer, w: number, h: number, size: number): Promise<Buffer> {
  const density = Math.max(1, Math.min(4000, (72 * size) / Math.max(w, h)));
  return sharp(Buffer.isBuffer(svg) ? svg : Buffer.from(svg), { density }).resize(size, size, { fit: "inside" }).png().toBuffer();
}

/** How much of it is drawn: the share of its picture that is not see-through. */
async function inked(png: Buffer): Promise<number> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 16) n++;
  return n / (info.width * info.height);
}

/** The drawing on light beside it on dark, and, for a square one, at 16 to 64 pixels below. */
async function previewOf(svg: string, w: number, h: number): Promise<Buffer> {
  const S = 440, pad = 20;
  const big = await drawSvg(svg, w, h, S);
  const bm = await sharp(big).metadata();
  const at = (x: number) => ({ input: big, left: x + pad + Math.round((S - bm.width!) / 2), top: pad + Math.round((S - bm.height!) / 2) });
  const square = Math.abs(w / h - 1) < 0.15;
  const sizes = square ? [16, 24, 32, 48, 64] : [];
  const W = (S + pad * 2) * 2, H = S + pad * 2 + (square ? 104 : 0);
  const layers: OverlayOptions[] = [
    { input: { create: { width: S + pad * 2, height: S + pad * 2, channels: 4, background: DARK } }, left: S + pad * 2, top: 0 },
    at(0), at(S + pad * 2),
  ];
  let x = pad;
  for (const s of sizes) {
    const small = await drawSvg(svg, w, h, s);
    const m = await sharp(small).metadata();
    layers.push({ input: small, left: x + Math.round((s - m.width!) / 2), top: S + pad * 2 + 16 + Math.round((64 - m.height!) / 2) });
    layers.push({ input: small, left: W / 2 + x + Math.round((s - m.width!) / 2), top: S + pad * 2 + 16 + Math.round((64 - m.height!) / 2) });
    x += s + 28;
  }
  if (square) layers.unshift({ input: { create: { width: W / 2, height: 104, channels: 4, background: DARK } }, left: W / 2, top: S + pad * 2 });
  return sharp({ create: { width: W, height: H, channels: 4, background: LIGHT } }).composite(layers).png().toBuffer();
}

export interface DrawInput {
  svg: string;
  name?: string;
  tags?: string[];
  folder?: string;
  /** A drawing made before, by id, to draw again in place. */
  replaceId?: string;
  /** Files it was drawn from, like the mascot's reference picture, by id. */
  from?: string[];
  /** What was asked for. */
  prompt?: string;
  actor?: "human" | "model";
}

/** Keep an SVG a model drew as Yarn in `projectId` (or the Library), and draw it back. */
export async function saveDrawing(store: Store, projectId: string, input: DrawInput): Promise<DrawResult> {
  store.getProject(projectId);
  const { svg: ready, w, h, notes } = prepareSvg(input.svg);
  const clean = sanitiseSvg(ready);
  if (clean.changed) notes.push("Scripts, links out and outside pictures were taken out of it.");
  const svg = clean.svg;

  let preview: Buffer;
  try { preview = await previewOf(svg, w, h); }
  catch (e) { throw new ValidationError(`That SVG could not be drawn: ${String((e as Error).message).replace(/^Input buffer has corrupt header: /, "").slice(0, 200)}. Check every tag is closed and every attribute is quoted.`); }
  const share = await inked(await drawSvg(svg, w, h, 128));
  if (share === 0) throw new ValidationError("It draws nothing that shows. Check the shapes sit inside the viewBox, and their fill or stroke is not none.");
  if (share < 0.01) notes.push("It draws very little: most of it is see-through. Check the shapes fill the viewBox.");

  const from = (input.from ?? []).slice(0, 8).map((id) => { const y = getYarn(store, id); return { id: y.id, name: y.name }; });
  let replacing: Yarn | undefined;
  if (input.replaceId) {
    replacing = getYarn(store, input.replaceId);
    if (replacing.projectId !== projectId) throw new ValidationError(`${replacing.name} is not in this project's Yarn, so it is not drawn again here.`);
    if (replacing.deletedAt) throw new ValidationError(`${replacing.name} was deleted. Draw a new one instead.`);
    if (replacing.meta.made?.by !== "model" || replacing.mime !== "image/svg+xml") throw new ValidationError(`${replacing.name} was not drawn by a model, so it is not drawn over: it may be the person's own. Draw a new one beside it.`);
  }
  const made: MadeBy = { by: "model", prompt: input.prompt?.trim().slice(0, 2000) || replacing?.meta.made?.prompt, from: from.length ? from : replacing?.meta.made?.from, at: new Date().toISOString() };
  if (!made.prompt) delete made.prompt;
  if (!made.from) delete made.from;

  const tmp = uploadTempPath(store, projectId);
  await mkdir(join(tmp, ".."), { recursive: true });
  await writeFile(tmp, svg, "utf8");
  const name = (input.name?.trim() || replacing?.name || "Drawing").slice(0, 100);
  const r = await importYarn(store, projectId, tmp, `${name}.svg`, {
    name, folder: input.folder, actor: input.actor ?? "model", made,
    tags: replacing ? undefined : [...(input.tags ?? []), "drawn"],
    replaceId: replacing?.id,
  });
  if (replacing) {
    store.write(() => store.logRow(projectId, input.actor ?? "model", "yarn.changed", replacing!.name, { kind: "image", drawn: true }));
    if (input.name?.trim() && input.name.trim() !== replacing.name) r.yarn = updateYarn(store, replacing.id, { name: input.name.trim() });
  }
  return { ...r, preview, colors: svgColors(svg), notes };
}

export interface SheetInput { ids?: string[]; folder?: string; tag?: string; size?: number; background?: "both" | "light" | "dark" }

/** Pictures side by side at one size, named, on light and dark: to see a set belongs together. */
export async function drawSheet(store: Store, projectId: string, o: SheetInput): Promise<{ data: Buffer; mime: string; items: { id: string; name: string }[] }> {
  let items: Yarn[];
  if (o.ids?.length) items = o.ids.map((id) => getYarn(store, id)).filter((y) => y.projectId === projectId || y.projectId === LIBRARY_ID);
  else if (o.folder !== undefined || o.tag) items = listYarn(store, projectId, { kind: "image", folder: o.folder, tag: o.tag, library: o.folder === undefined });
  else throw new ValidationError("Say which pictures: their ids, a folder, or a tag.");
  items = items.filter((y) => y.kind === "image" && !y.deletedAt).slice(0, 30);
  if (!items.length) throw new ValidationError("There are no pictures there. list_yarn shows what is.");
  const cell = Math.max(24, Math.min(320, Math.round(o.size ?? 128)));
  const cols = Math.min(items.length, cell <= 64 ? 10 : cell <= 160 ? 6 : 4);
  const rows = Math.ceil(items.length / cols);
  const gap = 20, label = 22, cw = Math.max(cell, 96) + gap, ch = cell + label + gap;
  const bands = o.background === "light" ? [LIGHT] : o.background === "dark" ? [DARK] : [LIGHT, DARK];
  const W = cols * cw + gap, BH = rows * ch + gap;
  const drawn = await Promise.all(items.map(async (y) => {
    const file = yarnPath(store, y);
    if (y.mime === "image/svg+xml") return drawSvg(await readFile(file), y.width || cell, y.height || cell, cell);
    return sharp(file).rotate().resize(cell, cell, { fit: "inside" }).png().toBuffer();
  }));
  const layers: OverlayOptions[] = [];
  for (let b = 0; b < bands.length; b++) {
    const top0 = b * BH;
    if (bands[b] !== LIGHT) layers.push({ input: { create: { width: W, height: BH, channels: 4, background: bands[b] } }, left: 0, top: top0 });
    for (let i = 0; i < items.length; i++) {
      const m = await sharp(drawn[i]).metadata();
      const x = gap + (i % cols) * cw, y = top0 + gap + Math.floor(i / cols) * ch;
      layers.push({ input: drawn[i], left: x + Math.round((cw - gap - m.width!) / 2), top: y + Math.round((cell - m.height!) / 2) });
      const text = items[i].name.length > 18 ? items[i].name.slice(0, 16) + "..." : items[i].name;
      layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw - gap}" height="${label}"><text x="${(cw - gap) / 2}" y="15" font-family="Helvetica, Arial" font-size="12" fill="${bands[b] === LIGHT ? "#55524e" : "#b8b3ad"}" text-anchor="middle">${xmlEscape(text)}</text></svg>`), left: x, top: y + cell + 2 });
    }
  }
  const data = await sharp({ create: { width: W, height: BH * bands.length, channels: 4, background: LIGHT } }).composite(layers).png().toBuffer();
  return { data, mime: "image/png", items: items.map((y) => ({ id: y.id, name: y.name })) };
}
