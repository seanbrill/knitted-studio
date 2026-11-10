// Design sheets as pictures and as code: a whole sheet, one section or one frame drawn in the
// same browser that knits, for the person to download and for a model to look at its own
// work; and the sheet as HTML files a developer can build from.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { BOARD, findSection, fontFor, framePage, frameRev, frameSize, layoutDesign, stillMs, tokensCss, yarnIn } from "@knitted/core";
import { activeSwatch, codeHash, getDesign as getDesignRaw, getDesignMeta, getPart, listYarn, setFrameHeights, withPieces } from "@knitted/core/node";
import { bundledFont, fontFaceCss, fontPath } from "@knitted/fonts";
import { pageFor } from "@knitted/render";
import { openRenderer } from "./renderer.mjs";
import { renderContext } from "./runner.mjs";

/** A sheet with its pieces as they are now: their names, and heights for their shapes. */
const getDesign = (store, id) => withPieces(store, getDesignRaw(store, id));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "frame";
/** Chromium draws a page up to about this many pixels a side; a bigger sheet is drawn smaller. */
const MAX_SIDE = 16_000;
/**
 * A window this many pixels a side at most. Chromium leaves a bigger window partly or wholly
 * undrawn (a whole sheet of 13,000 by 24,000 came out blank), so a sheet is drawn in tiles.
 */
const TILE = 4096;

/** What is drawn: the whole sheet, one section, or one frame. */
function pick(design, { sectionId, frameId } = {}) {
  if (frameId) {
    for (const s of design.sections) { const f = s.frames.find((x) => x.id === frameId); if (f) return { sections: [{ ...s, frames: [f] }], one: true }; }
    throw Object.assign(new Error(`There is no frame "${frameId}" in this design.`), { kind: "not_found" });
  }
  if (sectionId) return { sections: [findSection(design.sections, sectionId)], one: false };
  return { sections: design.sections, one: false };
}

/** The brand's fonts and the project's own, as file:// faces, and where each Yarn file is. */
function filesFor(store, projectId, swatch) {
  const yarn = listYarn(store, projectId);
  // A frame may show the Brief's reference too: the page as it is, beside a new design of it.
  const byId = new Map([...yarn, ...listYarn(store, projectId, { shelf: "reference" })].map((y) => [y.id, y]));
  const families = [...new Set([fontFor(swatch, "display"), fontFor(swatch, "body"), fontFor(swatch, "mono"), "Geist"])];
  const fontFaces = [
    fontFaceCss(families, (f) => pathToFileURL(fontPath(f)).href),
    ...yarn.filter((y) => y.kind === "font").map((y) => `@font-face{font-family:"${(y.meta.family ?? y.name).replace(/"/g, "")}";src:url("${pathToFileURL(join(store.paths.yarnDir(y.projectId), y.file)).href}");font-display:block}`),
  ].join("\n");
  const yarnUrl = (id) => { const y = byId.get(id); return y && !y.deletedAt ? pathToFileURL(join(store.paths.yarnDir(y.projectId), y.file)).href : undefined; };
  return { yarn, byId, families, fontFaces, yarnUrl };
}

/**
 * The pages of a sheet's pieces, by frame id: each pattern and part drawn by the renderer the
 * editor and the knits use, a Yarn picture as it is (a video by its poster), and a piece whose
 * thing has gone as a note saying so. Each is a page at the thing's own size, `w` by `h`; a
 * pattern that moves is shown at `still`, when everything is in.
 * @returns {Map<string, { doc: string, w: number, h: number, still: number }>}
 */
