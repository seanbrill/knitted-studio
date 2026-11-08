// Design sheets as pictures and as code: a whole sheet, one section or one frame drawn in the
// same browser that knits, for the person to download and for a model to look at its own
// work; and the sheet as HTML files a developer can build from.

import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { findSection, fontFor, framePage, frameSize, tokensCss, yarnIn } from "@knitted/core";
import { activeSwatch, getDesign, listYarn } from "@knitted/core/node";
import { bundledFont, fontFaceCss, fontPath } from "@knitted/fonts";
import { openRenderer } from "./renderer.mjs";

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
  const byId = new Map(yarn.map((y) => [y.id, y]));
  const families = [...new Set([fontFor(swatch, "display"), fontFor(swatch, "body"), fontFor(swatch, "mono"), "Geist"])];
  const fontFaces = [
    fontFaceCss(families, (f) => pathToFileURL(fontPath(f)).href),
    ...yarn.filter((y) => y.kind === "font").map((y) => `@font-face{font-family:"${(y.meta.family ?? y.name).replace(/"/g, "")}";src:url("${pathToFileURL(join(store.paths.yarnDir(y.projectId), y.file)).href}");font-display:block}`),
  ].join("\n");
  const yarnUrl = (id) => { const y = byId.get(id); return y && !y.deletedAt ? pathToFileURL(join(store.paths.yarnDir(y.projectId), y.file)).href : undefined; };
  return { yarn, byId, families, fontFaces, yarnUrl };
}

/**
 * The board as a page: sections one under another, each with its label, frames side by side
 * with theirs. Each frame is its own page in a frame of its own, so its CSS stays its own.
 */
export function boardPage(design, sections, { ctx, labels = true }) {
  const frames = sections.flatMap((s) => s.frames);
  const frameHtml = (f) => `<figure class="frame">${labels ? `<figcaption>${esc(f.name)} <span>${esc(frameSize(f))}</span></figcaption>` : ""}<iframe title="${esc(f.name)}" scrolling="no" onload="window.__loaded=(window.__loaded||0)+1" style="width:${f.width}px;height:${f.height ?? 200}px" ${f.height ? `data-fixed="1"` : ""} srcdoc="${esc(framePage(f, ctx))}"></iframe></figure>`;
  const body = labels
    ? `<div class="board">${sections.map((s) => `<section class="section"><header><b>${esc(s.name)}</b>${s.note ? `<span>${esc(s.note)}</span>` : ""}</header><div class="frames">${s.frames.length ? s.frames.map(frameHtml).join("") : `<p class="empty">No frames yet</p>`}</div></section>`).join("")}</div>`
    : frames.map(frameHtml).join("");
  return { frames: frames.length, html: `<!doctype html><html><head><meta charset="utf-8"><style>${ctx.fontFaces}
*{box-sizing:border-box}html,body{margin:0;background:${labels ? "#ebe6de" : "transparent"};font-family:"Geist",system-ui,sans-serif;color:#17110b}
.board{display:inline-flex;flex-direction:column;gap:80px;padding:80px}
.section{padding:28px 56px 56px;border-radius:24px;background:rgba(255,255,255,.6);box-shadow:inset 0 0 0 1px rgba(23,17,11,.08)}
.section>header{display:flex;align-items:baseline;gap:16px;margin:0 0 36px}
.section>header b{font-size:22px;font-weight:600;background:#fff;padding:8px 16px;border-radius:999px;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.section>header span{font-size:16px;color:#5e5246}
.frames{display:flex;gap:64px;align-items:flex-start}
.frame{margin:0}.frame figcaption{font-size:16px;font-weight:500;color:#3d342b;margin:0 0 12px}.frame figcaption span{color:#7a6e61;font-weight:400;margin-left:6px}
.frame iframe{display:block;border:0;background:#fff;${labels ? "box-shadow:0 2px 6px rgba(0,0,0,.08),0 24px 48px -24px rgba(0,0,0,.25)" : ""}}
.empty{font-size:16px;color:#7a6e61;margin:0;padding:40px 0}
</style></head><body>${body}</body></html>` };
}

