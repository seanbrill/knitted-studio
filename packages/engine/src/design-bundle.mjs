// A design sheet with everything that goes with it, zipped: the sheet and each section as
// pictures, every page as HTML and CSS, the fonts and pictures it uses, and a style guide that
// shows what it is drawn with: the brand's colours, fonts and corners as the CSS variables
// the pages use, and the sizes, weights, spacing and shadows written in its code.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { designStyles, tokensCss } from "@knitted/core";
import { fontFaceCss } from "@knitted/fonts";
import { activeSwatch, getDesign } from "@knitted/core/node";
import { captureTiles, designCode, designFiles, renderDesign } from "./design.mjs";
import { openRenderer } from "./renderer.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "section";
const times = (n) => `${n} use${n === 1 ? "" : "s"}`;
const where = (u) => (u.frames.length ? `${times(u.uses)}, in ${u.frames.slice(0, 4).map(esc).join(", ")}${u.frames.length > 4 ? ` and ${u.frames.length - 4} more` : ""}` : "Not used yet");
/** A value from the code, safe inside a style attribute. */
const css = (v) => String(v).replace(/[<>"{};]/g, "");

/**
 * The style guide as a page. `fontFaces` and `logoSrc` say where the fonts and the logo are:
 * files beside it in the download, or file:// URLs to draw it here.
 */
export function styleGuidePage({ design, project, swatch, styles, fontFaces, logoSrc }) {
  const s = styles;
  const color = (c) => `<figure class="chip"><div class="sw" style="background:${css(c.value)}"></div><figcaption><b>${esc(c.label)}</b><code>var(${esc(c.variable)})</code><code>${esc(c.value)}</code><small>${where(c)}</small></figcaption></figure>`;
  const other = (c) => `<figure class="chip sm"><div class="sw" style="background:${css(c.value)}"></div><figcaption><code>${esc(c.value)}</code><small>${c.sameAs ? `Same as ${esc(c.sameAs)}: use the variable` : "Not one of the brand's colours"}</small><small>${where(c)}</small></figcaption></figure>`;
  const font = (f) => `<div class="font"><p class="spec" style="font-family:${css(`"${f.family}"`)}">${esc(f.family)}</p><p class="pangram" style="font-family:${css(`"${f.family}"`)}">The quick brown fox jumps over the lazy dog. 0123456789</p><p class="meta"><b>${esc(f.label)}</b> <code>var(${esc(f.variable)})</code> <small>${where(f)}</small></p></div>`;
  const display = `"${fontFor(s, "Display")}"`;
  const size = (z) => `<div class="size"><code>${esc(z.value)}</code><span style="font-family:${css(display)};font-size:${z.px != null ? `${Math.min(z.px, 72)}px` : "24px"};line-height:1.15">${esc(design.name)}</span><small>${times(z.uses)}</small></div>`;
  const weight = (w) => `<div class="weight"><span style="font-family:${css(display)};font-weight:${css(w.value)}">Aa</span><code>${esc(w.value)}</code><small>${times(w.uses)}</small></div>`;
  const radius = (r, token) => `<figure class="corner"><div style="border-radius:${css(r.value)}"></div><figcaption>${token ? `<b>${esc(r.label)}</b><code>var(${esc(r.variable)})</code>` : ""}<code>${esc(r.value)}</code><small>${where(r)}</small></figcaption></figure>`;
  const space = (p) => `<div class="space"><code>${esc(p.value)}</code><span style="width:${Math.max(2, Math.min(p.px, 640))}px"></span><small>${times(p.uses)}</small></div>`;
  const shadow = (h) => `<figure class="shadow"><div style="box-shadow:${css(h.value)}"></div><figcaption><code>${esc(h.value)}</code><small>${where(h)}</small></figcaption></figure>`;
  const part = (title, note, body) => (body ? `<section><h2>${esc(title)}</h2>${note ? `<p class="note">${note}</p>` : ""}${body}</section>` : "");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(design.name)}: style guide</title><style>${fontFaces}
${tokensCss(swatch)}
*{box-sizing:border-box}html,body{margin:0;background:#fbf9f6;color:#17110b;font:15px/1.5 "Geist",system-ui,sans-serif}
main{width:1200px;padding:64px 72px 80px}
header{display:flex;align-items:center;gap:32px;margin-bottom:48px}header img{max-height:72px;max-width:240px}
h1{font-size:40px;line-height:1.1;margin:0}h1 small{display:block;font-size:16px;font-weight:400;color:#6b5f52;margin-top:6px}
h2{font-size:22px;margin:0 0 6px}section{margin:0 0 56px}.note{color:#6b5f52;margin:0 0 20px;max-width:760px}
code{font:12px/1.4 ui-monospace,Menlo,monospace;color:#3d342b;display:block;overflow-wrap:anywhere}small{display:block;color:#7a6e61;font-size:12px;line-height:1.4}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}.grid.six{grid-template-columns:repeat(6,1fr)}
.chip{margin:0;border-radius:14px;background:#fff;box-shadow:0 0 0 1px rgba(23,17,11,.08);overflow:hidden}.chip .sw{height:96px;box-shadow:inset 0 -1px 0 rgba(23,17,11,.08)}.chip.sm .sw{height:56px}
.chip figcaption{padding:12px 14px;display:grid;gap:3px}
.font{padding:24px 0;border-top:1px solid rgba(23,17,11,.1)}.spec{font-size:56px;line-height:1.05;margin:0}.pangram{font-size:22px;margin:8px 0}.meta{margin:0;display:flex;gap:12px;align-items:baseline}.meta code,.meta small{display:inline}
.size{display:grid;grid-template-columns:90px 1fr 90px;gap:20px;align-items:baseline;padding:6px 0;border-top:1px solid rgba(23,17,11,.08)}.size span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.size small{text-align:right}
.weights{display:flex;gap:28px;flex-wrap:wrap}.weight span{font-size:48px;line-height:1}
.corners{display:flex;gap:28px;flex-wrap:wrap}.corner{margin:0;width:160px}.corner div{width:160px;height:110px;background:${css(s.colors.find((c) => c.variable === "--color-primary")?.value ?? "#ddd")};margin-bottom:10px}
.spaces{columns:2;column-gap:56px}.space{display:grid;grid-template-columns:64px 1fr 64px;gap:12px;align-items:center;padding:3px 0;break-inside:avoid}.space span{height:12px;background:#d9cfc2;border-radius:3px;display:block;max-width:100%}.space small{text-align:right}
.shadows{display:flex;gap:36px;flex-wrap:wrap;padding:8px}.shadow{margin:0;width:220px}.shadow div{height:120px;background:#fff;border-radius:12px;margin-bottom:12px}
</style></head><body><main>
<header>${logoSrc ? `<img src="${esc(logoSrc)}" alt="">` : ""}<h1>${esc(design.name)}<small>Style guide${project ? ` for ${esc(project)}` : ""}: what this design is drawn with</small></h1></header>
${part("Colours", "The brand's colours, as the CSS variables every page uses (in tokens.css). The <i>on</i> colours are for text set on that colour.", `<div class="grid six">${s.colors.map(color).join("")}</div>`)}
${part("Other colours in the code", "Colours written out in a frame's CSS or HTML, not through a variable.", s.otherColors.length ? `<div class="grid six">${s.otherColors.map(other).join("")}</div>` : "")}
${part("Fonts", "", s.fonts.map(font).join(""))}
${part("Other fonts named in the code", "", s.otherFamilies.length ? s.otherFamilies.map((f) => `<p class="meta"><code>${esc(f.value)}</code> <small>${where(f)}</small></p>`).join("") : "")}
${part("Type sizes", "Every font size the pages use, largest first, each in the display font.", s.sizes.map(size).join(""))}
${part("Weights", "", s.weights.length ? `<div class="weights">${s.weights.map(weight).join("")}</div>` : "")}
${part("Corners", "The brand's corners as variables, and any other corner written in the code.", `<div class="corners">${s.radii.map((r) => radius(r, true)).join("")}${s.otherRadii.map((r) => radius(r, false)).join("")}</div>`)}
${part("Spacing", "The padding, margins and gaps the pages use, in pixels, smallest first.", s.spacing.length ? `<div class="spaces">${s.spacing.map(space).join("")}</div>` : "")}
${part("Shadows", "", s.shadows.length ? `<div class="shadows">${s.shadows.map(shadow).join("")}</div>` : "")}
</main></body></html>`;
}

/** The family a font slot names, as the style guide draws it. */
function fontFor(styles, label) { return styles.fonts.find((f) => f.label === label)?.family ?? "Geist"; }

/**
 * Everything, ready to zip: what designCode makes, with the pictures, the style guide and tokens.json.
 * @returns {Promise<{ name: string, entries: { name: string, path: string }[] }>}
 */
export async function designBundle(store, designId, { renderer: injected } = {}) {
  const design = getDesign(store, designId);
  const swatch = activeSwatch(store, design.projectId);
  let project = null; try { project = store.getProject(design.projectId).name; } catch { /* gone */ }
  const code = await designCode(store, designId);
  const { dir, root, entries } = code;
  const put = async (name, data) => { const at = join(dir, ...name.split("/")); await writeFile(at, data); entries.push({ name: `${root}/${name}`, path: at }); };
  const renderer = injected ?? (await openRenderer());
  try {
    // The sheet, and each section on its own, as pictures.
    await put("sheet.png", await renderDesign(store, designId, { renderer }));
    await mkdir(join(dir, "sections"), { recursive: true });
    for (const [i, s] of design.sections.entries()) {
      if (!s.frames.length) continue;
      await put(`sections/${String(i + 1).padStart(2, "0")}-${slug(s.name)}.png`, await renderDesign(store, designId, { sectionId: s.id, renderer }));
    }

    // The style guide: as a page beside the fonts and pictures, and as a picture of it.
    const styles = designStyles(design, swatch);
    const files = designFiles(store, design.projectId, swatch);
    const logoName = code.logo ? code.used.get(code.logo) : undefined;
    const logoFile = code.logo ? files.yarnUrl(code.logo) : undefined;
    // Beside the fonts in fonts/, as the pages are: the same faces, from one folder up less.
    const beside = [fontFaceCss(files.families, (file) => `fonts/${file}`), ...files.yarn.filter((y) => y.kind === "font").map((y) => `@font-face{font-family:"${(y.meta.family ?? y.name).replace(/"/g, "")}";src:url("fonts/${y.file}");font-display:swap}`)].join("\n");
    await put("style-guide.html", styleGuidePage({ design, project, swatch, styles, fontFaces: beside, logoSrc: logoName ? `images/${logoName}` : undefined }));
    const drawn = join(dir, "style-guide.render.html");
    await writeFile(drawn, styleGuidePage({ design, project, swatch, styles, fontFaces: files.fontFaces, logoSrc: logoFile }), "utf8");
    const page = await renderer.newPage({ width: 1200, height: 900, scale: 1 });
    try {
      await page.goto(pathToFileURL(drawn).href);
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))); });
      const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
      await put("style-guide.png", await captureTiles(page, size, 1));
    } finally { await page.close(); }

    // The tokens as data, for a design tool or a build.
    await put("tokens.json", `${JSON.stringify({
      colors: Object.fromEntries(styles.colors.map((c) => [c.variable.slice(2), c.value])),
      fonts: Object.fromEntries(styles.fonts.map((f) => [f.variable.slice(2), f.family])),
      radius: Object.fromEntries(styles.radii.map((r) => [r.variable.slice(2), r.value])),
      sizes: styles.sizes.map((z) => z.value),
      spacing: styles.spacing.map((p) => p.value),
    }, null, 2)}\n`);
  } finally { if (!injected) await renderer.close(); }

  // The README says what is in it all.
  const readme = entries.find((e) => e.name === `${root}/README.md`);
  if (readme) await writeFile(readme.path, `# ${design.name}\n\nA design from knitted, with everything that goes with it.\n\n- sheet.png is the whole sheet, and sections/ has each section on its own.\n- style-guide.html (and style-guide.png, a picture of it) shows what the design is drawn with: the brand's colours, fonts and corners as the CSS variables the pages use, and the type sizes, weights, spacing and shadows in its code.\n- tokens.css holds the brand as CSS variables, and tokens.json the same as data.\n- Each frame is a page of HTML and CSS, in a folder for its section. Open index.html to see them all.\n- fonts/ has the brand's fonts, and images/ the pictures the design uses.\n- A design shows one state of each screen. A menu open and a menu closed are two frames.\n`, "utf8");
  return { name: `${root}.zip`, entries };
}