export function piecePages(store, projectId, frames, swatch, files) {
  const out = new Map();
  const bg = swatch.colors.find((c) => c.role === "background")?.hex;
  const yarnMap = Object.fromEntries(files.byId);
  for (const f of frames) {
    if (!f.piece) continue;
    const { kind, id, w, h, gone } = f.piece;
    const page = (body, css = "") => `<!doctype html><html><head><meta charset="utf-8"><style>${files.fontFaces}
html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}${css}</style></head><body>${body}</body></html>`;
    if (gone) {
      out.set(f.id, { w, h, still: 0, doc: page(`<p>${esc(`This ${kind === "yarn" ? "file is not in Yarn" : `${kind} is not in the project`} any more.`)}</p>`,
        `body{display:grid;place-items:center;background:#f3efe9;font:500 ${Math.max(16, Math.round(w / 30))}px "Geist",system-ui,sans-serif;color:#7a6e61}`) });
      continue;
    }
    if (kind === "yarn") {
      const y = files.byId.get(id);
      const url = y?.kind === "video" ? (y.meta.thumb ? pathToFileURL(join(store.paths.yarnDir(y.projectId), ".thumbs", y.meta.thumb)).href : undefined) : files.yarnUrl(id);
      out.set(f.id, { w, h, still: 0, doc: page(url ? `<img src="${esc(url)}" alt="">` : "", "body{background:transparent}img{display:block;width:100%;height:100%;object-fit:contain}") });
      continue;
    }
    // A pattern shown at another of its sizes is laid out there: its stitches are fractions of it.
    const pattern = kind === "pattern" ? atSize(store.getPattern(id), f.piece.size, w, h) : partPattern(getPart(store, id), w, h);
    out.set(f.id, { w, h, still: stillMs(pattern), doc: pageFor({ ...pattern, background: bg }, renderContext(store, projectId, pattern, swatch, files.yarn, yarnMap)) });
  }
  return out;
}
/** A pattern at the size a piece shows it at: its own, unless the piece names another. */
const atSize = (p, size, w, h) => (size ? { ...p, size: { ...p.size, name: size, w, h } } : p);
/** A part as a pattern of its own, filling it: how the editor shows a part. */
const partPattern = (part, w, h) => ({ id: "piece", projectId: "", name: part.name, version: 1, updatedAt: "", durationMs: 0, size: { name: "piece", w, h },
  stitches: [{ id: "i", kind: "part", x: 0, y: 0, w: 1, h: 1, locked: false, partId: part.id, overrides: {}, partSlots: part.slots }] });

/** Room round the board in a picture of it, for the section names above the sections. */
const MARGIN = 96;

/**
 * The board as a page: each section and frame where the board in the studio has it (layoutDesign),
 * with its label. Each frame is its own page in a frame of its own, so its CSS stays its own.
 * Frames are placed at a guess of their height, then again once measured (placeBoard). Without
 * labels, frames one after another, to measure or to draw one.
 */
export function boardPage(design, sections, { ctx, labels = true, pieces = new Map() }) {
  const frames = sections.flatMap((s) => s.frames);
  const caption = (f) => (labels ? `<figcaption>${esc(f.name)} <span>${esc(frameSize(f))}</span></figcaption>` : "");
  const frameHtml = (f, at) => {
    const pos = at ? ` style="left:${at.x}px;top:${at.y}px"` : "";
    const p = pieces.get(f.id);
    // A piece is its thing's own page, at its own size, drawn as wide as the piece.
    if (p) return `<figure class="frame" data-f="${esc(f.id)}"${pos}>${caption(f)}<div class="piece" style="width:${f.width}px;height:${f.height}px"><iframe title="${esc(f.name)}" data-id="${esc(f.id)}" data-fixed="1" data-piece="1"${p.still ? ` data-still="${p.still}"` : ""} scrolling="no" onload="window.__loaded=(window.__loaded||0)+1" style="width:${p.w}px;height:${p.h}px;transform:scale(${f.width / p.w});transform-origin:0 0" srcdoc="${esc(p.doc)}"></iframe></div></figure>`;
    return `<figure class="frame" data-f="${esc(f.id)}"${pos}>${caption(f)}<iframe title="${esc(f.name)}" data-id="${esc(f.id)}" scrolling="no" onload="window.__loaded=(window.__loaded||0)+1" style="width:${f.width}px;height:${f.height ?? 200}px" ${f.height ? `data-fixed="1"` : ""} srcdoc="${esc(framePage(f, ctx))}"></iframe></figure>`;
  };
  let body;
  if (labels) {
    const lay = layoutDesign(sections);
    const ox = MARGIN - lay.x, oy = MARGIN - lay.y;
    body = `<div class="board" style="width:${lay.w + 2 * MARGIN}px;height:${lay.h + 2 * MARGIN}px">${sections.map((s, i) => {
      const b = lay.sections[i];
      const at = new Map(b.frames.map((f) => [f.id, { x: f.x - b.x, y: f.y - b.y }]));
      return `<section class="section" data-s="${esc(s.id)}" style="left:${b.x + ox}px;top:${b.y + oy}px;width:${b.w}px;height:${b.h}px"><header><b>${esc(s.name)}</b>${s.note ? `<span>${esc(s.note)}</span>` : ""}</header>${s.frames.length ? s.frames.map((f) => frameHtml(f, at.get(f.id))).join("") : `<p class="empty">No frames yet</p>`}</section>`;
    }).join("")}</div>`;
  } else body = frames.map((f) => frameHtml(f)).join("");
  return { frames: frames.length, html: `<!doctype html><html><head><meta charset="utf-8"><style>${ctx.fontFaces}
*{box-sizing:border-box}html,body{margin:0;background:${labels ? "#ebe6de" : "transparent"};font-family:"Geist",system-ui,sans-serif;color:#17110b}
.board{position:relative}
.section{position:absolute;border-radius:24px;background:rgba(255,255,255,.6);box-shadow:inset 0 0 0 1px rgba(23,17,11,.08)}
.section>header{position:absolute;left:0;bottom:100%;margin-bottom:14px;display:flex;align-items:baseline;gap:16px;white-space:nowrap}
.section>header b{font-size:22px;font-weight:600;background:#fff;padding:8px 16px;border-radius:999px;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.section>header span{font-size:16px;color:#5e5246;max-width:${BOARD.emptyW * 2}px;overflow:hidden;text-overflow:ellipsis}
.section>.frame{position:absolute}
.frame{margin:0}.frame figcaption{position:absolute;left:0;bottom:100%;margin:0 0 12px;font-size:16px;font-weight:500;color:#3d342b;white-space:nowrap}.frame figcaption span{color:#7a6e61;font-weight:400;margin-left:6px}
.frame iframe{display:block;border:0;background:#fff;${labels ? "box-shadow:0 2px 6px rgba(0,0,0,.08),0 24px 48px -24px rgba(0,0,0,.25)" : ""}}
.frame .piece{overflow:hidden;${labels ? "box-shadow:0 2px 6px rgba(0,0,0,.08),0 24px 48px -24px rgba(0,0,0,.25)" : ""}}.frame .piece iframe{box-shadow:none;background:transparent}
.empty{position:absolute;left:${BOARD.pad}px;top:${BOARD.pad}px;font-size:16px;color:#7a6e61;margin:0}
</style></head><body>${body}</body></html>` };
}