/** Wait for every frame, its fonts and pictures, then make each as tall as what is in it. Returns the board's size. */
async function settle(page, n) {
  await page.waitForFunction((k) => (window.__loaded ?? 0) >= k, n, { timeout: 30_000 });
  return page.evaluate(async () => {
    const frames = [...document.querySelectorAll("iframe")];
    await document.fonts.ready;
    for (const f of frames) {
      const doc = f.contentDocument;
      await doc.fonts.ready;
      await Promise.all([...doc.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
      // Measured at one pixel tall: a page is never shorter than its window, so measured at its
      // first height, a header would keep the 200 pixels it started with.
      if (!f.dataset.fixed) { f.style.height = "1px"; f.style.height = `${Math.max(40, doc.documentElement.scrollHeight)}px`; }
    }
    const root = document.querySelector(".board") ?? document.body;
    const r = root.getBoundingClientRect();
    return { width: Math.ceil(Math.max(r.width, document.documentElement.scrollWidth)), height: Math.ceil(Math.max(r.height, document.documentElement.scrollHeight)) };
  });
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
 * sheet too big for the browser is drawn smaller rather than not at all.
 * @param {any} store
 * @param {string} designId
 * @param {{ sectionId?: string, frameId?: string, scale?: number, renderer?: any }} [opts]
 * @returns {Promise<Buffer>}
 */
export async function renderDesign(store, designId, { sectionId, frameId, scale = 1, renderer: injected } = {}) {
  const design = getDesign(store, designId);
  const { sections, one } = pick(design, { sectionId, frameId });
  const swatch = activeSwatch(store, design.projectId);
  const files = filesFor(store, design.projectId, swatch);
  const ctx = { swatch, fontFaces: files.fontFaces, yarnUrl: files.yarnUrl };
  const { html, frames } = boardPage(design, sections, { ctx, labels: !one });
  const dir = join(store.paths.projectDir(design.projectId), ".pages");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `design-${designId}-${Date.now()}.html`);
  await writeFile(file, html, "utf8");
  const renderer = injected ?? (await openRenderer());
  const draw = async (s) => {
    const page = await renderer.newPage({ width: one ? sections[0].frames[0].width : 1600, height: 900, scale: s });
    try {
      await page.goto(pathToFileURL(file).href);
      const size = frames ? await settle(page, frames) : await page.evaluate(() => ({ width: document.body.scrollWidth, height: document.body.scrollHeight }));
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
 * cleared of older ones each time. Returns the files, for a zip.
 * @param {any} store
 * @param {string} designId
 * @returns {Promise<{ name: string, entries: { name: string, path: string }[], dir: string, root: string, used: Map<string, string>, logo: string | undefined }>}
 */
export async function designCode(store, designId) {
  const design = getDesign(store, designId);
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
  const root = slug(design.name);
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
      const name = `${folder}/${String(j + 1).padStart(2, "0")}-${slug(f.name)}.html`;
      await put(name, framePage(f, ctx).replace("overflow:hidden}", "}"));
      links.push(`<li><a href="${name}">${esc(f.name)}</a> <small>${esc(frameSize(f))}</small>${f.note ? `<br><span>${esc(f.note)}</span>` : ""}</li>`);
    }
    contents.push(`<h2>${esc(s.name)}</h2>${s.note ? `<p>${esc(s.note)}</p>` : ""}<ul>${links.join("") || "<li>No frames</li>"}</ul>`);
  }
  await put("index.html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(design.name)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 24px}small,span{color:#666}li{margin:6px 0}</style></head><body><h1>${esc(design.name)}</h1><p>Every frame of the design, as a page. They use tokens.css, the brand's colours, fonts and corners, so a change there changes them all.</p>${contents.join("")}</body></html>`);
  await put("README.md", `# ${design.name}\n\nA design from knitted: each frame is a page of HTML and CSS, in a folder for its section. Open index.html to see them all.\n\n- tokens.css holds the brand: \`${"--color-primary"}\` and the other colours, \`--font-display\`, \`--font-body\`, \`--font-mono\` and \`--radius\`. Build with these, not with the values.\n- fonts/ has the brand's fonts, and images/ the pictures the design uses.\n- A design shows one state of each screen. A menu open and a menu closed are two frames.\n`);
  return { name: `${root}.zip`, entries, dir, root, used, logo };
}

// For the download of everything (design-bundle.mjs): the tiled capture and where the files are.
export { capture as captureTiles, filesFor as designFiles };