/** The board's sections and frames where they go now that every frame's height is known. Returns the board's size. */
async function placeBoard(page, sections, heights) {
  const lay = layoutDesign(sections, (f) => heights[f.id] ?? f.height ?? Math.round(f.width * 0.625));
  const ox = MARGIN - lay.x, oy = MARGIN - lay.y;
  const at = { sections: lay.sections.map((b) => ({ id: b.id, x: b.x + ox, y: b.y + oy, w: b.w, h: b.h, frames: b.frames.map((f) => ({ id: f.id, x: f.x - b.x, y: f.y - b.y })) })), w: lay.w + 2 * MARGIN, h: lay.h + 2 * MARGIN };
  await page.evaluate((a) => {
    const board = document.querySelector(".board");
    board.style.width = `${a.w}px`; board.style.height = `${a.h}px`;
    for (const s of a.sections) {
      const el = board.querySelector(`[data-s="${CSS.escape(s.id)}"]`);
      if (!el) continue;
      Object.assign(el.style, { left: `${s.x}px`, top: `${s.y}px`, width: `${s.w}px`, height: `${s.h}px` });
      for (const f of s.frames) { const fe = el.querySelector(`[data-f="${CSS.escape(f.id)}"]`); if (fe) Object.assign(fe.style, { left: `${f.x}px`, top: `${f.y}px` }); }
    }
  }, at);
  return { width: at.w, height: at.h };
}

/** Wait for every frame, its fonts and pictures, then make each as tall as what is in it. Returns the page's size and each frame's height. */
async function settle(page, n) {
  await page.waitForFunction((k) => (window.__loaded ?? 0) >= k, n, { timeout: 30_000 });
  return page.evaluate(async () => {
    const frames = [...document.querySelectorAll("iframe")];
    await document.fonts.ready;
    const heights = {};
    for (const f of frames) {
      const doc = f.contentDocument;
      await doc.fonts.ready;
      await Promise.all([...doc.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
      // A pattern or a part is drawn by its own stage: ready, then at the moment everything is in.
      const stage = f.dataset.piece ? f.contentWindow.__stage : null;
      if (stage) { await stage.ready(); if (f.dataset.still) await stage.seek(Number(f.dataset.still)); }
      // Measured at one pixel tall: a page is never shorter than its window, so measured at its
      // first height, a header would keep the 200 pixels it started with.
      if (!f.dataset.fixed) { f.style.height = "1px"; const h = Math.max(40, doc.documentElement.scrollHeight); f.style.height = `${h}px`; heights[f.dataset.id] = h; }
    }
    const root = document.querySelector(".board") ?? document.body;
    const r = root.getBoundingClientRect();
    return { heights, width: Math.ceil(Math.max(r.width, document.documentElement.scrollWidth)), height: Math.ceil(Math.max(r.height, document.documentElement.scrollHeight)) };
  });
}

/** Heights the engine measured, kept for the board, under each frame as it was drawn. */
function keepHeights(store, designId, frames, heights) {
  const sizes = {};
  for (const f of frames) if (!f.height && heights[f.id]) sizes[f.id] = { rev: frameRev({ code: codeHash(f.html, f.css), width: f.width }), height: heights[f.id] };
  try { setFrameHeights(store, designId, sizes); } catch { /* the sheet went while it was drawn */ }
}

/**
 * The page from its top left, `size` wide and tall, drawn at `s` pixels a pixel, a tile at a
 * time: the window is a tile, scrolled across and down the page, and the tiles put together.
 */
async function capture(page, size, s) {
  const tile = Math.max(1, Math.floor(TILE / s));
  const vw = Math.min(size.width, tile), vh = Math.min(size.height, tile);
  await page.setViewportSize({ width: vw, height: vh });
  if (size.width <= tile && size.height <= tile) return page.screenshot({ type: "png", clip: { x: 0, y: 0, width: size.width, height: size.height } });
  const W = Math.round(size.width * s), H = Math.round(size.height * s);
  const parts = [];
  for (let y = 0; y < size.height; y += tile) for (let x = 0; x < size.width; x += tile) {
    // Scrolled past the end, the window stops at the edge: the tile is placed where it stopped.
    // A frame off screen is not drawn until it has been on screen a moment, so the tile waits for
    // each frame in it to draw twice (one not drawing runs no animation frames), then the page once.
    const at = await page.evaluate(async ([tx, ty]) => {
      window.scrollTo(tx, ty);
      const drawn = (w) => new Promise((r) => { const t = setTimeout(r, 3000); w.requestAnimationFrame(() => w.requestAnimationFrame(() => { clearTimeout(t); r(); })); });
      const shown = [...document.querySelectorAll("iframe")].filter((f) => { const b = f.getBoundingClientRect(); return b.bottom > 0 && b.top < window.innerHeight && b.right > 0 && b.left < window.innerWidth; });
      await Promise.all([drawn(window), ...shown.map((f) => drawn(f.contentWindow))]);
      await drawn(window);
      return { x: window.scrollX, y: window.scrollY };
    }, [x, y]);
    const shot = await page.screenshot({ type: "png" });
    const left = Math.min(W - 1, Math.round(at.x * s)), top = Math.min(H - 1, Math.round(at.y * s));
    const m = await sharp(shot).metadata();
    const w = Math.min(m.width, W - left), h = Math.min(m.height, H - top);
    parts.push({ input: w < m.width || h < m.height ? await sharp(shot).extract({ left: 0, top: 0, width: w, height: h }).png().toBuffer() : shot, left, top });
  }
  return sharp({ create: { width: W, height: H, channels: 3, background: "#ebe6de" } }).composite(parts).removeAlpha().png().toBuffer();
}

/**
 * A design, a section of it or one frame, as PNG bytes. `scale` 2 draws twice the pixels; a
 * sheet too big for the browser is drawn smaller rather than not at all. The heights measured
 * on the way are kept for the board.
 * @param {any} store
 * @param {string} designId
 * @param {{ sectionId?: string, frameId?: string, scale?: number, renderer?: any }} [opts]
 * @returns {Promise<Buffer>}
 */
export async function renderDesign(store, designId, { sectionId, frameId, scale = 1, renderer: injected } = {}) {
  const design = getDesign(store, designId);
  const picked = pick(design, { sectionId, frameId });
  // One section is drawn on its own, from the top left, wherever it is on the board.
  const sections = sectionId ? picked.sections.map(({ x: _x, y: _y, ...s }) => s) : picked.sections;
  const { one } = picked;
  const swatch = activeSwatch(store, design.projectId);
  const files = filesFor(store, design.projectId, swatch);
  const ctx = { swatch, fontFaces: files.fontFaces, yarnUrl: files.yarnUrl };
  const pieces = piecePages(store, design.projectId, sections.flatMap((s) => s.frames), swatch, files);
  const { html, frames } = boardPage(design, sections, { ctx, labels: !one, pieces });
  const dir = join(store.paths.projectDir(design.projectId), ".pages");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `design-${designId}-${Date.now()}.html`);
  await writeFile(file, html, "utf8");
  const renderer = injected ?? (await openRenderer());
  const draw = async (s) => {
    const page = await renderer.newPage({ width: one ? sections[0].frames[0].width : 1600, height: 900, scale: s });
    try {
      await page.goto(pathToFileURL(file).href);
      let size = frames ? await settle(page, frames) : await page.evaluate(() => ({ width: document.body.scrollWidth, height: document.body.scrollHeight }));
      if (frames) keepHeights(store, designId, sections.flatMap((x) => x.frames), size.heights);
      if (frames && !one) size = await placeBoard(page, sections, size.heights);
      if (Math.max(size.width, size.height) * s > MAX_SIDE) return { again: MAX_SIDE / Math.max(size.width, size.height) };
      if (one) {
        const r = await page.locator("iframe").boundingBox();
        return { png: await capture(page, { width: Math.ceil(r.width), height: Math.ceil(r.height) }, s) };
      }
      return { png: await capture(page, size, s) };
    } finally { await page.close(); }
  };
  try {
    const first = await draw(scale);
    return first.png ?? (await draw(Math.floor(first.again * 100) / 100)).png;
  } finally { await rm(file, { force: true }); if (!injected) await renderer.close(); }
}

// ── the board's pictures ──────────────────────────────────────────────────────
// A frame small on the board is shown as a picture of it, drawn here once and kept until the
// frame, the brand or a picture in it changes; a frame big enough to read is drawn live by the
// window. One browser stays open for them while the board asks, and closes a minute after.

const sheets = (globalThis.__knittedSheetRenderer ??= { opening: null, timer: null, running: 0, waiting: [] });
/** Run `fn` with the shared browser: two at a time, the rest in turn. */
async function withSheetRenderer(fn) {
  if (sheets.running >= 2) await new Promise((r) => sheets.waiting.push(r));
  sheets.running++;
  clearTimeout(sheets.timer);
  try {
    sheets.opening ??= openRenderer().catch((e) => { sheets.opening = null; throw e; });
    const renderer = await sheets.opening;
    try { return await fn(renderer); } catch (e) {
      // A browser that went away is opened again next time.
      if (/closed|crash|disconnected/i.test(String(e?.message))) { const o = sheets.opening; sheets.opening = null; o?.then((r) => r.close()).catch(() => {}); }
      throw e;
    }
  } finally {
    sheets.running--;
    sheets.waiting.shift()?.();
    if (!sheets.running && !sheets.waiting.length) {
      sheets.timer = setTimeout(() => { const o = sheets.opening; sheets.opening = null; o?.then((r) => r.close()).catch(() => {}); }, 60_000);
      sheets.timer.unref?.();
    }
  }
}

/** How wide a frame's picture is drawn, in pixels: sharp at the sizes it is shown as a picture. */
const THUMB = 720;
/** The tallest a picture is drawn, in pixels: a taller frame is drawn smaller. */
const THUMB_TALL = 16_000;

/** A frame drawn on a page of its own at `s` pixels a pixel: its picture, and how tall it is. */
async function drawFrame(renderer, file, f, s) {
  const page = await renderer.newPage({ width: f.width, height: 900, scale: s });
  try {
    await page.goto(pathToFileURL(file).href);
    const size = await settle(page, 1);
    const h = f.height ?? size.heights[f.id] ?? 900;
    if (h * s > THUMB_TALL) return { again: THUMB_TALL / h, height: h };
    return { png: await capture(page, { width: f.width, height: h }, s), height: h };
  } finally { await page.close().catch(() => {}); }
}

/**
 * A frame as a small picture, for the board: WebP bytes and how tall the frame is. Kept on disk
 * under the frame as drawn, so it is drawn once until something in it changes.
 * @returns {Promise<{ webp: Buffer, height: number }>}
 */
export async function designThumb(store, designId, frameId) {
  const design = getDesign(store, designId);
  const f = design.sections.flatMap((s) => s.frames).find((x) => x.id === frameId);
  if (!f) throw Object.assign(new Error(`There is no frame "${frameId}" in this design.`), { kind: "not_found" });
  const swatch = activeSwatch(store, design.projectId);
  const files = filesFor(store, design.projectId, swatch);
  const ctx = { swatch, fontFaces: files.fontFaces, yarnUrl: files.yarnUrl };
  const { html } = boardPage(design, [{ id: "one", name: "", frames: [f] }], { ctx, labels: false, pieces: piecePages(store, design.projectId, [f], swatch, files) });
  const key = createHash("sha1").update(html).digest("hex").slice(0, 20);
  const dir = join(store.paths.cacheDir, "sheets", designId);
  const name = `${frameId}-${key}`;
  try {
    const [webp, h] = await Promise.all([readFile(join(dir, `${name}.webp`)), readFile(join(dir, `${name}.h`), "utf8")]);
    return { webp, height: Number(h) || 0 };
  } catch { /* not drawn yet */ }
  const { png, height } = await withSheetRenderer(async (renderer) => {
    const pages = join(store.paths.projectDir(design.projectId), ".pages");
    await mkdir(pages, { recursive: true });
    const file = join(pages, `thumb-${designId}-${frameId}-${Date.now()}.html`);
    await writeFile(file, html, "utf8");
    try {
      const first = await drawFrame(renderer, file, f, Math.min(2, THUMB / f.width));
      return first.png ? first : await drawFrame(renderer, file, f, Math.floor(first.again * 1000) / 1000);
    } finally { await rm(file, { force: true }); }
  });
  if (!f.height) keepHeights(store, designId, [f], { [f.id]: height });
  const webp = await sharp(png).webp({ quality: 82 }).toBuffer();
  await mkdir(dir, { recursive: true });
  // One picture a frame: the one before it, of the frame as it was, goes.
  for (const old of await readdir(dir).catch(() => [])) if (old.startsWith(`${frameId}-`) && !old.startsWith(`${name}.`)) await rm(join(dir, old), { force: true });
  await writeFile(join(dir, `${name}.webp`), webp);
  await writeFile(join(dir, `${name}.h`), String(height));
  return { webp, height };
}

/**
 * How tall the frames of a sheet that are as tall as what is in them are, measured in the shared
 * browser for those not measured since they last changed, and kept for the board. Returns each
 * one measured, under the frame as it was drawn.
 * @returns {Promise<Record<string, { rev: string, height: number }>>}
 */
export async function measureDesign(store, designId) {
  const meta = getDesignMeta(store, designId);
  const want = new Set(meta.sections.flatMap((s) => s.frames).filter((f) => !f.height && f.measured == null).map((f) => f.id));
  if (!want.size) return {};
  const design = getDesign(store, designId);
  const frames = design.sections.flatMap((s) => s.frames).filter((f) => want.has(f.id));
  const swatch = activeSwatch(store, design.projectId);
  const files = filesFor(store, design.projectId, swatch);
  const ctx = { swatch, fontFaces: files.fontFaces, yarnUrl: files.yarnUrl };
  const out = {};
  // Forty at a time: a page of hundreds of frames is slow to load and can run out of memory.
  for (let i = 0; i < frames.length; i += 40) {
    const some = frames.slice(i, i + 40);
    const { html } = boardPage(design, [{ id: "measure", name: "", frames: some }], { ctx, labels: false });
    const heights = await withSheetRenderer(async (renderer) => {
      const pages = join(store.paths.projectDir(design.projectId), ".pages");
      await mkdir(pages, { recursive: true });
      const file = join(pages, `measure-${designId}-${Date.now()}-${i}.html`);
      await writeFile(file, html, "utf8");
      const page = await renderer.newPage({ width: 1600, height: 900, scale: 1 });
      try { await page.goto(pathToFileURL(file).href); return (await settle(page, some.length)).heights; }
      finally { await page.close().catch(() => {}); await rm(file, { force: true }); }
    });
    keepHeights(store, designId, some, heights);
    for (const f of some) if (heights[f.id]) out[f.id] = { rev: frameRev({ code: codeHash(f.html, f.css), width: f.width }), height: heights[f.id] };
  }
  return out;
}

/**
 * What is at a point of a frame: the element there, as a model reads it, and the elements it
 * sits in. `x` and `y` are fractions of the frame, across and down its whole height.
 * @returns {Promise<{ tag: string, path: string, text: string, html: string } | null>}
 */
export async function elementAt(store, designId, frameId, { x, y, renderer: injected } = {}) {
  const design = getDesign(store, designId);
  const f = design.sections.flatMap((s) => s.frames).find((v) => v.id === frameId);
  // A piece has no HTML of its own: what is under a pin on one is its stitches (stitchesAt).
  if (!f || f.piece) return null;
  const swatch = activeSwatch(store, design.projectId);
  const files = filesFor(store, design.projectId, swatch);
  const dir = join(store.paths.projectDir(design.projectId), ".pages");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `at-${designId}-${Date.now()}.html`);
  await writeFile(file, framePage(f, { swatch, fontFaces: files.fontFaces, yarnUrl: files.yarnUrl }), "utf8");
  const renderer = injected ?? (await openRenderer());
  const page = await renderer.newPage({ width: f.width, height: f.height ?? 900, scale: 1 });
  try {
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => document.fonts.ready);
    const h = f.height ?? Math.min(MAX_SIDE, await page.evaluate(() => document.documentElement.scrollHeight));
    await page.setViewportSize({ width: f.width, height: h });
    return await page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py);
      if (!el || el === document.documentElement) return null;
      const name = (e) => `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}${[...e.classList].slice(0, 3).map((c) => `.${c}`).join("")}`;
      const path = []; for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) path.unshift(name(e));
      const html = el.outerHTML.replace(/\s+/g, " ");
      return { tag: name(el), path: path.join(" > "), text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200), html: html.length > 600 ? `${html.slice(0, 600)}...` : html };
    }, [x * f.width, y * h]);
  } finally { await page.close(); await rm(file, { force: true }); if (!injected) await renderer.close(); }
}

/**
 * A picture for a model to read: a long page cut into columns side by side, then no more than
 * `max` pixels a side, as a model sees no more than that anyway.
 */
export async function forModel(png, { max = 2000 } = {}) {
  const img = sharp(png);
  const { width, height } = await img.metadata();
  let out = png;
  if (height > width * 2.2) {
    const tall = Math.ceil(width * 1.5);
    const n = Math.min(6, Math.ceil(height / tall));
    const step = Math.ceil(height / n);
    const gap = Math.round(width * 0.04);
    const cols = await Promise.all(Array.from({ length: n }, (_, i) => sharp(png).extract({ left: 0, top: i * step, width, height: Math.min(step, height - i * step) }).png().toBuffer()));
    out = await sharp({ create: { width: n * width + (n - 1) * gap, height: step, channels: 4, background: "#ebe6de" } })
      .composite(cols.map((input, i) => ({ input, left: i * (width + gap), top: 0 }))).png().toBuffer();
  }
  return sharp(out).resize(max, max, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
}

/**
 * A design as files a developer can build from: a page per frame, the brand's tokens and
 * fonts, and the pictures it uses. Written to a folder under the project's .pages, which is
 * cleared of older ones each time. Returns the files, for a zip. With `sectionId`, only that
 * section: its frames, and the fonts and pictures they use.
 * @param {any} store
 * @param {string} designId
 * @param {{ sectionId?: string }} [opts]
 * @returns {Promise<{ name: string, entries: { name: string, path: string }[], dir: string, root: string, used: Map<string, string>, logo: string | undefined }>}
 */
export async function designCode(store, designId, { sectionId } = {}) {
  const design = designOrSection(getDesign(store, designId), sectionId);
  const swatch = activeSwatch(store, design.projectId);
  const files = filesFor(store, design.projectId, swatch);
  const pages = join(store.paths.projectDir(design.projectId), ".pages");
  await mkdir(pages, { recursive: true });
  for (const name of await readdir(pages).catch(() => [])) {
    if (!name.startsWith("code-")) continue;
    const at = join(pages, name);
    if (Date.now() - (await stat(at)).mtimeMs > 60 * 60_000) await rm(at, { recursive: true, force: true });
  }
  const dir = join(pages, `code-${designId}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const root = slug(design.title);
  const entries = [];
  const put = async (name, text) => { const at = join(dir, ...name.split("/")); await mkdir(join(at, ".."), { recursive: true }); await writeFile(at, text, "utf8"); entries.push({ name: `${root}/${name}`, path: at }); };

  // Fonts: the brand's bundled ones and any it uploaded, beside the pages.
  const fonts = [];
  const faces = [];
  for (const family of files.families) {
    const f = bundledFont(family);
    if (!f || fonts.includes(f.file)) continue;
    fonts.push(f.file);
    entries.push({ name: `${root}/fonts/${f.file}`, path: fontPath(f.file) });
  }
  faces.push(fontFaceCss(files.families, (file) => `../fonts/${file}`));
  for (const y of files.yarn.filter((x) => x.kind === "font")) {
    entries.push({ name: `${root}/fonts/${y.file}`, path: join(store.paths.yarnDir(y.projectId), y.file) });
    faces.push(`@font-face{font-family:"${(y.meta.family ?? y.name).replace(/"/g, "")}";src:url("../fonts/${y.file}");font-display:swap}`);
  }
  await put("tokens.css", `/* The brand, from its Swatch in knitted. Every page uses these. */\n${tokensCss(swatch).replace(/;/g, ";\n  ").replace("{", "{\n  ").replace(/\s*}$/, "\n}")}\n`);

  // Pictures from Yarn, named by what they are called there.
  const logo = swatch.logos.find((l) => l.use === "full")?.yarnId ?? swatch.logos[0]?.yarnId;
  const used = new Map();
  for (const s of design.sections) for (const f of s.frames) for (const ref of yarnIn(f.html, f.css)) {
    const id = ref === "logo" ? logo : ref;
    const y = id && files.byId.get(id);
    if (!y || used.has(id)) continue;
    let name = `${slug(y.name)}${extname(y.file).toLowerCase()}`;
    while ([...used.values()].includes(name)) name = `${slug(y.name)}-${used.size}${extname(y.file).toLowerCase()}`;
    used.set(id, name);
    entries.push({ name: `${root}/images/${name}`, path: join(store.paths.yarnDir(y.projectId), y.file) });
  }
  const ctx = { swatch, fontFaces: faces.join("\n"), tokensHref: "../tokens.css", yarnUrl: (id) => (used.has(id) ? `../images/${used.get(id)}` : undefined) };

  const contents = [];
  for (const [i, s] of design.sections.entries()) {
    const folder = `${String(i + 1).padStart(2, "0")}-${slug(s.name)}`;
    const links = [];
    for (const [j, f] of s.frames.entries()) {
      // A piece is a pattern, a part or a picture from knitted, not code: it is in the sheet's picture.
      if (f.piece) { links.push(`<li>${esc(f.name)} <small>${esc(frameSize(f))}, from knitted: not code, so it is only in the picture of the sheet</small></li>`); continue; }
      const name = `${folder}/${String(j + 1).padStart(2, "0")}-${slug(f.name)}.html`;
      await put(name, framePage(f, ctx).replace("overflow:hidden}", "}"));
      links.push(`<li><a href="${name}">${esc(f.name)}</a> <small>${esc(frameSize(f))}</small>${f.note ? `<br><span>${esc(f.note)}</span>` : ""}</li>`);
    }
    contents.push(`<h2>${esc(s.name)}</h2>${s.note ? `<p>${esc(s.note)}</p>` : ""}<ul>${links.join("") || "<li>No frames</li>"}</ul>`);
  }
  await put("index.html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(design.title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 24px}small,span{color:#666}li{margin:6px 0}</style></head><body><h1>${esc(design.title)}</h1><p>Every frame of the ${design.section ? "section" : "design"}, as a page. They use tokens.css, the brand's colours, fonts and corners, so a change there changes them all.</p>${contents.join("")}</body></html>`);
  await put("README.md", `# ${design.title}\n\n${design.section ? `The section ${design.section} of a design from knitted` : "A design from knitted"}: each frame is a page of HTML and CSS, in a folder for its section. Open index.html to see them all.\n\n- tokens.css holds the brand: \`${"--color-primary"}\` and the other colours, \`--font-display\`, \`--font-body\`, \`--font-mono\` and \`--radius\`. Build with these, not with the values.\n- fonts/ has the brand's fonts, and images/ the pictures the design uses.\n- A design shows one state of each screen. A menu open and a menu closed are two frames.\n`);
  return { name: `${root}.zip`, entries, dir, root, used, logo };
}

/**
 * The design, or with `sectionId` the design with only that section in it, and the name its
 * download goes by: "Website", or "Website, Pages".
 */
export function designOrSection(design, sectionId) {
  if (!sectionId) return { ...design, title: design.name, section: null };
  const s = findSection(design.sections, sectionId);
  return { ...design, sections: [s], title: `${design.name}, ${s.name}`, section: s.name };
}

// For the download of everything (design-bundle.mjs): the tiled capture and where the files are.
export { capture as captureTiles, filesFor as designFiles };
